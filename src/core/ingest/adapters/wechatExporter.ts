/**
 * WeChatExporter (https://github.com/93857536-pixel/WeChatExporter, checked at
 * commit ce57a69, 2026-11). Its native exporter (`ChatExporter.swift`) writes:
 *
 * - `chat.json`: array of { content, sender, time "yyyy-MM-dd HH:mm:ss"
 *   (Asia/Shanghai), timestamp (epoch s), type (local_type), typeName }.
 *   System rows (10000 / 10002) use sender "系统"; appmsg rows (49) keep raw XML.
 * - `chat.txt`: header "微信聊天记录: 名称 (wxid)", "总消息数", "时间范围", a
 *   "====" rule, then "[yyyy-MM-dd HH:mm:ss] sender: content" per message
 *   (media shown as "[图片]" etc., XML content may span several lines).
 *
 * When the bundled wx-cli is available the app exports through it instead;
 * those files are handled by the wx-cli adapter.
 */
import type { ParsedImport } from "../../model";
import { type ParseOptions, type RawMessage, asString, buildImport, isRecord } from "../build";
import { kindFromText, wechatKind } from "../kinds";
import { parseTimestamp } from "../time";
import { parseLines } from "./plainText";

export function isWechatExporterJson(rows: unknown[]): boolean {
  const r = rows.find(isRecord);
  return !!r && "typeName" in r && "timestamp" in r && "content" in r;
}

export function parseWechatExporterJson(rows: unknown[], opts: ParseOptions): ParsedImport {
  const out: RawMessage[] = rows.filter(isRecord).map((r) => {
    const type = typeof r.type === "number" ? r.type : 1;
    const text = asString(r.content);
    const kind = type === 1 ? kindFromText(text) : wechatKind(type, undefined, text);
    return {
      ts:
        parseTimestamp(r.timestamp, opts.tzOffsetMinutes) ??
        parseTimestamp(r.time, opts.tzOffsetMinutes) ??
        NaN,
      sender: asString(r.sender),
      text: kind === "text" ? text : "",
      kind,
    };
  });
  return buildImport("wechat-exporter-json", out);
}

const TXT_HEADER = /^微信聊天记录[:：]\s*(.+?)(?:\s+\(([^)]*)\))?\s*$/;

export function isWechatExporterTxt(firstLine: string): boolean {
  return TXT_HEADER.test(firstLine);
}

export function parseWechatExporterTxt(content: string, opts: ParseOptions): ParsedImport {
  const lines = content.split(/\r?\n/);
  const title = TXT_HEADER.exec(lines[0])?.[1];
  const rule = lines.findIndex((l) => /^={10,}$/.test(l.trim()));
  const body = lines.slice(rule >= 0 ? rule + 1 : 1);
  const { rows, warnings } = parseLines(body, opts, "bracket");
  return buildImport("wechat-exporter-txt", rows, { title, warnings });
}
