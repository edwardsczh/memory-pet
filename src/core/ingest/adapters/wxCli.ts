/**
 * wx-cli. The original repo (github.com/jackwener/wx-cli) is DMCA-unavailable;
 * formats were taken from its successors:
 *
 * - pandorafuture/wx-cli v0.7.4 (commit 2abe708, `crates/wx-cli/src/cmd/export.rs`),
 *   also what WeChatExporter bundles:
 *   - JSON: { export_info: { generator: "wx-cli 0.7.4" }, conversation: { talker,
 *     display_name, type: "private" | "group" }, items: [{ server_id, msg_type,
 *     sub_type, sender (wxid), create_time (epoch s), content: serde enum
 *     ({"Text": "…"}, {"Image": {md5}}, "Voice", {"Transfer": …}, {"Revoke": "…"}…),
 *     sender_display_name ("名字（wxid）"), direction: "incoming" | "outgoing",
 *     snippet, media_files? }], paging, stats }
 *   - TXT: `"我"和"TA"的聊天记录如下:` header, "—————  2024-1-2  —————" day
 *     separators, then "名字 HH:MM" followed by the content line(s).
 * - jackwener/wx-cli-again v0.6.3 (commit 077a54c, `src/cli/export.rs`,
 *   `src/daemon/query.rs`), same CLI as the original `wx export --format`:
 *   - JSON: { chat, username, is_group, messages: [{ timestamp, time
 *     "YYYY-MM-DD HH:MM", sender, content, type ("文本" | "图片" | …), local_id,
 *     type_code, appmsg_type? }] }. In private chats the contact's own messages
 *     have an empty sender.
 *   - Markdown: "# 名称（群聊）", "> 导出 N 条消息", then per message
 *     "### YYYY-MM-DD HH:MM" + "**sender**: content" (continuations prefixed "> ").
 *   - TXT: "=== 名称[群] (N 条) ===" then "[YYYY-MM-DD HH:MM] sender: content".
 */
import type { MessageKind, ParsedImport } from "../../model";
import {
  type ParseOptions,
  type RawMessage,
  asString,
  buildImport,
  isRecord,
  stripIdSuffix,
} from "../build";
import { appmsgKind, kindFromText, wechatKind } from "../kinds";
import { parseDateTime, parseTimestamp } from "../time";
import { parseLines } from "./plainText";

type Row = Record<string, unknown>;

export function isWxCliEnvelope(root: Row): boolean {
  const gen = isRecord(root.export_info) ? asString(root.export_info.generator) : "";
  return gen.startsWith("wx-cli") || (isRecord(root.conversation) && Array.isArray(root.items));
}

export function isWxCliLegacy(root: Row): boolean {
  if (!Array.isArray(root.messages) || !("chat" in root)) return false;
  const first = root.messages.find(isRecord);
  return !first || "type_code" in first || "local_id" in first || "is_group" in root;
}

const CONTENT_KINDS: Record<string, MessageKind> = {
  Text: "text",
  Image: "image",
  Voice: "voice",
  Video: "video",
  Emoji: "sticker",
  Location: "other",
  Link: "link",
  File: "file",
  MiniProgram: "link",
  MergedMessages: "link",
  Quote: "text",
  Transfer: "transfer",
  RedEnvelope: "transfer",
  ChannelVideo: "link",
  Pat: "system",
  AppGeneric: "link",
  System: "system",
  Revoke: "system",
  Unknown: "other",
};

function contentVariant(content: unknown): { tag: string; value: unknown } {
  if (typeof content === "string") return { tag: content, value: undefined };
  if (isRecord(content)) {
    const tag = Object.keys(content)[0] ?? "Unknown";
    return { tag, value: content[tag] };
  }
  return { tag: "Unknown", value: undefined };
}

export function parseWxCliEnvelope(root: Row, opts: ParseOptions): ParsedImport {
  const conv = isRecord(root.conversation) ? root.conversation : {};
  const items = Array.isArray(root.items) ? root.items.filter(isRecord) : [];
  let selfSender: string | undefined;
  const rows: RawMessage[] = items.map((r) => {
    const { tag, value } = contentVariant(r.content);
    let kind = CONTENT_KINDS[tag] ?? wechatKind(Number(r.msg_type) || 0, Number(r.sub_type) || 0);
    if (tag === "AppGeneric" && isRecord(value)) kind = appmsgKind(Number(value.sub_type) || 0);
    let text = "";
    if (tag === "Text" && typeof value === "string") text = value;
    else if (tag === "Quote" && isRecord(value)) text = asString(value.reply_text);
    else if (kind === "text") text = asString(r.snippet);
    const sender = stripIdSuffix(asString(r.sender_display_name) || asString(r.sender));
    if (r.direction === "outgoing" && !selfSender) selfSender = sender;
    const media = Array.isArray(r.media_files) ? asString(r.media_files[0]) : "";
    return {
      ts: parseTimestamp(r.create_time, opts.tzOffsetMinutes) ?? NaN,
      sender,
      text,
      kind,
      sourceId: asString(r.server_id) || undefined,
      mediaRef: media || undefined,
    };
  });
  return buildImport("wx-cli-json", rows, {
    title: stripIdSuffix(asString(conv.display_name) || asString(conv.talker)) || undefined,
    isGroup: conv.type === "group" || asString(conv.talker).endsWith("@chatroom"),
    selfSender,
  });
}

const LEGACY_TYPES: Record<string, MessageKind> = {
  文本: "text",
  图片: "image",
  语音: "voice",
  视频: "video",
  表情: "sticker",
  名片: "other",
  位置: "other",
  通话: "other",
  系统: "system",
  撤回: "system",
};

export function parseWxCliLegacy(root: Row, opts: ParseOptions): ParsedImport {
  const title = asString(root.chat);
  const isGroup = root.is_group === true;
  const msgs = (root.messages as unknown[]).filter(isRecord);
  const rows: RawMessage[] = msgs.map((r) => {
    const text = asString(r.content);
    const typeName = asString(r.type);
    let kind: MessageKind = LEGACY_TYPES[typeName] ?? kindFromText(text);
    if (typeof r.type_code === "number" && r.type_code === 49) {
      kind = typeof r.appmsg_type === "number" ? appmsgKind(r.appmsg_type) : kindFromText(text);
    }
    if (kind === "text") kind = kindFromText(text);
    return {
      ts:
        parseTimestamp(r.timestamp, opts.tzOffsetMinutes) ??
        parseDateTime(asString(r.time), opts.tzOffsetMinutes) ??
        NaN,
      sender: legacySender(asString(r.sender), title, isGroup, kind),
      text,
      kind,
      sourceId: asString(r.local_id) || undefined,
    };
  });
  return buildImport("wx-cli-json", rows, {
    title,
    isGroup,
    selfSender: isGroup
      ? undefined
      : rows.find((r) => r.sender !== title && r.kind !== "system")?.sender,
  });
}

/** wx-cli leaves `sender` empty for the contact's own messages in private chats. */
function legacySender(sender: string, title: string, isGroup: boolean, kind: MessageKind): string {
  if (sender || kind === "system") return sender;
  return isGroup ? "" : title;
}

const MD_TITLE = /^#\s+(.+?)(（群聊）)?\s*$/;
const MD_HEADING = /^###\s+(.+?)\s*$/;
const MD_SENDER = /^\*\*(.+?)\*\*:\s?(.*)$/;

export function isWxCliMarkdown(content: string): boolean {
  return /^#\s+.+\n+>\s*导出\s*\d+\s*条消息/.test(content.trimStart());
}

export function parseWxCliMarkdown(content: string, opts: ParseOptions): ParsedImport {
  const lines = content.split(/\r?\n/);
  const tm = MD_TITLE.exec(lines.find((l) => l.startsWith("# ")) ?? "");
  const title = tm?.[1] ?? "";
  const isGroup = !!tm?.[2];
  const rows: RawMessage[] = [];
  let current: { ts: number; sender: string; lines: string[] } | null = null;
  const flush = () => {
    if (current)
      rows.push({ ts: current.ts, sender: current.sender, text: current.lines.join("\n") });
    current = null;
  };
  for (const line of lines) {
    const h = MD_HEADING.exec(line);
    if (h) {
      const ts = parseDateTime(h[1], opts.tzOffsetMinutes);
      if (ts !== null) {
        flush();
        current = { ts, sender: "", lines: [] };
        continue;
      }
    }
    if (!current) continue;
    const cur: { ts: number; sender: string; lines: string[] } = current;
    if (!cur.lines.length && !cur.sender) {
      if (!line.trim()) continue;
      const s = MD_SENDER.exec(line);
      if (s) {
        cur.sender = s[1];
        cur.lines.push(s[2]);
        continue;
      }
      cur.lines.push(line);
      continue;
    }
    cur.lines.push(line.replace(/^> ?/, ""));
  }
  flush();
  for (const r of rows) {
    r.text = r.text.replace(/\n+$/, "");
    r.sender = legacySender(r.sender, title, isGroup, kindFromText(r.text));
  }
  return buildImport("wx-cli-markdown", rows, { title, isGroup });
}

const TXT_PAIR = /^"(.+)"和"(.+)"的聊天记录如下[:：]\s*$/;
const TXT_GROUP = /^"(.+)"的聊天记录如下[:：]\s*$/;
const TXT_LEGACY = /^===\s*(.+?)(\[群\])?\s*\((\d+)\s*条\)\s*===\s*$/;

export function isWxCliTxt(firstLine: string): boolean {
  return TXT_PAIR.test(firstLine) || TXT_GROUP.test(firstLine) || TXT_LEGACY.test(firstLine);
}

export function parseWxCliTxt(content: string, opts: ParseOptions): ParsedImport {
  const lines = content.split(/\r?\n/);
  const first = lines[0].trim();
  const legacy = TXT_LEGACY.exec(first);
  if (legacy) {
    const title = legacy[1];
    const isGroup = !!legacy[2];
    const { rows, warnings } = parseLines(lines.slice(1), opts, "bracket");
    return buildImport("wx-cli-txt", rows, { title, isGroup, warnings });
  }
  const pair = TXT_PAIR.exec(first);
  const group = TXT_GROUP.exec(first);
  // Skip the "导出时间 / 消息数 / 时间范围" block; messages start at the first day separator.
  const start = lines.findIndex(
    (l, i) => i > 0 && /^—+\s*\d{4}-\d{1,2}-\d{1,2}\s*—+$/.test(l.trim()),
  );
  const body = lines.slice(start > 0 ? start : 1);
  const attachments = body.findIndex((l) => l.trim() === "附件：");
  const { rows, warnings } = parseLines(
    attachments >= 0 ? body.slice(0, attachments) : body,
    opts,
    "senderTime",
  );
  for (const r of rows) r.sender = stripIdSuffix(r.sender);
  return buildImport("wx-cli-txt", rows, {
    title: pair ? pair[2] : group?.[1],
    isGroup: !pair,
    selfSender: pair?.[1],
    warnings,
  });
}
