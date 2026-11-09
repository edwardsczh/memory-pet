/**
 * chatlog-keeper (https://github.com/labazhou2024/chatlog-keeper, checked at
 * commit 2225294, 2026-10) writes `wechat_messages.json` / `qq_messages.json`:
 * one JSON array holding every conversation in the export window.
 *
 * WeChat rows (`cli.py` `_wx_msg_to_dict`): ts (epoch s), sender (display
 * name), sender_wxid, chat_room, conversation_id, content (XML already reduced
 * to "[图片]", "[转账]", "[链接|…] …", "[系统] …"), msg_type (base local_type),
 * is_self, is_group_chat, server_id.
 *
 * QQ rows (`qq_db.py` `read_recent_dicts`): ts, ts_iso, sender_qq, sender_name,
 * content ("[图片: x]", "[表情: x]", "[戳一戳]"…), msg_id, chat_uid, chat_kind
 * ("group" | "friend"), chat_name, is_self, is_group_chat. No type field.
 */
import type { ConversationSummary, MessageKind, ParsedImport, SourceFormat } from "../../model";
import { type ParseOptions, type RawMessage, asString, buildImport, isRecord } from "../build";
import { kindFromText, wechatKind } from "../kinds";
import { parseTimestamp } from "../time";

type Row = Record<string, unknown>;

export function isChatlogKeeperWechat(rows: unknown[]): boolean {
  const r = rows.find(isRecord);
  return !!r && "msg_type" in r && ("sender_wxid" in r || "chat_room" in r || "thread_id" in r);
}

export function isChatlogKeeperQQ(rows: unknown[]): boolean {
  const r = rows.find(isRecord);
  if (!r) return false;
  return "sender_qq" in r || "chat_kind" in r || asString(r.source_offset).startsWith("qq_db:");
}

export function parseChatlogKeeper(rows: unknown[], qq: boolean, opts: ParseOptions): ParsedImport {
  const format: SourceFormat = qq ? "qq-ntqq-json" : "wechat-chatlog-keeper-json";
  const records = rows.filter(isRecord);
  const groups = new Map<string, { title: string; isGroup: boolean; rows: Row[] }>();
  for (const r of records) {
    const id = asString(r.conversation_id ?? r.chat_uid ?? r.chat_room) || "default";
    let g = groups.get(id);
    if (!g) {
      const title = qq ? asString(r.chat_name) : asString(r.chat_room);
      const isGroup =
        r.is_group_chat === true ||
        r.conversation_type === "group" ||
        r.chat_kind === "group" ||
        id.endsWith("@chatroom");
      g = { title: title || id, isGroup, rows: [] };
      groups.set(id, g);
    }
    g.rows.push(r);
  }

  const conversations: ConversationSummary[] = [...groups]
    .map(([id, g]) => ({ id, title: g.title, isGroup: g.isGroup, count: g.rows.length }))
    .sort((a, b) => b.count - a.count);
  const warnings: string[] = [];
  let chosen = conversations[0];
  if (opts.conversation) {
    const hit = conversations.find(
      (c) => c.id === opts.conversation || c.title === opts.conversation,
    );
    if (hit) chosen = hit;
    else warnings.push(`没有找到会话「${opts.conversation}」，已改用消息最多的会话`);
  } else if (conversations.length > 1) {
    warnings.push(
      `文件包含 ${conversations.length} 个会话，已选择消息最多的「${chosen.title}」；可在导入时指定其他会话`,
    );
  }
  const g = groups.get(chosen.id)!;

  let selfSender: string | undefined;
  const out: RawMessage[] = g.rows.map((r) => {
    const sender = qq
      ? asString(r.sender_name) || asString(r.sender_qq)
      : asString(r.sender) || asString(r.sender_wxid);
    if (r.is_self === true && !selfSender) selfSender = sender;
    const text = asString(r.content);
    const msgType = typeof r.msg_type === "number" ? r.msg_type : undefined;
    let kind: MessageKind = kindFromText(text);
    if (!qq && msgType !== undefined && msgType !== 49 && msgType !== 1) kind = wechatKind(msgType);
    return {
      ts: parseTimestamp(r.ts ?? r.ts_iso, opts.tzOffsetMinutes) ?? NaN,
      sender,
      text,
      kind,
      sourceId: asString(r.server_id ?? r.msg_id) || undefined,
    };
  });

  return buildImport(format, out, {
    title: chosen.title,
    isGroup: chosen.isGroup,
    selfSender,
    conversations,
    warnings,
  });
}
