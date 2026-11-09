import type { DialogueTurn, Emotion, StyleProfile } from "../../core/model";
import { normalizeEmotion, postprocess, typingDelayMs } from "../../core/dialogue";
import { filterReply } from "../../core/safety";

/** Bubbles kept on screen at once; older ones fade out. */
export const MAX_VISIBLE_BUBBLES = 3;
/** Turns persisted in the `chatLog` asset. */
export const MAX_LOG_TURNS = 200;
/** Turns sent to the engine as context (the prompt trims further by budget). */
export const HISTORY_TURNS = 24;
/** The LLM round trip already reads as "typing", so the first bubble only waits this long. */
export const FIRST_BUBBLE_MIN_MS = 350;

const TALK_MS_PER_CHAR = 110;

export function trimLog(log: DialogueTurn[], max = MAX_LOG_TURNS): DialogueTurn[] {
  return log.length > max ? log.slice(log.length - max) : log;
}

/** Earliest time a bubble may appear, given when the previous one (or the user's message) did. */
export function bubbleDueAt(
  prevAt: number,
  text: string,
  first: boolean,
  style?: StyleProfile,
): number {
  return prevAt + (first ? FIRST_BUBBLE_MIN_MS : typingDelayMs(text, style));
}

/** How long the mouth moves for one bubble. */
export function talkDurationMs(text: string): number {
  return Math.min(3000, Math.max(700, Array.from(text).length * TALK_MS_PER_CHAR));
}

/**
 * Final messages still to show after streaming already showed `shown`. Normally `shown` is a
 * prefix of `final`; if post-processing reshaped the burst, skip the texts already on screen.
 */
export function remainingMessages(shown: string[], final: string[]): string[] {
  let k = 0;
  while (k < shown.length && k < final.length && shown[k] === final[k]) k++;
  if (k === shown.length) return final.slice(k);
  const seen = new Set(shown);
  return final.filter((m) => !seen.has(m));
}

/**
 * A streamed message is shown before the full reply arrives only if the content filter would
 * keep it unchanged; otherwise it is held back and the post-checked final reply decides.
 */
export function screenPartial(
  text: string,
  style: StyleProfile | undefined,
  userLeaving: boolean,
): string[] | null {
  const { violations } = filterReply({ messages: [text], emotion: "neutral" }, { userLeaving });
  if (violations.length > 0) return null;
  return postprocess({ messages: [text], emotion: "neutral" }, style, { maxBurst: 99 }).messages;
}

/** Picks the emotion out of a partially streamed JSON reply, once it has been written. */
export function sniffEmotion(rawSoFar: string): Emotion | null {
  const m = /"emotion"\s*:\s*"([a-z]+)"/.exec(rawSoFar);
  return m ? normalizeEmotion(m[1]) : null;
}
