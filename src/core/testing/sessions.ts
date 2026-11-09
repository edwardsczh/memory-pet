import type { CleanMessage, MessageKind, Role, Session, Turn } from "../model";

/** Turn spec for fixtures: role followed by message texts. "@image" / "@sticker" make media messages. */
export type TurnSpec = [Role, ...string[]];

const MEDIA: Record<string, [MessageKind, string]> = {
  "@image": ["image", "[图片]"],
  "@sticker": ["sticker", "[动画表情]"],
  "@voice": ["voice", "[语音]"],
};

/** Fictional session; message k gets id `${id}-${k}` and ts `start + k * stepMs`. */
export function makeSession(
  id: string,
  start: number,
  turns: TurnSpec[],
  stepMs = 60_000,
): Session {
  let k = 0;
  const out: Turn[] = turns.map(([role, ...texts]) => ({
    role,
    messages: texts.map((t): CleanMessage => {
      const [kind, text] = MEDIA[t] ?? ["text", t];
      const ts = start + k * stepMs;
      const m: CleanMessage = {
        id: `${id}-${k}`,
        ts,
        sender: role === "ta" ? "小雨" : role === "me" ? "我" : "路人",
        kind,
        text,
        role,
      };
      k++;
      return m;
    }),
  }));
  return { id, start, end: start + Math.max(0, k - 1) * stepMs, turns: out };
}
