/**
 * Line-oriented parser for pasted / exported text logs. Supported header shapes:
 *
 * - bracket:        `[2024/1/2 21:03:05] 小鹿：内容`  (also WeChatExporter / wx-cli legacy TXT)
 * - inline:         `2024-01-02 21:03 小鹿: 内容`
 * - bracketTime:    `[21:03] 小鹿: 内容`              (date from separator lines)
 * - headerLine:     `2024-01-02 21:03:05 小鹿` + content lines (QQ 消息管理器 TXT)
 * - senderDateTime: `小鹿 2024/1/2 21:03:05` + content lines (WeChat PC copy)
 * - senderTime:     `小鹿 21:03` + content lines      (wx-cli 0.7 TXT, phone copy)
 * - stacked:        a time-only line, then the sender, then the body
 *                   (WeChatMsg / 留痕 TXT and similar backups)
 *
 * The dominant shape is picked once per file so content lines that happen to
 * look like a header of another shape stay content.
 */
import type { ParsedImport } from "../../model";
import { type ParseOptions, type RawMessage, buildImport } from "../build";
import {
  type CivilDate,
  DEFAULT_TZ_OFFSET_MINUTES,
  civilToEpoch,
  parseDate,
  parseDateTime,
  parseTimeOfDay,
} from "../time";

export type LinePattern =
  "bracket" | "inline" | "bracketTime" | "headerLine" | "senderDateTime" | "senderTime";

const DATE = String.raw`\d{4}\s*[-/.年]\s*\d{1,2}\s*[-/.月]\s*\d{1,2}\s*日?`;
const TIME = String.raw`(?:上午|下午|晚上|凌晨|中午)?\s*\d{1,2}[:：]\d{2}(?:[:：]\d{2})?`;
const DATETIME = String.raw`${DATE}(?:[T\s]+|\s*)${TIME}`;

interface PatternDef {
  re: RegExp;
  /** Capture group indexes. */
  when: number;
  sender: number;
  content?: number;
  needsDate: boolean;
}

const PATTERNS: Record<LinePattern, PatternDef> = {
  bracket: {
    re: new RegExp(String.raw`^\[(${DATETIME})\]\s*([^:：\n]{1,40}?)\s*[:：]\s?(.*)$`),
    when: 1,
    sender: 2,
    content: 3,
    needsDate: false,
  },
  inline: {
    re: new RegExp(String.raw`^(${DATETIME})\s+([^\s:：\[][^:：\n]{0,39}?)\s*[:：]\s?(.*)$`),
    when: 1,
    sender: 2,
    content: 3,
    needsDate: false,
  },
  bracketTime: {
    re: new RegExp(String.raw`^\[(${TIME})\]\s*([^:：\n]{1,40}?)\s*[:：]\s?(.*)$`),
    when: 1,
    sender: 2,
    content: 3,
    needsDate: true,
  },
  headerLine: {
    re: new RegExp(String.raw`^(${DATETIME})\s+(\S.{0,59}?)\s*$`),
    when: 1,
    sender: 2,
    needsDate: false,
  },
  senderDateTime: {
    re: new RegExp(String.raw`^(\S.{0,39}?)\s+(${DATETIME})\s*$`),
    when: 2,
    sender: 1,
    needsDate: false,
  },
  senderTime: {
    // A bare "2024-01-02 21:03:05" is a timestamp, not a sender named the date.
    re: new RegExp(String.raw`^(?!\d{4}\s*[-/.年])(\S.{0,39}?)\s+(${TIME})\s*$`),
    when: 2,
    sender: 1,
    needsDate: true,
  },
};

const ORDER: LinePattern[] = [
  "bracket",
  "inline",
  "headerLine",
  "senderDateTime",
  "bracketTime",
  "senderTime",
];

const DATETIME_ONLY = new RegExp(String.raw`^(?:${DATETIME})$`);

function senderOf(line: string): { sender: string; inline: string } | null {
  const s = line.trim();
  if (!s || DATETIME_ONLY.test(s)) return null;
  const labeled = /^(.*?)[:：]\s*(.*)$/.exec(s);
  const name = (labeled ? labeled[1] : s).trim();
  if (!name || name.length > 40 || DATETIME_ONLY.test(name) || /[。！？!?]/.test(name)) return null;
  return { sender: name, inline: labeled ? labeled[2].trim() : "" };
}

/** Backup TXT that puts the time, the sender and the body on separate lines. */
export function detectStacked(lines: string[]): boolean {
  let hits = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!DATETIME_ONLY.test(lines[i].trim())) continue;
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j++;
    if (j < lines.length && senderOf(lines[j])) {
      hits++;
      if (hits >= 2) return true;
    }
  }
  return false;
}

export function parseStacked(
  lines: string[],
  opts: ParseOptions,
): { rows: RawMessage[]; warnings: string[] } {
  const tz = opts.tzOffsetMinutes ?? DEFAULT_TZ_OFFSET_MINUTES;
  const rows: RawMessage[] = [];
  let i = 0;
  while (i < lines.length) {
    const stamp = lines[i].trim();
    if (!DATETIME_ONLY.test(stamp)) {
      i++;
      continue;
    }
    const ts = parseDateTime(stamp, tz);
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j++;
    const who = j < lines.length ? senderOf(lines[j]) : null;
    if (ts === null || !who) {
      i++;
      continue;
    }
    const content: string[] = [];
    if (who.inline) content.push(who.inline);
    let k = j + 1;
    while (k < lines.length && !DATETIME_ONLY.test(lines[k].trim())) {
      content.push(lines[k].replace(/\s+$/, ""));
      k++;
    }
    rows.push({ ts, sender: who.sender, text: content.join("\n").trim() });
    i = k;
  }
  return { rows, warnings: [] };
}

const DECORATED_DATE = new RegExp(
  String.raw`^(?:[—\-=─\s]+|日期[:：]\s*)(${DATE})(?:\s*(?:星期|周).)?[—\-=─\s]*$`,
);
const BARE_DATE = new RegExp(String.raw`^(${DATE})(?:\s*(?:星期|周).)?$`);

export function detectLinePattern(lines: string[]): { pattern: LinePattern; hits: number } | null {
  const sample = lines.filter((l) => l.trim()).slice(0, 400);
  let best: { pattern: LinePattern; hits: number } | null = null;
  for (const pattern of ORDER) {
    const re = PATTERNS[pattern].re;
    let hits = 0;
    for (const l of sample) if (re.test(l.trim())) hits++;
    if (hits > (best?.hits ?? 0)) best = { pattern, hits };
  }
  if (!best) return null;
  return best.hits >= Math.min(2, sample.length) ? best : null;
}

interface Pending {
  ts: number;
  sender: string;
  lines: string[];
}

export function parseLines(
  lines: string[],
  opts: ParseOptions,
  preferred?: LinePattern,
): { rows: RawMessage[]; warnings: string[]; pattern: LinePattern | null } {
  const pattern = preferred ?? detectLinePattern(lines)?.pattern ?? null;
  if (!pattern) return { rows: [], warnings: [], pattern };
  const def = PATTERNS[pattern];
  const tz = opts.tzOffsetMinutes ?? DEFAULT_TZ_OFFSET_MINUTES;
  const rows: RawMessage[] = [];
  const warnings: string[] = [];
  let date: CivilDate | null = null;
  let guessedDate = false;
  let lastTimeOfDay = -1;
  let current: Pending | null = null;

  const flush = () => {
    if (!current) return;
    rows.push({ ts: current.ts, sender: current.sender, text: current.lines.join("\n") });
    current = null;
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const trimmed = line.trim();
    const sep = DECORATED_DATE.exec(trimmed) ?? (def.needsDate ? BARE_DATE.exec(trimmed) : null);
    if (sep) {
      const d = parseDate(sep[1]);
      if (d) {
        flush();
        date = d;
        lastTimeOfDay = -1;
        continue;
      }
    }
    const m = def.re.exec(trimmed);
    if (m) {
      let ts: number | null;
      if (def.needsDate) {
        const tod = parseTimeOfDay(m[def.when]);
        if (!date) {
          date = { y: 2000, m: 1, d: 1 };
          guessedDate = true;
        }
        if (tod !== null && guessedDate && tod < lastTimeOfDay) date = nextDay(date);
        if (tod !== null) lastTimeOfDay = tod;
        ts = tod === null ? null : civilToEpoch(date, tod, tz);
      } else {
        ts = parseDateTime(m[def.when], tz);
      }
      if (ts !== null) {
        flush();
        current = { ts, sender: m[def.sender].trim(), lines: [] };
        if (def.content !== undefined && m[def.content]) current.lines.push(m[def.content]);
        continue;
      }
    }
    if (current) (current as Pending).lines.push(line);
  }
  flush();
  if (guessedDate) warnings.push("记录里没有日期，已按时间先后推算日期，仅相对顺序可靠");
  return { rows, warnings, pattern };
}

function nextDay(d: CivilDate): CivilDate {
  const t = new Date(Date.UTC(d.y, d.m - 1, d.d + 1));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

export function parsePlainText(content: string, opts: ParseOptions): ParsedImport {
  const lines = content.split(/\r?\n/);
  const lined = parseLines(lines, opts);
  if (lined.pattern && lined.rows.length)
    return buildImport("plain-text", lined.rows, { warnings: lined.warnings });
  const stacked = parseStacked(lines, opts);
  return buildImport("plain-text", stacked.rows, { warnings: stacked.warnings });
}
