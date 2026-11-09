import type { Exemplar, Session } from "../model";
import { charLength, contentChars, isEmojiOnly, isRedacted } from "../text/chars";
import { textMessages, turnText } from "./sessions";

export interface ExemplarOptions {
  /** Turns before the user's turn to keep as `prior` (0–2). Default 2. */
  contextTurns?: number;
  /** Minimum non-emoji, non-punctuation characters in TA's reply. Default 2. */
  minReplyChars?: number;
  /** Minimum non-emoji, non-punctuation characters in the user's turn. Default 1. */
  minContextChars?: number;
  /** Pairs with a longer reply (pasted articles etc.) are dropped. Default 400. */
  maxReplyChars?: number;
  /** Longer context is cut from the front, keeping the end closest to the reply. Default 300. */
  maxContextChars?: number;
}

function keepEnd(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : "…" + chars.slice(chars.length - max).join("");
}

/** "User turn → TA reply turn" pairs, in session order. Group-chat turns ("other") break pairs. */
export function extractExemplars(sessions: Session[], opts: ExemplarOptions = {}): Exemplar[] {
  const contextTurns = Math.max(0, Math.min(2, opts.contextTurns ?? 2));
  const minReply = opts.minReplyChars ?? 2;
  const minContext = opts.minContextChars ?? 1;
  const maxReply = opts.maxReplyChars ?? 400;
  const maxContext = opts.maxContextChars ?? 300;
  const out: Exemplar[] = [];

  for (const s of sessions) {
    for (let i = 1; i < s.turns.length; i++) {
      const taTurn = s.turns[i];
      const meTurn = s.turns[i - 1];
      if (taTurn.role !== "ta" || meTurn.role !== "me") continue;
      const reply = textMessages(taTurn).map((m) => m.text.trim());
      const context = turnText(meTurn);
      if (reply.length === 0 || !context) continue;

      const replyText = reply.join("\n");
      if (charLength(contentChars(replyText)) < minReply) continue;
      if (charLength(contentChars(context)) < minContext) continue;
      if (charLength(replyText) > maxReply) continue;
      if (reply.every(isEmojiOnly) || isEmojiOnly(context)) continue;
      if (isRedacted(replyText) || isRedacted(context)) continue;

      const prior: NonNullable<Exemplar["prior"]> = [];
      for (let j = i - 2; j >= 0 && prior.length < contextTurns; j--) {
        const t = s.turns[j];
        if (t.role === "other") break;
        const text = turnText(t);
        if (!text) break;
        if (isRedacted(text)) break;
        prior.unshift({ role: t.role, text: keepEnd(text, maxContext) });
      }

      const ex: Exemplar = {
        id: `${s.id}#${i}`,
        sessionId: s.id,
        ts: textMessages(taTurn)[0].ts,
        context: keepEnd(context, maxContext),
        reply,
      };
      if (prior.length > 0) ex.prior = prior;
      out.push(ex);
    }
  }
  return out;
}

/** Deterministic PRNG so the same seed always yields the same split. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Hold out roughly `ratio` of the exemplars for evaluation. Whole sessions go to one side, so
 * held-out replies never share context with training pairs; train is never left empty.
 */
export function splitHoldout(
  exemplars: Exemplar[],
  ratio = 0.08,
  seed = 42,
): { train: Exemplar[]; holdout: Exemplar[] } {
  const bySession = new Map<string, Exemplar[]>();
  for (const e of exemplars) {
    const list = bySession.get(e.sessionId);
    if (list) list.push(e);
    else bySession.set(e.sessionId, [e]);
  }
  const ids = [...bySession.keys()].sort();
  const rand = mulberry32(seed);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const target = Math.round(exemplars.length * ratio);
  const held = new Set<string>();
  let heldCount = 0;
  for (const id of ids) {
    if (heldCount >= target) break;
    const size = bySession.get(id)!.length;
    if (heldCount + size >= exemplars.length) continue;
    held.add(id);
    heldCount += size;
  }
  return {
    train: exemplars.filter((e) => !held.has(e.sessionId)),
    holdout: exemplars.filter((e) => held.has(e.sessionId)),
  };
}
