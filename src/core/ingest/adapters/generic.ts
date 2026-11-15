/**
 * Generic CSV (columns time / sender / content, Chinese or English names) and
 * the JSON template `[{ "time": "...", "sender": "...", "text": "..." }]`.
 * Column aliases also cover WeChatExporter's CSV (时间,发送者,类型,内容), the
 * common WeChatMsg / 留痕 CSV (StrTime, NickName, StrContent, Type, IsSender),
 * and PyWxDump-style backup JSON (CreateTime, talker, msg or content.msg, is_sender).
 */
import type { MessageKind, ParsedImport } from "../../model";
import {
  ImportFormatError,
  type ParseOptions,
  type RawMessage,
  asString,
  buildImport,
  isRecord,
} from "../build";
import { kindFromText, wechatKind } from "../kinds";
import { parseTimestamp } from "../time";

type Field = "time" | "sender" | "text" | "type" | "self";

const ALIASES: Record<Field, string[]> = {
  time: [
    "time",
    "timestamp",
    "datetime",
    "date",
    "ts",
    "strtime",
    "createtime",
    "create_time",
    "时间",
    "发送时间",
    "日期",
    "日期时间",
  ],
  // NickName before Sender: 留痕 CSV puts the wxid in "Sender".
  sender: [
    "nickname",
    "talkername",
    "talker_name",
    "sendername",
    "sender_name",
    "display_name",
    "displayname",
    "sender_username",
    "sender",
    "talker",
    "from",
    "name",
    "author",
    "speaker",
    "user",
    "发送者",
    "发送人",
    "发言人",
    "昵称",
    "用户",
    "说话人",
  ],
  text: [
    "text",
    "content",
    "message",
    "msg",
    "body",
    "strcontent",
    "内容",
    "消息",
    "消息内容",
    "文本",
    "聊天内容",
  ],
  type: ["type", "kind", "typename", "type_name", "msg_type", "类型", "消息类型"],
  self: ["is_self", "isself", "issender", "is_sender", "from_me", "是否自己", "是否我发送"],
};

type ColumnMap = Partial<Record<Field, string>>;

function normalizeKey(k: string): string {
  return k
    .trim()
    .replace(/^\uFEFF/, "")
    .toLowerCase();
}

function mapColumns(keys: string[]): ColumnMap {
  const map: ColumnMap = {};
  const normalized = keys.map(normalizeKey);
  for (const field of Object.keys(ALIASES) as Field[]) {
    for (const alias of ALIASES[field]) {
      const i = normalized.indexOf(alias);
      if (i >= 0) {
        map[field] = keys[i];
        break;
      }
    }
  }
  return map;
}

function hasCore(map: ColumnMap): boolean {
  return !!(map.time && map.sender && map.text);
}

const TYPE_NAMES: Record<string, MessageKind> = {
  文本: "text",
  text: "text",
  图片: "image",
  image: "image",
  语音: "voice",
  voice: "voice",
  视频: "video",
  video: "video",
  表情: "sticker",
  sticker: "sticker",
  文件: "file",
  file: "file",
  链接: "link",
  link: "link",
  "链接/文件": "link",
  "链接/文件/小程序": "link",
  红包: "transfer",
  转账: "transfer",
  transfer: "transfer",
  系统: "system",
  系统消息: "system",
  系统提示: "system",
  撤回消息: "system",
  撤回: "system",
  system: "system",
};

function kindOf(type: string, text: string): MessageKind {
  const t = type.trim();
  if (!t) return kindFromText(text);
  if (/^\d+$/.test(t)) {
    const k = wechatKind(Number(t), undefined, text);
    return k === "text" ? kindFromText(text) : k;
  }
  const k = TYPE_NAMES[t.toLowerCase()] ?? TYPE_NAMES[t];
  if (!k || k === "text") return kindFromText(text);
  return k;
}

function isTruthy(v: string): boolean {
  return /^(1|true|yes|是|y)$/i.test(v.trim());
}

/** Backup exports sometimes nest the text as `{ msg, src }` instead of a string. */
function fieldText(v: unknown): string {
  const direct = asString(v);
  if (direct) return direct;
  if (!isRecord(v)) return "";
  for (const key of ["msg", "text", "content", "message", "strContent", "StrContent"]) {
    if (key in v) {
      const inner = asString(v[key]);
      if (inner) return inner;
    }
  }
  return "";
}

function toRows(records: Record<string, unknown>[], map: ColumnMap, opts: ParseOptions) {
  let selfSender: string | undefined;
  const rows: RawMessage[] = records.map((r) => {
    const sender = asString(r[map.sender!]);
    const text = fieldText(r[map.text!]);
    if (map.self && !selfSender && isTruthy(asString(r[map.self]))) selfSender = sender;
    return {
      ts: parseTimestamp(r[map.time!], opts.tzOffsetMinutes) ?? NaN,
      sender,
      text,
      kind: kindOf(map.type ? asString(r[map.type]) : "", text),
    };
  });
  return { rows, selfSender };
}

// ---------- JSON ----------

const LIST_KEYS = [
  "messages",
  "items",
  "data",
  "records",
  "msgs",
  "list",
  "msg_list",
  "message_list",
  "rows",
];

/** Keys from the first rows, so a field that appears after the first message still counts. */
function columnKeys(records: Record<string, unknown>[]): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const record of records.slice(0, 40)) {
    for (const key of Object.keys(record)) {
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

function usable(records: Record<string, unknown>[]): boolean {
  return records.length > 0 && hasCore(mapColumns(columnKeys(records)));
}

interface FoundList {
  records: Record<string, unknown>[];
  warning?: string;
}

function findMessageList(root: unknown): FoundList | null {
  if (Array.isArray(root)) {
    const records = root.filter(isRecord);
    return usable(records) ? { records } : null;
  }
  if (!isRecord(root)) return null;
  for (const key of LIST_KEYS) {
    if (!Array.isArray(root[key])) continue;
    const records = root[key].filter(isRecord);
    if (usable(records)) return { records };
  }
  const groups: { key: string; records: Record<string, unknown>[] }[] = [];
  for (const [key, value] of Object.entries(root)) {
    if (!Array.isArray(value)) continue;
    const records = value.filter(isRecord);
    if (usable(records)) groups.push({ key, records });
  }
  if (!groups.length) return null;
  groups.sort((a, b) => b.records.length - a.records.length);
  const best = groups[0];
  return {
    records: best.records,
    warning:
      groups.length > 1
        ? `文件包含 ${groups.length} 个会话，已导入消息最多的「${best.key}」。其他会话请分开导出后再导入`
        : undefined,
  };
}

export function genericJsonRecords(root: unknown): Record<string, unknown>[] | null {
  return findMessageList(root)?.records ?? null;
}

/** One JSON object per line (JSONL), used by some backup dumps. */
export function genericJsonLineRecords(content: string): Record<string, unknown>[] | null {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2 || !lines[0].startsWith("{")) return null;
  const records: Record<string, unknown>[] = [];
  for (const line of lines) {
    if (!line.startsWith("{")) return null;
    try {
      const value = JSON.parse(line) as unknown;
      if (!isRecord(value)) return null;
      records.push(value);
    } catch {
      return null;
    }
  }
  return usable(records) ? records : null;
}

export function parseGenericJson(root: unknown, opts: ParseOptions): ParsedImport {
  const found = findMessageList(root);
  if (!found) throw new ImportFormatError("文件里没有识别到任何消息");
  const { rows, selfSender } = toRows(found.records, mapColumns(columnKeys(found.records)), opts);
  const named = isRecord(root) ? asString(root.title ?? root.chat ?? root.name) : "";
  return buildImport("generic-json", rows, {
    title: named || undefined,
    selfSender,
    warnings: found.warning ? [found.warning] : [],
  });
}

// ---------- CSV ----------

export function parseCsvRows(content: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (quoted) {
      if (c === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && content[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim()));
}

function csvDelimiter(headerLine: string): string {
  const counts = [",", "\t", ";"].map((d) => [d, headerLine.split(d).length] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][0];
}

export function isGenericCsv(content: string): boolean {
  const header = content.split(/\r?\n/, 1)[0] ?? "";
  const cells = header.split(csvDelimiter(header)).map((c) => c.replace(/^"|"$/g, ""));
  return cells.length >= 3 && hasCore(mapColumns(cells));
}

export function parseGenericCsv(content: string, opts: ParseOptions): ParsedImport {
  const header = content.split(/\r?\n/, 1)[0];
  const table = parseCsvRows(content, csvDelimiter(header));
  const keys = table[0].map((k) => k.trim());
  const map = mapColumns(keys);
  if (!hasCore(map)) throw new ImportFormatError("CSV 缺少 时间 / 发送者 / 内容 列");
  const records = table
    .slice(1)
    .map((cells) => Object.fromEntries(keys.map((k, i) => [k, cells[i] ?? ""])));
  const { rows, selfSender } = toRows(records, map, opts);
  return buildImport("generic-csv", rows, { selfSender });
}
