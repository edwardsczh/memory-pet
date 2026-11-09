export interface Hotline {
  name: string;
  /** Number as dialed, digits and dashes only. */
  number: string;
  /** Alternative number, e.g. for landlines. */
  alt?: { label: string; number: string };
  note?: string;
}

/**
 * Crisis hotlines shown in crisis replies and the CrisisCard.
 *
 * Verified 2026-11-09:
 * - 12356: 国家卫生健康委统一心理援助热线，2025-05-01 起全国 31 个省份开通。
 *   https://www.news.cn/20250508/41e0836a641449099f4a218a84122d94/c.html
 *   http://www.legaldaily.com.cn/sylm/content/2026-01/06/content_9319733.html
 * - 北京市心理援助热线（北京心理危机研究与干预中心 / 回龙观医院）：手机 010-82951332，座机 800-810-1117。
 *   https://www.crisis.org.cn/lists/44.html
 * - 希望24热线 400-161-9995（7×24 小时生命危机干预）。
 *   http://www.hope9995.com/
 *
 * Re-verify before each release; see docs/safety.md.
 */
export const HOTLINES_VERIFIED_AT = "2026-11-09";

export const HOTLINES: readonly Hotline[] = [
  { name: "全国心理援助热线", number: "12356", note: "24 小时，国家卫健委统一号码" },
  {
    name: "北京市心理援助热线",
    number: "010-82951332",
    alt: { label: "座机", number: "800-810-1117" },
    note: "24 小时，北京心理危机研究与干预中心",
  },
  { name: "希望24热线", number: "400-161-9995", note: "24 小时生命危机干预" },
];

export const EMERGENCY_NUMBERS: readonly Hotline[] = [
  { name: "急救", number: "120" },
  { name: "报警", number: "110" },
];
