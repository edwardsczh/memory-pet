/**
 * Legacy QQ 消息管理器 exports (QQ 2011–QQ 9 PC):
 *
 * - TXT: preamble "消息记录（此消息记录为文本格式，不支持重新导入）", "消息分组:…",
 *   "消息对象:…" between "====" rules, then per message a header line
 *   "2015-03-01 12:00:00 昵称(QQ号)" (or "昵称<邮箱>", or a bare nickname for
 *   the account owner) followed by the content line(s).
 * - MHT: MIME multipart whose HTML part is one <table>; a row per day
 *   ("日期: 2015-03-01") and a row per message
 *   `<div><div style=float:left>昵称</div>12:00:00</div><div>内容</div>`.
 *   Embedded images become "[图片]".
 *
 * NTQQ JSON exported by chatlog-keeper is handled by the chatlog-keeper adapter.
 */
import type { ParsedImport } from "../../model";
import { type ParseOptions, type RawMessage, buildImport } from "../build";
import { DEFAULT_TZ_OFFSET_MINUTES, civilToEpoch, parseDate, parseTimeOfDay } from "../time";
import { parseLines } from "./plainText";

const QQ_ID_SUFFIX = /\s*(?:\((\d{5,12})\)|<([^<>\s]+@[^<>\s]+)>)$/;
const SYSTEM_SENDERS = new Set(["系统消息", "系统提示"]);

export function isQQTxt(content: string): boolean {
  const head = content.slice(0, 2000);
  if (/消息记录（此消息记录为文本格式/.test(head)) return true;
  if (/^消息对象[:：]/m.test(head) && /^={20,}$/m.test(head)) return true;
  const headers = head.match(
    /^\d{4}-\d{1,2}-\d{1,2} \d{1,2}:\d{2}:\d{2} .+?(?:\(\d{5,12}\)|<[^<>\s]+@[^<>\s]+>)$/gm,
  );
  return (headers?.length ?? 0) >= 2;
}

function qqSender(raw: string): { sender: string; system: boolean; hasId: boolean } {
  const name = raw.replace(QQ_ID_SUFFIX, "").trim() || raw.trim();
  return {
    sender: name,
    system: SYSTEM_SENDERS.has(name) || /\(10000\)$/.test(raw),
    hasId: QQ_ID_SUFFIX.test(raw),
  };
}

/** The manager shows the account owner by bare nickname and everyone else with a QQ number / email. */
function inferSelf(
  senders: { sender: string; system: boolean; hasId: boolean }[],
): string | undefined {
  const bare = new Set<string>();
  let withId = 0;
  for (const s of senders) {
    if (s.system) continue;
    if (s.hasId) withId++;
    else bare.add(s.sender);
  }
  return bare.size === 1 && withId > 0 ? [...bare][0] : undefined;
}

function qqMeta(text: string): { title?: string; isGroup?: boolean } {
  const title = /消息对象[:：]\s*(.+?)\s*(?:<|$)/m.exec(text)?.[1];
  const group = /消息分组[:：]\s*(.+?)\s*(?:<|$)/m.exec(text)?.[1];
  return { title, isGroup: group ? /群/.test(group) : undefined };
}

export function parseQQTxt(content: string, opts: ParseOptions): ParsedImport {
  const { rows, warnings } = parseLines(content.split(/\r?\n/), opts, "headerLine");
  const senders = rows.map((r) => qqSender(r.sender));
  const out = rows.map((r, i) => ({
    ...r,
    sender: senders[i].sender,
    kind: senders[i].system ? ("system" as const) : undefined,
  }));
  const meta = qqMeta(content.slice(0, 2000));
  return buildImport("qq-txt", out, { ...meta, warnings, selfSender: inferSelf(senders) });
}

export function isQQMht(fileName: string, content: string): boolean {
  if (/\.mht(ml)?$/i.test(fileName)) return true;
  const head = content.slice(0, 4000);
  return (
    /^MIME-Version:/im.test(head) && /multipart\/related/i.test(head) && /<html/i.test(content)
  );
}

/** Pulls the HTML part out of an MHT file, decoding quoted-printable / base64 bodies. */
export function extractMhtHtml(content: string): string {
  const boundary = /boundary="?([^";\r\n]+)"?/i.exec(content)?.[1];
  const parts = boundary ? content.split(`--${boundary}`) : [content];
  for (const part of parts) {
    const split = part.search(/\r?\n\r?\n/);
    if (split < 0) continue;
    const headers = part.slice(0, split);
    if (boundary && !/content-type:\s*text\/html/i.test(headers)) continue;
    const body = part.slice(split).trim();
    const enc = /content-transfer-encoding:\s*([\w-]+)/i.exec(headers)?.[1]?.toLowerCase();
    if (enc === "quoted-printable") return decodeQuotedPrintable(body);
    if (enc === "base64") return decodeBase64Utf8(body);
    return body;
  }
  const html = /<html[\s\S]*<\/html>/i.exec(content);
  return html ? html[0] : content;
}

function decodeQuotedPrintable(s: string): string {
  const joined = s.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < joined.length; i++) {
    const c = joined[i];
    if (c === "=" && /^[0-9A-F]{2}$/i.test(joined.slice(i + 1, i + 3))) {
      bytes.push(parseInt(joined.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      const code = c.charCodeAt(0);
      if (code < 128) bytes.push(code);
      else bytes.push(...new TextEncoder().encode(c));
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function decodeBase64Utf8(s: string): string {
  const bin = atob(s.replace(/\s+/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>|<\/(div|p|tr)>/gi, "\n")
    .replace(/<img\b[^>]*>/gi, "[图片]")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code =
          e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .trim();
}

const ROW_RE = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
const MSG_RE =
  /<div[^>]*>\s*<div[^>]*float\s*:\s*left[^>]*>([\s\S]*?)<\/div>\s*([^<]*?)\s*<\/div>\s*<div[^>]*>([\s\S]*)<\/div>/i;
const DATE_RE = /日期[:：]\s*(\d{4}-\d{1,2}-\d{1,2})/;

export function parseQQMht(content: string, opts: ParseOptions): ParsedImport {
  const html = extractMhtHtml(content);
  const rows: RawMessage[] = [];
  let date = null as ReturnType<typeof parseDate>;
  let missingDate = 0;
  const senders: ReturnType<typeof qqSender>[] = [];
  for (const m of html.matchAll(ROW_RE)) {
    const cell = m[1];
    const dm = DATE_RE.exec(cell);
    if (dm && !MSG_RE.test(cell)) {
      date = parseDate(dm[1]);
      continue;
    }
    const mm = MSG_RE.exec(cell);
    if (!mm) continue;
    const when = htmlToText(mm[2]);
    const tod = parseTimeOfDay(when.replace(/^\d{4}-\d{1,2}-\d{1,2}\s+/, ""));
    const d = parseDate(when) ?? date;
    if (tod === null || !d) {
      missingDate++;
      continue;
    }
    const info = qqSender(htmlToText(mm[1]));
    const { sender, system } = info;
    senders.push(info);
    rows.push({
      ts: civilToEpoch(d, tod, opts.tzOffsetMinutes ?? DEFAULT_TZ_OFFSET_MINUTES),
      sender,
      text: htmlToText(mm[3]),
      kind: system ? "system" : undefined,
    });
  }
  const warnings = missingDate ? [`${missingDate} 条消息缺少日期或时间，已跳过`] : [];
  return buildImport("qq-mht", rows, {
    ...qqMeta(htmlToText(html.slice(0, 6000))),
    warnings,
    selfSender: inferSelf(senders),
  });
}
