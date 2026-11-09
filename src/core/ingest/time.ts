/** Exports write wall-clock times without a zone; Chinese apps use UTC+8. */
export const DEFAULT_TZ_OFFSET_MINUTES = 480;

export interface CivilDate {
  y: number;
  m: number;
  d: number;
}

const DATE_RE = /^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/;
const TIME_RE =
  /^(上午|下午|晚上|凌晨|中午)?\s*(\d{1,2})[:：](\d{2})(?:[:：](\d{2}))?(?:\.(\d{1,3}))?/;
const ZONE_RE = /^(Z|[+-]\d{2}:?\d{2})$/;

export function parseDate(text: string): CivilDate | null {
  const m = DATE_RE.exec(text.trim());
  if (!m) return null;
  const date = { y: +m[1], m: +m[2], d: +m[3] };
  return isValidDate(date) ? date : null;
}

/** Parses "H:MM[:SS]" (optionally with 上午/下午) into milliseconds since midnight. */
export function parseTimeOfDay(text: string): number | null {
  const m = TIME_RE.exec(text.trim());
  if (!m) return null;
  let h = +m[2];
  const min = +m[3];
  const s = m[4] ? +m[4] : 0;
  const ms = m[5] ? +m[5].padEnd(3, "0") : 0;
  const period = m[1];
  if ((period === "下午" || period === "晚上") && h < 12) h += 12;
  if (period === "凌晨" && h === 12) h = 0;
  if (h > 23 || min > 59 || s > 59) return null;
  return ((h * 60 + min) * 60 + s) * 1000 + ms;
}

export function civilToEpoch(date: CivilDate, timeMs: number, tzOffsetMinutes: number): number {
  return Date.UTC(date.y, date.m - 1, date.d) + timeMs - tzOffsetMinutes * 60_000;
}

/**
 * Parses a wall-clock date-time string ("2024-01-02 21:03", "2024/1/2 21:03:05",
 * "2024年1月2日 下午9:03", ISO 8601 with or without zone) into epoch ms.
 */
export function parseDateTime(
  text: string,
  tzOffsetMinutes = DEFAULT_TZ_OFFSET_MINUTES,
): number | null {
  const s = text.trim();
  const dm = DATE_RE.exec(s);
  if (!dm) return null;
  const date = { y: +dm[1], m: +dm[2], d: +dm[3] };
  if (!isValidDate(date)) return null;
  let rest = s.slice(dm[0].length).replace(/^[T\s]+/, "");
  const tm = TIME_RE.exec(rest);
  const timeMs = tm ? parseTimeOfDay(tm[0]) : 0;
  if (timeMs === null) return null;
  rest = tm ? rest.slice(tm[0].length).trim() : rest.trim();
  let offset = tzOffsetMinutes;
  if (rest && ZONE_RE.test(rest)) {
    if (rest === "Z") offset = 0;
    else {
      const sign = rest[0] === "-" ? -1 : 1;
      const digits = rest.slice(1).replace(":", "");
      offset = sign * (+digits.slice(0, 2) * 60 + +digits.slice(2));
    }
  }
  return civilToEpoch(date, timeMs, offset);
}

/** Accepts epoch seconds or milliseconds (number or numeric string) or a date-time string. */
export function parseTimestamp(
  value: unknown,
  tzOffsetMinutes = DEFAULT_TZ_OFFSET_MINUTES,
): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value < 1e11 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === "string") {
    const t = value.trim();
    if (/^\d+(\.\d+)?$/.test(t)) return parseTimestamp(Number(t), tzOffsetMinutes);
    return parseDateTime(t, tzOffsetMinutes);
  }
  return null;
}

function isValidDate({ y, m, d }: CivilDate): boolean {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}
