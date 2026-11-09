import type { Emotion, PetReply } from "../model";
import { extractJson } from "../text/json";

export const EMOTIONS: readonly Emotion[] = [
  "neutral",
  "happy",
  "sad",
  "angry",
  "surprised",
  "shy",
  "thinking",
];

const EMOTION_ALIASES: Record<string, Emotion> = {
  joy: "happy",
  joyful: "happy",
  glad: "happy",
  excited: "happy",
  laugh: "happy",
  laughing: "happy",
  playful: "happy",
  开心: "happy",
  高兴: "happy",
  快乐: "happy",
  兴奋: "happy",
  sadness: "sad",
  upset: "sad",
  cry: "sad",
  crying: "sad",
  难过: "sad",
  伤心: "sad",
  委屈: "sad",
  anger: "angry",
  mad: "angry",
  annoyed: "angry",
  生气: "angry",
  愤怒: "angry",
  surprise: "surprised",
  shocked: "surprised",
  惊讶: "surprised",
  吃惊: "surprised",
  embarrassed: "shy",
  blush: "shy",
  shyness: "shy",
  害羞: "shy",
  think: "thinking",
  thoughtful: "thinking",
  confused: "thinking",
  curious: "thinking",
  思考: "thinking",
  疑惑: "thinking",
  calm: "neutral",
  normal: "neutral",
  平静: "neutral",
};

export function normalizeEmotion(v: unknown): Emotion {
  if (typeof v !== "string") return "neutral";
  const key = v.trim().toLowerCase();
  if ((EMOTIONS as readonly string[]).includes(key)) return key as Emotion;
  return EMOTION_ALIASES[key] ?? "neutral";
}

const MESSAGE_KEYS = [
  "messages",
  "message",
  "msgs",
  "replies",
  "reply",
  "text",
  "content",
  "response",
];
const EMOTION_KEYS = ["emotion", "mood", "expression", "feeling"];
const SPEAKER_RE = /^(?:TA|ta|Ta|助手|assistant|AI)\s*[:：]\s*/;

function cleanMessages(list: string[]): string[] {
  const out: string[] = [];
  for (const item of list) {
    for (const line of item.replace(/\\n/g, "\n").split(/\r?\n/)) {
      const t = line.replace(SPEAKER_RE, "").trim();
      if (t) out.push(t);
    }
  }
  return out;
}

function asStrings(v: unknown): string[] | null {
  if (typeof v === "string") return [v];
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const x of v) {
    if (typeof x === "string") out.push(x);
    else if (typeof x === "number") out.push(String(x));
    else if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      const t = o.text ?? o.content ?? o.message;
      if (typeof t === "string") out.push(t);
    }
  }
  return out;
}

function fromValue(v: unknown, depth = 0): PetReply | null {
  if (Array.isArray(v)) {
    const list = asStrings(v);
    return list ? { messages: cleanMessages(list), emotion: "neutral" } : null;
  }
  if (!v || typeof v !== "object" || depth > 2) return null;
  const o = v as Record<string, unknown>;
  const lower = new Map(Object.keys(o).map((k) => [k.toLowerCase(), o[k]]));
  const emotionRaw = EMOTION_KEYS.map((k) => lower.get(k)).find((x) => x !== undefined);
  for (const key of MESSAGE_KEYS) {
    const val = lower.get(key);
    if (val === undefined) continue;
    const list = asStrings(val);
    if (list) return { messages: cleanMessages(list), emotion: normalizeEmotion(emotionRaw) };
    const nested = fromValue(val, depth + 1);
    if (nested) {
      return {
        messages: nested.messages,
        emotion: emotionRaw !== undefined ? normalizeEmotion(emotionRaw) : nested.emotion,
      };
    }
  }
  return null;
}

/** For JSON broken beyond repair, e.g. unescaped quotes inside a message string. */
function salvage(text: string): PetReply | null {
  const m = /"?messages"?\s*[:：]\s*\[([\s\S]*?)\]\s*(?:[,，}]|$)/i.exec(text);
  if (!m) return null;
  const body = m[1].trim().replace(/^["“]|["”],?$/g, "");
  const parts = body.split(/["”]\s*[,，]\s*["“]/);
  const messages = cleanMessages(parts);
  if (messages.length === 0) return null;
  return { messages, emotion: emotionByRegex(text) };
}

function emotionByRegex(text: string): Emotion {
  const m = /["']?(?:emotion|mood)["']?\s*[:：=]\s*["']?([\p{L}]+)/iu.exec(text);
  return m ? normalizeEmotion(m[1]) : "neutral";
}

function plainLines(text: string): string[] {
  const lines = text
    .replace(/```[a-zA-Z]*/g, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^[{}[\],]+$/.test(l))
    .filter((l) => !/^["']?(?:emotion|mood|情绪)["']?\s*[:：=]/i.test(l))
    .map((l) =>
      l
        .replace(/^(?:[-*•]|\d+[.、)])\s*/, "")
        .replace(/^["“「](.*)["”」],?$/, "$1")
        .trim(),
    );
  return cleanMessages(lines);
}

/**
 * Parse the model's `{"messages": [...], "emotion": "..."}` answer. Never throws; falls back to
 * treating the text as plain lines. Returns no messages only for blank input.
 */
export function parseReply(raw: string): PetReply {
  const text = (raw ?? "").replace(/^\uFEFF/, "").trim();
  if (!text) return { messages: [], emotion: "neutral" };
  const parsed = fromValue(extractJson(text));
  if (parsed && parsed.messages.length > 0) return parsed;
  const salvaged = salvage(text);
  if (salvaged) return salvaged;
  const messages = plainLines(text);
  return {
    messages: messages.length > 0 ? messages : [text],
    emotion: parsed?.emotion ?? emotionByRegex(text),
  };
}

/**
 * Messages completed so far in a streamed, still-unfinished JSON answer — lets the UI show
 * bubbles before the stream ends. Plain-text answers yield nothing until done.
 */
export function partialMessages(rawSoFar: string): string[] {
  const start = /"messages"\s*:\s*\[/.exec(rawSoFar);
  if (!start) return [];
  const rest = rawSoFar.slice(start.index + start[0].length);
  const out: string[] = [];
  const strRe = /\s*,?\s*"((?:[^"\\]|\\.)*)"/y;
  let m: RegExpExecArray | null;
  while ((m = strRe.exec(rest))) {
    try {
      out.push(JSON.parse(`"${m[1]}"`) as string);
    } catch {
      out.push(m[1]);
    }
  }
  return cleanMessages(out);
}
