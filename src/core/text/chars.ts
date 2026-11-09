/** Character-level helpers shared by persona statistics, retrieval and dialogue post-processing. */

const EMOJI_RE =
  /\p{Extended_Pictographic}(?:\uFE0F|\u20E3|[\u{1F3FB}-\u{1F3FF}]|\u200D\p{Extended_Pictographic}\uFE0F?)*/gu;

/** Bracketed tokens that look like WeChat emoji codes but are media / system placeholders. */
const NON_EMOJI_CODES = new Set([
  "图片",
  "语音",
  "视频",
  "文件",
  "链接",
  "表情",
  "动画表情",
  "位置",
  "红包",
  "转账",
  "撤回",
  "名片",
  "小程序",
  "音乐",
  "聊天记录",
  "通话",
  "视频通话",
  "语音通话",
  "拍一拍",
  "其他",
]);

const REDACTION_WORDS = [
  "手机号",
  "电话",
  "身份证",
  "银行卡",
  "卡号",
  "邮箱",
  "地址",
  "密码",
  "已脱敏",
  "脱敏",
  "已隐藏",
  "REDACTED",
  "PHONE",
  "IDCARD",
  "BANKCARD",
  "EMAIL",
  "ADDRESS",
  "PASSWORD",
];

const WECHAT_CODE_RE = /\[([\u4e00-\u9fa5A-Za-z]{1,6})\]/g;

/**
 * Redaction placeholders as the cleaner may write them: "[手机号]", "[已脱敏:邮箱]", "<PHONE>",
 * "【地址已隐藏】". Kept broad on purpose — dropping a few genuine pairs is cheaper than
 * teaching the model to say "[手机号]".
 */
const REDACTION_RE = new RegExp(
  `[\\[【<{](?:[^\\]】>}]{0,8})(?:${REDACTION_WORDS.join("|")})(?:[^\\]】>}]{0,8})[\\]】>}]`,
  "i",
);

export function isRedacted(text: string): boolean {
  return REDACTION_RE.test(text);
}

/** Length in user-perceived characters (code points), not UTF-16 units. */
export function charLength(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0xdc00 || c > 0xdfff) n++;
  }
  return n;
}

/** Unicode emoji and WeChat emoji codes such as "[微笑]", in order of appearance. */
export function extractEmojis(text: string): string[] {
  const found: { at: number; token: string }[] = [];
  for (const m of text.matchAll(EMOJI_RE)) found.push({ at: m.index ?? 0, token: m[0] });
  for (const m of text.matchAll(WECHAT_CODE_RE)) {
    if (!NON_EMOJI_CODES.has(m[1]) && !isRedacted(m[0])) {
      found.push({ at: m.index ?? 0, token: m[0] });
    }
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.token);
}

export function stripEmojis(text: string): string {
  return text
    .replace(EMOJI_RE, " ")
    .replace(WECHAT_CODE_RE, (m, code: string) => (NON_EMOJI_CODES.has(code) ? m : " "));
}

const PUNCT_RE = /[\p{P}\p{S}\s]/gu;

/** True if nothing but emoji, punctuation and whitespace is left. */
export function isEmojiOnly(text: string): boolean {
  return stripEmojis(text).replace(PUNCT_RE, "") === "";
}

/** Text with emoji, punctuation and whitespace removed — "substance" length checks. */
export function contentChars(text: string): string {
  return stripEmojis(text).replace(PUNCT_RE, "");
}

export function isCjk(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return (
    (c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf) || (c >= 0xf900 && c <= 0xfaff)
  );
}

/** Rough token count for Chinese-heavy text (≈0.6 token per CJK char, ≈0.3 per other char). */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (isCjk(ch)) cjk++;
    else other++;
  }
  return Math.ceil(cjk * 0.6 + other * 0.3);
}
