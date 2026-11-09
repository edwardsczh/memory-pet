import type { RedactionKind } from "../model";

export const REDACTION_LABELS: Record<RedactionKind, string> = {
  phone: "[手机号]",
  idcard: "[身份证号]",
  bankcard: "[银行卡号]",
  email: "[邮箱]",
  address: "[地址]",
  password: "[密码]",
};

export interface RedactResult {
  text: string;
  counts: Partial<Record<RedactionKind, number>>;
}

const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const ID_CHECK = "10X98765432";

/** GB 11643 check digit plus a plausible birth date. */
export function isValidIdCard(id: string): boolean {
  if (!/^\d{17}[\dXx]$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += +id[i] * ID_WEIGHTS[i];
  if (ID_CHECK[sum % 11] !== id[17].toUpperCase()) return false;
  const y = +id.slice(6, 10);
  const m = +id.slice(10, 12);
  const d = +id.slice(12, 14);
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = +digits[i];
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

const SECRET_KEYWORDS = String.raw`(?:支付密码|银行卡密码|登录密码|取款密码|开机密码|锁屏密码|门禁密码|wifi密码|WiFi密码|密码|口令|暗号|验证码|校验码|动态码|短信码|取件码|提取码|PIN码?|pin码?|password|passwd|pwd|passcode|code)`;

interface Rule {
  kind: RedactionKind;
  re: RegExp;
  /** Returns the replacement, or null to leave the match untouched. */
  replace: (match: string, groups: string[]) => string | null;
}

const ADDR_STOP = "在我你他她它家住是到去寄的了和发给送从往就也都要想说吧呢啊哦嗯把被让叫来回";
const ADDR_CHAR = String.raw`(?:(?![${ADDR_STOP}])[\u4e00-\u9fa5])`;
const ADDR_REGION = String.raw`(?:${ADDR_CHAR}{1,7}(?:省|自治区|特别行政区|市|自治州|州|盟|区|县|旗|镇|乡|街道))`;
const ADDR_ROAD = String.raw`(?:${ADDR_CHAR}|[A-Za-z0-9]){0,12}?${ADDR_CHAR}(?:路|街|大道|大街|巷|弄|胡同)`;
const ADDR_NUM = String.raw`[0-9一二三四五六七八九十百零〇]+`;
const ADDR_UNIT = String.raw`(?:${ADDR_NUM}|[A-Za-z])+(?:号楼|号院|栋|幢|座|单元|楼|层|室|号|户|门)`;
const ADDR_TAIL = String.raw`(?:${ADDR_CHAR}{0,10}?${ADDR_UNIT}){0,4}(?:[-\s]?\d{2,4}(?:室|号)?)?`;
const ADDR_ESTATE = String.raw`${ADDR_CHAR}{2,10}(?:小区|花园|家园|公寓|大厦|苑|园|府|广场|新村|村|宿舍)`;

const RULES: Rule[] = [
  {
    kind: "password",
    re: new RegExp(
      String.raw`(${SECRET_KEYWORDS})(\s*(?:是|为|:|：|=|就是|改成了?|设成了?)?\s*)([A-Za-z0-9!@#$%^&*._+\-]{4,32})`,
      "gi",
    ),
    replace: (_m, [kw, sep, secret]) => {
      if (/^code$/i.test(kw) && !/\d/.test(secret)) return null;
      if (!/\d/.test(secret) && secret.length < 6 && !sep.trim()) return null;
      return `${kw}${sep}${REDACTION_LABELS.password}`;
    },
  },
  {
    kind: "password",
    re: new RegExp(
      String.raw`(?<![\dA-Za-z])(\d{4,8})(\s*(?:是|为|就是)?\s*(?:你的|您的|我的)?(?:验证码|校验码|动态码|取件码))`,
      "g",
    ),
    replace: (_m, [, rest]) => `${REDACTION_LABELS.password}${rest}`,
  },
  {
    kind: "email",
    re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    replace: () => REDACTION_LABELS.email,
  },
  {
    kind: "idcard",
    re: /(?<![\dA-Za-z])(\d{6})[\s-]?(\d{4})[\s-]?(\d{4})[\s-]?(\d{3}[\dXx])(?![\dA-Za-z])/g,
    replace: (_m, g) => (isValidIdCard(g.join("")) ? REDACTION_LABELS.idcard : null),
  },
  {
    kind: "bankcard",
    re: /(?<!\d)(?:\d[ -]?){15,18}\d(?!\d)/g,
    replace: (m) => {
      const digits = m.replace(/[\s-]/g, "");
      if (digits.length < 16 || digits.length > 19) return null;
      return luhnValid(digits) ? REDACTION_LABELS.bankcard : null;
    },
  },
  {
    kind: "phone",
    re: /(?<![\d])(?:(?:\+|00)?86[\s-]?)?1[3-9]\d(?:[\s-]?\d{4}){2}(?![\d])/g,
    replace: () => REDACTION_LABELS.phone,
  },
  {
    kind: "phone",
    re: /(?<![\d])(?:\(0\d{2,3}\)|0\d{2,3}-)\s?\d{7,8}(?:-\d{1,4})?(?![\d])/g,
    replace: () => REDACTION_LABELS.phone,
  },
  {
    kind: "address",
    re: /(?:收货地址|收件地址|家庭住址|详细地址|住址|地址)(\s*(?:是|为|在|:|：)\s*)([^\n，,。！!？?；;~～]{4,60})/g,
    replace: (m, [sep]) => `${m.slice(0, m.indexOf(sep))}${sep}${REDACTION_LABELS.address}`,
  },
  {
    kind: "address",
    re: new RegExp(
      String.raw`${ADDR_REGION}{0,4}${ADDR_ROAD}(?:${ADDR_NUM}段)?${ADDR_NUM}(?:号|弄)${ADDR_TAIL}`,
      "g",
    ),
    replace: () => REDACTION_LABELS.address,
  },
  {
    kind: "address",
    re: new RegExp(String.raw`${ADDR_REGION}{0,4}${ADDR_ESTATE}${ADDR_UNIT}${ADDR_TAIL}`, "g"),
    replace: () => REDACTION_LABELS.address,
  },
  {
    kind: "address",
    re: new RegExp(String.raw`${ADDR_REGION}{2,4}${ADDR_CHAR}{2,12}?${ADDR_UNIT}${ADDR_TAIL}`, "g"),
    replace: () => REDACTION_LABELS.address,
  },
];

const ANY_HINT = /[\d@]|路|街|巷|弄|号|栋|室|小区|地址|住址/;

/** Replaces phone numbers, ID / bank card numbers, emails, street addresses and secrets with labels. */
export function redact(text: string): RedactResult {
  const counts: Partial<Record<RedactionKind, number>> = {};
  if (!ANY_HINT.test(text)) return { text, counts };
  let out = text;
  for (const rule of RULES) {
    out = out.replace(rule.re, (match: string, ...args: unknown[]) => {
      const groups = args.slice(0, -2).map((g) => (typeof g === "string" ? g : ""));
      const replacement = rule.replace(match, groups);
      if (replacement === null) return match;
      counts[rule.kind] = (counts[rule.kind] ?? 0) + 1;
      return replacement;
    });
  }
  return { text: out, counts };
}
