import type { Character } from "../model";

export interface ProactiveGreetSettings {
  /** Max proactive greets per local calendar day. Default 1. */
  maxPerDay?: number;
  /** Quiet range start hour [0, 23], inclusive. Default 23. */
  quietStartHour?: number;
  /** Quiet range end hour [0, 23], exclusive. Default 8. */
  quietEndHour?: number;
}

export const DEFAULT_PROACTIVE_GREET_SETTINGS: Required<ProactiveGreetSettings> = {
  maxPerDay: 1,
  quietStartHour: 23,
  quietEndHour: 8,
};

export const PROACTIVE_GREET_VAULT_KEY = "lastProactiveGreet";

export function localDayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function resolveSettings(settings?: ProactiveGreetSettings): Required<ProactiveGreetSettings> {
  return { ...DEFAULT_PROACTIVE_GREET_SETTINGS, ...settings };
}

/** True when the local hour falls in the configured quiet window (may wrap midnight). */
export function isProactiveQuietHour(now: number, settings?: ProactiveGreetSettings): boolean {
  const { quietStartHour: start, quietEndHour: end } = resolveSettings(settings);
  const h = new Date(now).getHours();
  if (start === end) return false;
  if (start > end) return h >= start || h < end;
  return h >= start && h < end;
}

function greetsOnSameDay(now: number, lastGreet: number | null): boolean {
  return lastGreet !== null && localDayKey(now) === localDayKey(lastGreet);
}

/**
 * Whether a non-LLM proactive greet may fire at `now`. Respects quiet hours and the daily cap
 * (`maxPerDay` is implemented via last timestamp for v1).
 */
export function shouldGreet(
  now: number,
  lastGreet: number | null,
  settings?: ProactiveGreetSettings,
): boolean {
  const s = resolveSettings(settings);
  if (isProactiveQuietHour(now, s)) return false;
  if (s.maxPerDay <= 0) return false;
  if (greetsOnSameDay(now, lastGreet)) return false;
  return true;
}

/** Time-of-day prefix + persona addressing; not model-generated. */
export function proactiveGreetText(now: number, character: Character): string {
  const h = new Date(now).getHours();
  let timeBit: string;
  if (h >= 5 && h < 11) timeBit = "早上好";
  else if (h >= 11 && h < 13) timeBit = "中午好";
  else if (h >= 13 && h < 18) timeBit = "下午好";
  else if (h >= 18 && h < 23) timeBit = "晚上好";
  else timeBit = "嗨";

  const addressing = character.persona?.addressing[0] ?? character.style?.nicknamesForMe?.[0] ?? "";
  const prefix = addressing ? `${addressing}，` : "";

  if (character.gentleMode) {
    return `${prefix}${timeBit}～今天也要照顾好自己哦。`;
  }
  return `${prefix}${timeBit}呀～在呢，想聊聊随时找我！`;
}

/** Default delay before showing the greet bubble after the session becomes ready (ms). */
export const PROACTIVE_GREET_DELAY_MS = 2_000;
