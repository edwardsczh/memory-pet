import type { ChatMessage, MessageKind, ParsedImport, SourceFormat } from "../model";
import { PLACEHOLDER_TEXT, appmsgTitle, kindFromText, stripQuote } from "./kinds";

export interface ParseOptions {
  /** Offset applied to zone-less wall-clock times. Default UTC+8. */
  tzOffsetMinutes?: number;
  /** Conversation id to keep when the file holds several (see `ParsedImport.conversations`). */
  conversation?: string;
}

/** One parsed row before ids and participants are assigned. */
export interface RawMessage {
  ts: number;
  sender: string;
  text: string;
  /** Inferred from `text` placeholders when absent. */
  kind?: MessageKind;
  sourceId?: string;
  mediaRef?: string;
}

export const SYSTEM_SENDER = "系统";

export class ImportFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportFormatError";
  }
}

export function buildImport(
  format: SourceFormat,
  rows: RawMessage[],
  meta: Partial<Omit<ParsedImport, "format" | "messages" | "participants">> = {},
): ParsedImport {
  const warnings = [...(meta.warnings ?? [])];
  const usedIds = new Set<string>();
  const messages: ChatMessage[] = [];
  let badTime = 0;
  let repeated = 0;

  rows.forEach((row, i) => {
    if (!Number.isFinite(row.ts)) {
      badTime++;
      return;
    }
    const sourceId = row.sourceId && row.sourceId !== "0" ? String(row.sourceId) : undefined;
    if (sourceId && usedIds.has(sourceId)) {
      repeated++;
      return;
    }
    let text = row.text.replace(/\r\n?/g, "\n").trim();
    const kind = row.kind ?? kindFromText(text);
    if (kind === "text") text = text.startsWith("<") ? appmsgTitle(text) : stripQuote(text);
    else if (!text || text.startsWith("<")) text = PLACEHOLDER_TEXT[kind] ?? "";
    if (kind === "text" && !text) return;

    let id = sourceId ?? `m${i + 1}`;
    if (usedIds.has(id)) id = `${id}#${i + 1}`;
    usedIds.add(id);

    const sender = row.sender.trim() || (kind === "system" ? SYSTEM_SENDER : "");
    const msg: ChatMessage = { id, ts: row.ts, sender, kind, text };
    if (row.mediaRef) msg.mediaRef = row.mediaRef;
    messages.push(msg);
  });

  if (badTime) warnings.push(`${badTime} 条消息的时间无法识别，已跳过`);
  if (repeated) warnings.push(`${repeated} 条消息 id 重复（导出文件里出现了两次），已跳过`);
  if (!messages.length) throw new ImportFormatError("文件里没有识别到任何消息");

  const counts = new Map<string, number>();
  for (const m of messages) {
    if (m.kind === "system" || !m.sender) continue;
    counts.set(m.sender, (counts.get(m.sender) ?? 0) + 1);
  }
  const participants = [...counts]
    .map(([sender, count]) => ({ sender, count }))
    .sort((a, b) => b.count - a.count);

  const result: ParsedImport = {
    format,
    isGroup: meta.isGroup ?? participants.length > 2,
    participants,
    messages,
    warnings,
  };
  if (meta.title) result.title = meta.title;
  if (meta.selfSender && counts.has(meta.selfSender)) result.selfSender = meta.selfSender;
  if (meta.conversations && meta.conversations.length > 1)
    result.conversations = meta.conversations;
  return result;
}

/** wx-cli appends the id to display names: "小鹿（wxid_xxx）". */
export function stripIdSuffix(name: string): string {
  return name.replace(/（[\w.@-]+）$/, "").trim() || name;
}

export function asString(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
