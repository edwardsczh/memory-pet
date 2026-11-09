/**
 * Renders a fictional conversation into the on-disk formats of the exporters
 * the importer supports (see src/core/ingest/adapters/* for format sources).
 * Used only by the fixture generator scripts; all names and numbers are made up.
 */

export type DemoKind =
  | "text"
  | "image"
  | "voice"
  | "video"
  | "sticker"
  | "file"
  | "link"
  | "transfer"
  | "recall"
  | "system";

export interface DemoMessage {
  ts: number;
  /** Display name of the sender. */
  sender: string;
  kind: DemoKind;
  /** Text for "text"; title / amount / notice for the others. */
  text: string;
}

export interface Conversation {
  title: string;
  self: string;
  isGroup: boolean;
  /** Fake wxid / QQ number per display name. */
  ids: Record<string, string>;
  messages: DemoMessage[];
}

const TZ_MS = 8 * 3600_000;
const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** Formats epoch ms as UTC+8 wall clock. Tokens: YYYY MM DD HH mm ss, M D unpadded. */
export function fmt(ts: number, pattern: string): string {
  const d = new Date(ts + TZ_MS);
  const map: Record<string, string> = {
    YYYY: String(d.getUTCFullYear()),
    MM: pad(d.getUTCMonth() + 1),
    DD: pad(d.getUTCDate()),
    HH: pad(d.getUTCHours()),
    mm: pad(d.getUTCMinutes()),
    ss: pad(d.getUTCSeconds()),
    M: String(d.getUTCMonth() + 1),
    D: String(d.getUTCDate()),
  };
  return pattern.replace(/YYYY|MM|DD|HH|mm|ss|M|D/g, (t) => map[t]);
}

export function cst(y: number, m: number, d: number, h = 0, min = 0, s = 0): number {
  return Date.UTC(y, m - 1, d, h, min, s) - TZ_MS;
}

const sec = (ts: number) => Math.floor(ts / 1000);

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function appmsgXml(type: number, title: string, extra = ""): string {
  return `<msg>\n  <appmsg appid="" sdkver="0">\n    <title>${xmlEscape(title)}</title>\n    <type>${type}</type>${extra}\n  </appmsg>\n</msg>`;
}

/** Bracketed placeholder most exporters show for non-text messages. */
function placeholder(m: DemoMessage): string {
  switch (m.kind) {
    case "image":
      return "[图片]";
    case "voice":
      return "[语音]";
    case "video":
      return "[视频]";
    case "sticker":
      return "[表情]";
    case "file":
      return `[文件] ${m.text}`;
    case "link":
      return `[链接] ${m.text}`;
    case "transfer":
      return m.text.startsWith("红包") ? "[红包]" : `[转账] ${m.text}`;
    case "recall":
      return `"${m.sender}" 撤回了一条消息`;
    case "system":
      return m.text;
    default:
      return m.text;
  }
}

// ---------- WeChatExporter (native ChatExporter.swift) ----------

const WX_TYPE: Record<DemoKind, [number, string]> = {
  text: [1, "文本"],
  image: [3, "图片"],
  voice: [34, "语音"],
  video: [43, "视频"],
  sticker: [47, "表情"],
  file: [49, "链接/文件/小程序"],
  link: [49, "链接/文件/小程序"],
  transfer: [49, "链接/文件/小程序"],
  recall: [10002, "撤回消息"],
  system: [10000, "系统提示"],
};

function wechatRawContent(m: DemoMessage): string {
  switch (m.kind) {
    case "text":
      return m.text;
    case "image":
      return '<msg><img aeskey="0" encryver="1" length="102400" md5="00000000000000000000000000000000" /></msg>';
    case "voice":
      return '<msg><voicemsg endflag="1" length="4096" voicelength="3000" /></msg>';
    case "video":
      return '<msg><videomsg length="2048000" playlength="12" /></msg>';
    case "sticker":
      return '<msg><emoji fromusername="" tousername="" type="2" md5="00000000000000000000000000000000" /></msg>';
    case "file":
      return appmsgXml(6, m.text, "\n    <appattach><totallen>20480</totallen></appattach>");
    case "link":
      return appmsgXml(5, m.text, "\n    <url>https://example.com/article</url>");
    case "transfer":
      return m.text.startsWith("红包")
        ? appmsgXml(2001, "微信红包")
        : appmsgXml(2000, "微信转账", `\n    <des>${m.text}</des>`);
    case "recall":
      return `<sysmsg type="revokemsg"><revokemsg><content>"${m.sender}" 撤回了一条消息</content></revokemsg></sysmsg>`;
    case "system":
      return m.text;
  }
}

/** Swift JSONEncoder [.prettyPrinted, .sortedKeys]: `"key" : value`, escaped slashes. */
export function writeWechatExporterJson(c: Conversation): string {
  const rows = c.messages.map((m) => {
    const [type, typeName] = WX_TYPE[m.kind];
    const system = m.kind === "recall" || m.kind === "system";
    return {
      content: wechatRawContent(m),
      sender: system ? "系统" : m.sender,
      time: fmt(m.ts, "YYYY-MM-DD HH:mm:ss"),
      timestamp: sec(m.ts),
      type,
      typeName,
    };
  });
  return JSON.stringify(rows, null, 2).replace(/": /g, '" : ').replace(/\//g, "\\/") + "\n";
}

export function writeWechatExporterTxt(c: Conversation): string {
  const first = c.messages[0];
  const last = c.messages[c.messages.length - 1];
  const lines = [
    `微信聊天记录: ${c.title} (${c.ids[c.title] ?? c.title})`,
    `总消息数: ${c.messages.length}`,
    `时间范围: ${fmt(first.ts, "YYYY-MM-DD HH:mm:ss")} ~ ${fmt(last.ts, "YYYY-MM-DD HH:mm:ss")}`,
    "=".repeat(60),
    "",
  ];
  for (const m of c.messages) {
    const [type, typeName] = WX_TYPE[m.kind];
    const system = m.kind === "recall" || m.kind === "system";
    const raw = wechatRawContent(m);
    const media = [3, 34, 43, 47].includes(type);
    const content = media ? `[${typeName}]` : raw;
    lines.push(`[${fmt(m.ts, "YYYY-MM-DD HH:mm:ss")}] ${system ? "系统" : m.sender}: ${content}`);
  }
  return lines.join("\n") + "\n";
}

// ---------- Plain text ----------

export function writePlainInline(c: Conversation): string {
  return (
    c.messages
      .filter((m) => m.kind !== "system")
      .map((m) =>
        m.kind === "recall"
          ? `${fmt(m.ts, "YYYY-MM-DD HH:mm")} ${placeholder(m)}`
          : `${fmt(m.ts, "YYYY-MM-DD HH:mm")} ${m.sender}: ${m.kind === "text" ? m.text : placeholder(m)}`,
      )
      .filter((l) => !l.includes("撤回了一条消息"))
      .join("\n") + "\n"
  );
}

export function writePlainBracket(c: Conversation): string {
  return (
    c.messages
      .filter((m) => m.kind !== "system" && m.kind !== "recall")
      .map(
        (m) =>
          `[${fmt(m.ts, "YYYY/M/D HH:mm:ss")}] ${m.sender}：${m.kind === "text" ? m.text : placeholder(m)}`,
      )
      .join("\n") + "\n"
  );
}

export function writePlainSenderTime(c: Conversation): string {
  const out: string[] = [];
  let day = "";
  for (const m of c.messages) {
    if (m.kind === "system" || m.kind === "recall") continue;
    const d = fmt(m.ts, "YYYY-MM-DD");
    if (d !== day) {
      out.push(d, "");
      day = d;
    }
    out.push(`${m.sender} ${fmt(m.ts, "HH:mm")}`, m.kind === "text" ? m.text : placeholder(m), "");
  }
  return out.join("\n");
}

// ---------- QQ 消息管理器 TXT / MHT ----------

function qqName(c: Conversation, name: string): string {
  if (name === c.self) return name;
  const id = c.ids[name];
  return id ? `${name}(${id})` : name;
}

function qqContent(m: DemoMessage): string {
  if (m.kind === "text") return m.text;
  if (m.kind === "sticker") return "[表情]";
  if (m.kind === "transfer") return "[QQ红包]";
  return placeholder(m);
}

export function writeQQTxt(c: Conversation): string {
  const lines = [
    "消息记录（此消息记录为文本格式，不支持重新导入）",
    "",
    "=".repeat(64),
    `消息分组:${c.isGroup ? "我的QQ群" : "我的好友"}`,
    "=".repeat(64),
    `消息对象:${c.title}`,
    "=".repeat(64),
    "",
  ];
  for (const m of c.messages) {
    if (m.kind === "recall") continue;
    const sender = m.kind === "system" ? "系统消息(10000)" : qqName(c, m.sender);
    lines.push(`${fmt(m.ts, "YYYY-MM-DD HH:mm:ss")} ${sender}`, qqContent(m), "");
  }
  return lines.join("\r\n");
}

export function writeQQMht(c: Conversation): string {
  const boundary = "----=_NextPart_DEMO_0000_0000";
  const rows: string[] = [
    `<tr><td><div style=padding-left:10px;><br><b>消息记录（此消息记录为文本格式，不支持重新导入）</b></div>` +
      `<div style=padding-left:10px;>================================================================</div>` +
      `<div style=padding-left:10px;>消息分组:${c.isGroup ? "我的QQ群" : "我的好友"}</div>` +
      `<div style=padding-left:10px;>================================================================</div>` +
      `<div style=padding-left:10px;>消息对象:${c.title}</div>` +
      `<div style=padding-left:10px;>================================================================</div></td></tr>`,
  ];
  let day = "";
  for (const m of c.messages) {
    if (m.kind === "recall") continue;
    const d = fmt(m.ts, "YYYY-MM-DD");
    if (d !== day) {
      rows.push(
        `<tr><td style=border-bottom-width:1px;border-bottom-color:#8EC3EB;border-bottom-style:solid;color:#3568BB;font-weight:bold;height:24px;line-height:24px;padding-left:10px;margin-bottom:5px;>日期: ${d}</td></tr>`,
      );
      day = d;
    }
    const color = m.sender === c.self ? "#42B475" : "#006EFE";
    const sender = m.kind === "system" ? "系统消息(10000)" : qqName(c, m.sender);
    const body =
      m.kind === "image"
        ? `<IMG src="{00000000-0000-0000-0000-000000000000}.jpg">`
        : xmlEscape(qqContent(m)).replace(/\n/g, "<br>");
    rows.push(
      `<tr><td><div style=color:${color};padding-left:10px;><div style=float:left;margin-right:6px;>${xmlEscape(sender)}</div>${fmt(m.ts, "HH:mm:ss")}</div>` +
        `<div style=padding-left:20px;><font style="font-size:10pt;font-family:'宋体','MS Sans Serif',sans-serif;" color='000000'>${body}</font></div></td></tr>`,
    );
  }
  return [
    "MIME-Version: 1.0",
    `Content-Type:multipart/related;charset="utf-8";type="text/html";boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type:text/html",
    "Content-Transfer-Encoding:7bit",
    "",
    '<html xmlns="http://www.w3.org/1999/xhtml"><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8" /><title>QQ Message</title></head><body><table width=100% cellspacing=0>',
    ...rows,
    "</table></body></html>",
    "",
    `--${boundary}`,
    "Content-Type:image/jpeg",
    "Content-Transfer-Encoding:base64",
    "Content-Location:{00000000-0000-0000-0000-000000000000}.jpg",
    "",
    "AAAA",
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

// ---------- chatlog-keeper ----------

function pyJson(v: unknown): string {
  // json.dump(indent=2, ensure_ascii=False); whole-second floats keep ".0".
  return JSON.stringify(v, null, 2).replace(/"ts": (\d+)(,?)$/gm, '"ts": $1.0$2') + "\n";
}

function keeperWechatContent(m: DemoMessage): string {
  switch (m.kind) {
    case "text":
      return m.text;
    case "image":
      return "[图片]";
    case "voice":
      return "[语音 3s]";
    case "video":
      return "[视频 12s]";
    case "sticker":
      return "[表情]";
    case "file":
      return `[文件: ${m.text}]`;
    case "link":
      return `[链接|示例公众号] ${m.text}`;
    case "transfer":
      return m.text.startsWith("红包") ? "[红包]" : "[转账]";
    case "recall":
      return `[系统] "${m.sender}" 撤回了一条消息`;
    case "system":
      return m.text;
  }
}

const KEEPER_WX_TYPE: Record<DemoKind, number> = {
  text: 1,
  image: 3,
  voice: 34,
  video: 43,
  sticker: 47,
  file: 49,
  link: 49,
  transfer: 49,
  recall: 10000,
  system: 10000,
};

export function writeChatlogKeeperWechat(convs: Conversation[], account: string): string {
  const rows: Record<string, unknown>[] = [];
  for (const c of convs) {
    const conversationId = c.ids[c.title];
    c.messages.forEach((m, i) => {
      const system = m.kind === "recall" || m.kind === "system";
      const wxid = system ? "" : (c.ids[m.sender] ?? "");
      const serverId = String(
        7_000_000_000_000_000_000n + BigInt(sec(m.ts)) * 100n + BigInt(i % 100),
      );
      rows.push({
        ts: sec(m.ts),
        sender: system ? "" : m.sender,
        sender_wxid: wxid,
        chat_room: c.title,
        conversation_id: conversationId,
        content: keeperWechatContent(m),
        msg_type: KEEPER_WX_TYPE[m.kind],
        is_self: m.sender === c.self && !system,
        account_id: account,
        thread_id: `${account}::${conversationId}`,
        server_id: serverId,
        source_offset: `wechat_server:${serverId}`,
        conversation_type: c.isGroup ? "group" : "direct",
        is_group_chat: c.isGroup,
      });
    });
  }
  rows.sort((a, b) => (a.ts as number) - (b.ts as number));
  return pyJson(rows);
}

function keeperQQContent(m: DemoMessage): string {
  switch (m.kind) {
    case "image":
      return "[图片: 0A1B2C3D.jpg]";
    case "voice":
      return "[语音 3.0s 5KB]";
    case "video":
      return "[视频: 0A1B2C3D.mp4 2.0MB]";
    case "sticker":
      return "[表情: 抱抱]";
    case "file":
      return `[文件: ${m.text} 20KB]`;
    case "link":
      return `[小程序: ${m.text}]`;
    case "transfer":
      return "[QQ红包]";
    case "recall":
      return `${m.sender}撤回了一条消息`;
    default:
      return m.text;
  }
}

export function writeChatlogKeeperQQ(c: Conversation, account: string): string {
  const conversationId = c.ids[c.title];
  const rows = c.messages
    .filter((m) => m.kind !== "system")
    .map((m, i) => {
      const qq = Number(c.ids[m.sender] ?? 0);
      return {
        ts: sec(m.ts),
        ts_iso: new Date(sec(m.ts) * 1000).toISOString().replace(".000Z", "+00:00"),
        wxid_hash: (qq * 2654435761).toString(16).slice(-16).padStart(16, "0"),
        sender_qq: qq,
        sender_uid: `u_demo${String(qq).slice(-4)}`,
        sender_name: m.sender,
        content: keeperQQContent(m),
        msg_id: 900000 + i,
        chat_uid: conversationId,
        chat_kind: c.isGroup ? "group" : "friend",
        chat_name: c.title,
        account_id: account,
        conversation_id: conversationId,
        thread_id: `${account}::${conversationId}`,
        source_offset: `qq_db:${900000 + i}`,
        conversation_type: c.isGroup ? "group" : "direct",
        is_group_chat: c.isGroup,
        is_self: m.sender === c.self,
      };
    });
  return pyJson(rows);
}

// ---------- wx-cli ----------

function wxCliContent(m: DemoMessage): unknown {
  switch (m.kind) {
    case "text":
      return { Text: m.text };
    case "image":
      return { Image: { md5: "00000000000000000000000000000000" } };
    case "voice":
      return "Voice";
    case "video":
      return { Video: { md5: null } };
    case "sticker":
      return { Emoji: '<msg><emoji md5="00000000000000000000000000000000" /></msg>' };
    case "file":
      return { File: { title: m.text, file_ext: "pdf", file_size: 20480, md5: null, raw_xml: "" } };
    case "link":
      return {
        Link: { sub_type: 5, title: m.text, des: null, url: "https://example.com/a", raw_xml: "" },
      };
    case "transfer":
      return m.text.startsWith("红包")
        ? { RedEnvelope: { title: "恭喜发财，大吉大利", raw_xml: "" } }
        : { Transfer: { amount_desc: m.text, pay_memo: null, pay_sub_type: 1, raw_xml: "" } };
    case "recall":
      return { Revoke: `"${m.sender}" 撤回了一条消息` };
    case "system":
      return { System: m.text };
  }
}

function wxCliSnippet(m: DemoMessage): string {
  switch (m.kind) {
    case "text":
      return m.text;
    case "image":
      return "[image 00000000000000000000000000000000]";
    case "voice":
      return "[voice]";
    case "video":
      return "[video ]";
    case "sticker":
      return '[emoji <msg><emoji md5="00000000000000000000000000000000" /></msg>]';
    case "file":
      return `[文件] ${m.text}`;
    case "link":
      return `[链接] ${m.text}`;
    case "transfer":
      return m.text.startsWith("红包") ? "[红包] 恭喜发财，大吉大利" : `[转账] ${m.text}`;
    case "recall":
      return `[revoke] "${m.sender}" 撤回了一条消息`;
    case "system":
      return `[system] ${m.text}`;
  }
}

const WX_CLI_TYPE: Record<DemoKind, [number, number]> = {
  text: [1, 0],
  image: [3, 0],
  voice: [34, 0],
  video: [43, 0],
  sticker: [47, 0],
  file: [49, 6],
  link: [49, 5],
  transfer: [49, 2000],
  recall: [10002, 0],
  system: [10000, 0],
};

export function writeWxCliJson(c: Conversation): string {
  const talker = c.ids[c.title];
  const items = c.messages.map((m, i) => {
    const [msgType, subType] = WX_CLI_TYPE[m.kind];
    const transfer = m.kind === "transfer" && m.text.startsWith("红包") ? 2001 : subType;
    const system = m.kind === "recall" || m.kind === "system";
    const wxid = system ? talker : c.ids[m.sender];
    return {
      sort_seq: sec(m.ts) * 1000 + i,
      server_id: 5_000_000_000_000 + i,
      msg_type: msgType,
      sub_type: transfer,
      sender: wxid,
      talker,
      create_time: sec(m.ts),
      content: wxCliContent(m),
      status: 2,
      sender_display_name: `${system ? c.title : m.sender}（${wxid}）`,
      direction: m.sender === c.self && !system ? "outgoing" : "incoming",
      snippet: wxCliSnippet(m),
    };
  });
  const envelope = {
    export_info: {
      version: "1",
      exported_at: "2026-11-09T10:00:00+08:00",
      generator: "wx-cli 0.7.4",
    },
    conversation: {
      talker,
      display_name: `${c.title}（${talker}）`,
      type: c.isGroup ? "group" : "private",
      message_count: items.length,
      time_range_start: items[0].create_time,
      time_range_end: items[items.length - 1].create_time,
    },
    items,
    paging: { limit: 0, offset: 0, returned: items.length, has_more: false, total: items.length },
    stats: { scanned: items.length, skipped: 0 },
  };
  return JSON.stringify(envelope, null, 2) + "\n";
}

/** wx-cli 0.7 TXT (`write_txt` without media). */
export function writeWxCliTxt(c: Conversation): string {
  let out = `"${c.self}"和"${c.title}"的聊天记录如下:\n\n`;
  out += "导出时间：2026-11-09 10:00:00\n";
  out += `消息数：${c.messages.length}\n`;
  out += `时间范围：${fmt(c.messages[0].ts, "YYYY-M-D")} ~ ${fmt(c.messages[c.messages.length - 1].ts, "YYYY-M-D")}\n`;
  let day = "";
  for (const m of c.messages) {
    const d = fmt(m.ts, "YYYY-M-D");
    if (d !== day) {
      out += `\n\n—————  ${d}  —————\n`;
      day = d;
    }
    const content = m.kind === "sticker" ? "[动画表情]" : wxCliSnippet(m);
    const name = m.kind === "recall" || m.kind === "system" ? c.title : m.sender;
    const sender = name === c.self ? name : `${name}（${c.ids[name]}）`;
    out += `\n${sender} ${fmt(m.ts, "HH:mm")}\n${content}\n`;
  }
  return out;
}

const LEGACY_TYPE: Record<DemoKind, string> = {
  text: "文本",
  image: "图片",
  voice: "语音",
  video: "视频",
  sticker: "表情",
  file: "链接/文件",
  link: "链接/文件",
  transfer: "链接/文件",
  recall: "撤回",
  system: "系统",
};

function legacyContent(m: DemoMessage, localId: number): string {
  switch (m.kind) {
    case "text":
      return m.text;
    case "image":
      return `[图片] local_id=${localId}`;
    case "voice":
      return "[语音]";
    case "video":
      return "[视频]";
    case "sticker":
      return "[表情]";
    case "file":
      return `[文件] ${m.text}`;
    case "link":
      return `[链接] ${m.text}`;
    case "transfer":
      return m.text.startsWith("红包") ? "[链接/文件]" : `[链接/文件] ${m.text}`;
    case "recall":
      return `[撤回] "${m.sender}" 撤回了一条消息`;
    case "system":
      return `[系统] ${m.text}`;
  }
}

function legacySender(c: Conversation, m: DemoMessage): string {
  if (m.kind === "recall" || m.kind === "system") return "";
  if (!c.isGroup && m.sender !== c.self) return "";
  return m.sender;
}

/** wx-cli-again 0.6 `export --format json` (History response). */
export function writeWxCliLegacyJson(c: Conversation): string {
  const messages = c.messages.map((m, i) => {
    const [code, sub] = WX_CLI_TYPE[m.kind];
    const row: Record<string, unknown> = {
      timestamp: sec(m.ts),
      time: fmt(m.ts, "YYYY-MM-DD HH:mm"),
      sender: legacySender(c, m),
      content: legacyContent(m, 100 + i),
      type: LEGACY_TYPE[m.kind],
      local_id: 100 + i,
      type_code: code,
    };
    if (code === 49)
      row.appmsg_type = m.kind === "transfer" && m.text.startsWith("红包") ? 2001 : sub;
    return row;
  });
  const root = {
    chat: c.title,
    username: c.ids[c.title],
    is_group: c.isGroup,
    chat_type: c.isGroup ? "group" : "private",
    count: messages.length,
    messages,
    meta: {},
  };
  return JSON.stringify(root, null, 2) + "\n";
}

/** wx-cli-again 0.6 `export --format markdown` (the CLI default). */
export function writeWxCliMarkdown(c: Conversation): string {
  const lines = [
    `# ${c.title}${c.isGroup ? "（群聊）" : ""}`,
    `\n> 导出 ${c.messages.length} 条消息\n`,
  ];
  c.messages.forEach((m, i) => {
    const sender = legacySender(c, m);
    const content = legacyContent(m, 100 + i).replace(/\n/g, "\n> ");
    lines.push(
      `### ${fmt(m.ts, "YYYY-MM-DD HH:mm")}\n\n${sender ? `**${sender}**: ` : ""}${content}\n`,
    );
  });
  return lines.join("\n");
}

// ---------- Generic ----------

function csvCell(s: string): string {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function writeGenericCsv(c: Conversation): string {
  const lines = ["时间,发送者,内容"];
  for (const m of c.messages) {
    if (m.kind === "recall" || m.kind === "system") continue;
    lines.push(
      [fmt(m.ts, "YYYY-MM-DD HH:mm:ss"), m.sender, m.kind === "text" ? m.text : placeholder(m)]
        .map(csvCell)
        .join(","),
    );
  }
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

export function writeGenericJson(c: Conversation): string {
  const rows = c.messages
    .filter((m) => m.kind !== "recall" && m.kind !== "system")
    .map((m) => ({
      time: fmt(m.ts, "YYYY-MM-DD HH:mm:ss"),
      sender: m.sender,
      text: m.kind === "text" ? m.text : placeholder(m),
    }));
  return JSON.stringify(rows, null, 2) + "\n";
}
