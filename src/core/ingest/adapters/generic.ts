/**
 * Generic CSV (columns time / sender / content, Chinese or English names) and
 * the JSON template `[{ "time": "...", "sender": "...", "text": "..." }]`.
 * Column aliases also cover WeChatExporter's CSV (时间,发送者,类型,内容) and the
 * common WeChatMsg / 留痕 CSV (StrTime, NickName, StrContent, Type, IsSender).
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
    "sender_name",
    "sender",
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
  type: ["type", "kind", "typename", "msg_type", "类型", "消息类型"],
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

function toRows(records: Record<string, unknown>[], map: ColumnMap, opts: ParseOptions) {
  let selfSender: string | undefined;
  const rows: RawMessage[] = records.map((r) => {
    const sender = asString(r[map.sender!]);
    const text = asString(r[map.text!]);
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

export function genericJsonRecords(root: unknown): Record<string, unknown>[] | null {
  const list = Array.isArray(root)
    ? root
    : isRecord(root)
      ? [root.messages, root.items, root.data, root.records].find(Array.isArray)
      : null;
  if (!list) return null;
  const records = list.filter(isRecord);
  if (!records.length) return null;
  return hasCore(mapColumns(Object.keys(records[0]))) ? records : null;
}

export function parseGenericJson(root: unknown, opts: ParseOptions): ParsedImport {
  const records = genericJsonRecords(root)!;
  const { rows, selfSender } = toRows(records, mapColumns(Object.keys(records[0])), opts);
  const title = isRecord(root)
    ? asString(root.title ?? root.chat ?? root.name) || undefined
    : undefined;
  return buildImport("generic-json", rows, { title, selfSender });
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
