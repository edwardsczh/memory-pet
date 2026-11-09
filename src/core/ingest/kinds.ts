import type { MessageKind } from "../model";

/**
 * WeChat 4.x `local_type`: lower 32 bits are the base type, upper 32 bits the
 * appmsg sub-type. Codes follow wx-cli `fmt_type` and chatlog-keeper
 * `_WX_MSG_TYPE_*`.
 */
export function wechatKind(localType: number, subType?: number, content = ""): MessageKind {
  const base = localType % 2 ** 32;
  const sub = subType ?? Math.floor(localType / 2 ** 32);
  switch (base) {
    case 1:
      return "text";
    case 3:
      return "image";
    case 34:
      return "voice";
    case 43:
      return "video";
    case 47:
      return "sticker";
    case 42: // 名片
    case 48: // 位置
    case 50: // 语音/视频通话
      return "other";
    case 49:
      return appmsgKind(sub || appmsgSubType(content));
    case 51:
    case 10000:
    case 10002:
      return "system";
    default:
      return "other";
  }
}

/** appmsg `<type>`: 57 quote, 6 file, 2000 transfer, 2001/2003 red packet, 62 pat. */
export function appmsgKind(sub: number): MessageKind {
  if (sub === 57 || sub === 1) return "text";
  if (sub === 6 || sub === 74) return "file";
  if (sub === 2000 || sub === 2001 || sub === 2003) return "transfer";
  if (sub === 8) return "sticker";
  if (sub === 2) return "image";
  if (sub === 62) return "system";
  return "link";
}

export function appmsgSubType(xml: string): number {
  const m = /<appmsg[\s\S]*?<type>\s*(\d+)\s*<\/type>/.exec(xml);
  return m ? +m[1] : 0;
}

/** Text of a quote-reply appmsg (`<appmsg><title>reply</title>…<refermsg>`). */
export function appmsgTitle(xml: string): string {
  const m = /<appmsg[\s\S]*?<title>([\s\S]*?)<\/title>/.exec(xml);
  return m ? decodeXmlText(m[1]) : "";
}

function decodeXmlText(s: string): string {
  return s
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

interface PlaceholderRule {
  re: RegExp;
  kind: MessageKind;
}

// Whole-message placeholders written by the supported exporters. Rules that
// carry a title (links, files) only need the prefix.
const PLACEHOLDERS: PlaceholderRule[] = [
  { re: /^\[(图片|image|照片|闪照)(?:[:：\s][^\]]*)?\](?:\s*local_id=\d+)?$/i, kind: "image" },
  {
    re: /^\[(语音|voice)(?:[:：\s][^\]]*)?\](?:\s*\d+(?:\.\d+)?\s*(?:s|秒|"|″))?$/i,
    kind: "voice",
  },
  { re: /^\[(视频|video|小视频)(?:[:：\s][^\]]*)?\]$/i, kind: "video" },
  {
    re: /^\[(表情|动画表情|emoji|sticker|自定义表情|超级表情|GIF表情)[\]:：#\s]/i,
    kind: "sticker",
  },
  { re: /^\[(?:微信|QQ)?(红包|转账|收款|QQ红包)\]?/, kind: "transfer" },
  { re: /^\[(文件|file)(?:[:：\s][^\]]*)?\]/i, kind: "file" },
  {
    re: /^\[(链接|link|小程序|视频号|卡片|公众号|音乐|分享|合并转发|聊天记录|合并聊天记录|链接\/文件|链接\/文件\/小程序)[\]|:：\s]/i,
    kind: "link",
  },
  {
    re: /^\[(系统|system|系统消息|系统提示|revoke|撤回|撤回消息|拍一拍|戳一戳|回应)[\]:：\s]/i,
    kind: "system",
  },
  { re: /^\[(位置|location|名片|通话|语音通话|视频通话|type=\d+)[\]:：\s]/i, kind: "other" },
];

const ATTACHMENT_LABEL: Record<string, MessageKind> = {
  图片: "image",
  语音: "voice",
  视频: "video",
  文件: "file",
};

// Notices that exporters write as ordinary text lines.
const SYSTEM_TEXT: RegExp[] = [
  /撤回了一条(消息|成员消息)$/,
  /^(你|对方)?拍了拍/,
  /^"?.{1,30}"?\s*拍了拍\s*.{0,30}$/,
  /^.{0,30}戳了戳.{0,30}$/,
  /^以上是打招呼的内容$/,
  /^你已添加了.+，现在可以开始聊天了。?$/,
  /^(你|.{1,30})邀请.{1,60}加入了群聊/,
  /^.{1,30}(加入了群聊|退出了群聊|移出了群聊|修改群名为)/,
  /^收到红包，请在手机上查看$/,
  /^你领取了.{0,30}的红包$/,
  /^.{1,30}领取了你的红包$/,
  /^(此消息为系统消息|消息已发出，但被对方拒收了)/,
];

/** Maps exporter placeholders like "[图片]" or "[转账] ¥520" to a kind; "text" when none applies. */
export function kindFromText(text: string): MessageKind {
  const t = text.trim();
  if (!t) return "text";
  if (t.startsWith("[")) {
    for (const rule of PLACEHOLDERS) if (rule.re.test(t)) return rule.kind;
  }
  if (t.startsWith("<") && /<(msg|appmsg|sysmsg)\b/.test(t)) return xmlKind(t);
  // wx-cli 0.7 TXT with media: "图片1（可在附件中查看）"
  const att = /^(图片|语音|视频|文件)\d+（可在附件中查看）/.exec(t);
  if (att) return ATTACHMENT_LABEL[att[1]];
  for (const re of SYSTEM_TEXT) if (re.test(t)) return "system";
  return "text";
}

/** Raw WeChat XML content (WeChatExporter keeps it for appmsg and system rows). */
function xmlKind(xml: string): MessageKind {
  if (/<sysmsg\b/.test(xml)) return "system";
  if (/<appmsg\b/.test(xml)) return appmsgKind(appmsgSubType(xml));
  if (/<img\b/.test(xml)) return "image";
  if (/<emoji\b/.test(xml)) return "sticker";
  if (/<videomsg\b/.test(xml)) return "video";
  if (/<voicemsg\b/.test(xml)) return "voice";
  return "other";
}

/** Strips quote prefixes some exporters prepend ("[引用 张三: …] 回复") and returns the reply text. */
export function stripQuote(text: string): string {
  const m = /^\[引用(?:[^\]]*)\]\s*/.exec(text);
  if (!m) return text;
  const rest = text.slice(m[0].length).split(/\n\s*↳/)[0];
  return rest.trim() || text;
}

export const PLACEHOLDER_TEXT: Partial<Record<MessageKind, string>> = {
  image: "[图片]",
  voice: "[语音]",
  video: "[视频]",
  sticker: "[表情]",
  file: "[文件]",
  link: "[链接]",
  transfer: "[转账]",
  system: "[系统消息]",
  other: "[其他消息]",
};
