import type { PetReply, StyleProfile } from "../model";
import { charLength } from "../text/chars";

export interface PostprocessOptions {
  /** Messages longer than this are split at punctuation. Default derived from the profile. */
  maxChars?: number;
  /** Cap on bubbles per reply. Default derived from the profile. */
  maxBurst?: number;
  /** Strip a single trailing "。" when TA rarely uses it. Default: periodRate < 0.15. */
  dropPeriods?: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function defaultMaxChars(profile?: StyleProfile): number {
  if (!profile || profile.messageCount === 0) return 60;
  return clamp(Math.round(Math.max(profile.medianLength * 3, profile.avgLength * 2)), 16, 80);
}

export function defaultMaxBurst(profile?: StyleProfile): number {
  if (!profile || profile.messageCount === 0) return 4;
  return clamp(Math.ceil(profile.avgBurst * 2), 2, 6);
}

/** Split at sentence ends first, then at commas; commas at a split point are dropped. */
export function splitLong(text: string, maxChars: number): string[] {
  if (charLength(text) <= maxChars) return [text];
  const sentences = text.match(/[^。！？!?～~；;…\n]+[。！？!?～~；;…]*/g) ?? [text];
  const pieces: string[] = [];
  for (const s of sentences) {
    if (charLength(s) <= maxChars) {
      pieces.push(s);
      continue;
    }
    const clauses = s.split(/[，,、]/).filter((c) => c.trim());
    for (const c of clauses) {
      const chars = Array.from(c);
      for (let i = 0; i < chars.length; i += maxChars)
        pieces.push(chars.slice(i, i + maxChars).join(""));
    }
  }
  const out: string[] = [];
  for (const p of pieces.map((x) => x.trim()).filter(Boolean)) {
    const last = out[out.length - 1];
    if (
      last !== undefined &&
      charLength(last) + 1 + charLength(p) <= maxChars &&
      !/[。！？!?～~…]$/.test(last)
    ) {
      out[out.length - 1] = `${last}，${p}`;
    } else {
      out.push(p);
    }
  }
  return out;
}

function joinTwo(a: string, b: string): string {
  return /[\p{P}\p{S}\s]$/u.test(a) ? `${a}${b}` : `${a}，${b}`;
}

/** Merge the shortest adjacent pair until within `max`. */
function capBurst(messages: string[], max: number): string[] {
  const out = messages.slice();
  while (out.length > max) {
    let best = 0;
    let bestLen = Infinity;
    for (let i = 0; i + 1 < out.length; i++) {
      const len = charLength(out[i]) + charLength(out[i + 1]);
      if (len < bestLen) {
        bestLen = len;
        best = i;
      }
    }
    out.splice(best, 2, joinTwo(out[best], out[best + 1]));
  }
  return out;
}

/** Reshape the parsed reply to TA's habits. Safety replies are only split into lines. */
export function postprocess(
  reply: PetReply,
  profile?: StyleProfile,
  opts: PostprocessOptions = {},
): PetReply {
  let messages = reply.messages
    .flatMap((m) => m.split(/\r?\n/))
    .map((m) => m.trim())
    .filter(Boolean);
  if (reply.safety) return { ...reply, messages };

  const dropPeriods =
    opts.dropPeriods ?? (profile ? profile.messageCount > 0 && profile.periodRate < 0.15 : false);
  const maxChars = opts.maxChars ?? defaultMaxChars(profile);
  const maxBurst = opts.maxBurst ?? defaultMaxBurst(profile);

  messages = messages.flatMap((m) => splitLong(m, maxChars));
  if (dropPeriods) messages = messages.map((m) => m.replace(/(?<!。)。$/, "")).filter(Boolean);
  messages = capBurst(messages, maxBurst);
  return { ...reply, messages };
}

export interface TypingOptions {
  minMs?: number;
  maxMs?: number;
}

/**
 * Delay before showing a bubble, as if TA were typing it. Scaled so a message of TA's median
 * length takes about 1.5 s; deterministic so callers can add their own jitter.
 */
export function typingDelayMs(
  text: string,
  profile?: StyleProfile,
  opts: TypingOptions = {},
): number {
  const minMs = opts.minMs ?? 500;
  const maxMs = opts.maxMs ?? 5000;
  const median = profile && profile.medianLength > 0 ? profile.medianLength : 8;
  const perChar = clamp(1500 / Math.max(median, 4), 60, 250);
  return Math.round(clamp(300 + charLength(text) * perChar, minMs, maxMs));
}
