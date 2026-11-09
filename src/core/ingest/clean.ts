import type {
  CleanMessage,
  CleanReport,
  MessageKind,
  ParsedImport,
  Role,
  Session,
  SpeakerMapping,
  Turn,
} from "../model";
import { PLACEHOLDER_TEXT } from "./kinds";
import { redact } from "./redact";

export interface CleanOptions {
  /** Mask phone numbers, ID / bank cards, emails, addresses and secrets. Default true. */
  redact?: boolean;
  /** Idle gap that starts a new session. Default 30. */
  sessionGapMinutes?: number;
  /** Senders that are neither me nor TA: rename to "群友A"… or drop. Default "anonymize". */
  others?: "anonymize" | "drop";
  /** Keep image / voice / video / sticker / file messages as content-free placeholders. Default true. */
  keepMedia?: boolean;
}

export interface CleanResult {
  messages: CleanMessage[];
  sessions: Session[];
  report: CleanReport;
}

const DROPPED_KINDS = new Set<MessageKind>(["system", "transfer", "link", "other"]);
const MEDIA_KINDS = new Set<MessageKind>(["image", "voice", "video", "sticker", "file"]);

export function cleanImport(
  parsed: ParsedImport,
  mapping: SpeakerMapping,
  options: CleanOptions = {},
): CleanResult {
  const doRedact = options.redact ?? true;
  const gapMs = (options.sessionGapMinutes ?? 30) * 60_000;
  const others = options.others ?? "anonymize";
  const keepMedia = options.keepMedia ?? true;

  const me = new Set(mapping.me);
  const ta = new Set(mapping.ta);
  const aliases = new Map<string, string>();
  const aliasOf = (name: string) => {
    let a = aliases.get(name);
    if (!a) {
      a = `群友${letterIndex(aliases.size)}`;
      aliases.set(name, a);
    }
    return a;
  };
  const roleOf = (sender: string): Role =>
    me.has(sender) ? "me" : ta.has(sender) ? "ta" : "other";

  const report: CleanReport = {
    total: parsed.messages.length,
    kept: 0,
    droppedByKind: {},
    redactions: {},
    sessions: 0,
    keptByKind: {},
    duplicates: 0,
    droppedOthers: 0,
  };
  const bump = <K extends string>(rec: Partial<Record<K, number>>, k: K, n = 1) => {
    rec[k] = (rec[k] ?? 0) + n;
  };

  // Every non-me/TA participant gets an alias up front so @mentions resolve even when their messages are dropped.
  for (const p of parsed.participants) if (roleOf(p.sender) === "other") aliasOf(p.sender);
  const byLength = (a: string, b: string) => b.length - a.length;
  const otherNames = [...aliases.keys()].filter((n) => n.length > 0).sort(byLength);
  const keepNames = [...me, ...ta].filter((n) => n.length > 0).sort(byLength);

  const ordered = parsed.messages
    .map((m, i) => ({ m, i }))
    .sort((a, b) => a.m.ts - b.m.ts || a.i - b.i)
    .map(({ m }) => m);

  const seen = new Set<string>();
  const messages: CleanMessage[] = [];
  for (const m of ordered) {
    // Minute-precision sources legitimately repeat ("[图片]" twice in one minute), so only second-precision times dedupe.
    if (m.ts % 60_000 !== 0) {
      const key = `${m.ts}\u0000${m.sender}\u0000${m.kind}\u0000${m.text}`;
      if (seen.has(key)) {
        report.duplicates!++;
        continue;
      }
      seen.add(key);
    }

    if (DROPPED_KINDS.has(m.kind) || (MEDIA_KINDS.has(m.kind) && !keepMedia)) {
      bump(report.droppedByKind, m.kind);
      continue;
    }
    const role = roleOf(m.sender);
    if (role === "other" && others === "drop") {
      report.droppedOthers!++;
      continue;
    }

    let text: string;
    if (m.kind === "text") {
      text = m.text;
      if (doRedact) {
        const r = redact(text);
        text = r.text;
        for (const [k, n] of Object.entries(r.counts))
          bump(report.redactions, k as keyof typeof r.counts, n);
      }
      text = anonymizeMentions(text, otherNames, keepNames, aliasOf);
    } else {
      text = PLACEHOLDER_TEXT[m.kind] ?? "";
      bump(report.keptByKind!, m.kind);
    }

    const out: CleanMessage = {
      id: m.id,
      ts: m.ts,
      sender: role === "other" ? aliasOf(m.sender) : m.sender,
      kind: m.kind,
      text,
      role,
    };
    if (m.replyTo) out.replyTo = m.replyTo;
    messages.push(out);
  }

  const sessions = splitSessions(messages, gapMs);
  report.kept = messages.length;
  report.sessions = sessions.length;
  return { messages, sessions, report };
}

/** Splits time-ordered messages on idle gaps and merges consecutive messages of one sender into turns. */
export function splitSessions(messages: CleanMessage[], gapMs: number): Session[] {
  const sessions: Session[] = [];
  let session: Session | null = null;
  let turn: Turn | null = null;
  let lastSender = "";
  for (const m of messages) {
    if (!session || m.ts - session.end > gapMs) {
      session = { id: `s-${m.ts}`, start: m.ts, end: m.ts, turns: [] };
      sessions.push(session);
      turn = null;
    }
    if (!turn || turn.role !== m.role || lastSender !== m.sender) {
      turn = { role: m.role, messages: [] };
      session.turns.push(turn);
    }
    turn.messages.push(m);
    lastSender = m.sender;
    session.end = m.ts;
  }
  const ids = new Set<string>();
  for (const s of sessions) {
    let id = s.id;
    for (let n = 2; ids.has(id); n++) id = `${s.id}-${n}`;
    s.id = id;
    ids.add(id);
  }
  return sessions;
}

/**
 * Known non-me/TA names are matched by prefix ("@张三你好"); unknown names only
 * when the mention is delimited, as WeChat / QQ insert a space or U+2005 after it.
 */
function anonymizeMentions(
  text: string,
  others: string[],
  keep: string[],
  aliasOf: (name: string) => string,
): string {
  if (!text.includes("@") && !text.includes("＠")) return text;
  return text.replace(
    /(?<![A-Za-z0-9._%+-])[@＠]([^\s@＠\u2005,，。!！?？:：]{1,24})/g,
    (match, tail: string, offset: number, whole: string) => {
      for (const n of keep) if (tail.startsWith(n)) return match;
      for (const n of others)
        if (tail.startsWith(n)) return `@${aliasOf(n)}${tail.slice(n.length)}`;
      const next = whole[offset + match.length];
      if (next === undefined || /[\s\u2005,，。!！?？:：]/.test(next)) return `@${aliasOf(tail)}`;
      return match;
    },
  );
}

function letterIndex(i: number): string {
  let s = "";
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}
