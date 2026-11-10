import type { Exemplar, StyleProfile } from "../core/model";
import { charLength } from "../core/text/chars";

export type Rng = () => number;

export interface BlindTurnQuestion {
  exemplarId: string;
  context: string;
  prior?: Exemplar["prior"];
  /** Shuffled reply shown on the left. */
  leftText: string;
  /** Shuffled reply shown on the right. */
  rightText: string;
  /** Which side is the real holdout reply. */
  realSide: "left" | "right";
}

const GENERIC_STUBS = [
  "嗯嗯知道了",
  "行吧",
  "哈哈哈",
  "好呀",
  "为啥",
  "真的假的",
  "等会再说",
  "可以",
  "哦这样",
  "没事",
];

export function formatExemplarReply(reply: string[]): string {
  return reply.join("\n");
}

function pickInt(n: number, rng: Rng): number {
  if (n <= 0) return 0;
  return Math.floor(rng() * n);
}

/** Placeholder TA reply that mimics coarse style stats without copying the context. */
export function styleStubReply(
  context: string,
  style: StyleProfile | undefined,
  rng: Rng = Math.random,
): string[] {
  const burst =
    style && style.avgBurst > 1.2
      ? Math.min(4, Math.max(1, Math.round(style.avgBurst) + (rng() < 0.25 ? 1 : 0)))
      : rng() < 0.75
        ? 1
        : 2;
  const target = style ? Math.max(2, Math.round(style.medianLength || style.avgLength)) : 8;
  const lines: string[] = [];
  for (let i = 0; i < burst; i++) {
    let line = GENERIC_STUBS[pickInt(GENERIC_STUBS.length, rng)]!;
    if (style?.catchphrases.length && rng() < 0.4) {
      const cp = style.catchphrases[pickInt(style.catchphrases.length, rng)]!.phrase;
      line = rng() < 0.5 ? `${cp}${line}` : `${line}${cp}`;
    }
    if (style) {
      const mark = style.punctuation[pickInt(Math.min(3, style.punctuation.length), rng)];
      if (mark && rng() < mark.rate * 3) {
        if (mark.token === "～" || mark.token === "~") line += "～";
        else if (mark.token === "！" || mark.token === "!") line += "！";
        else if (mark.token === "？" || mark.token === "?") line += "？";
      }
      if (style.periodRate > 0.35 && rng() < style.periodRate) line += "。";
      if (style.topEmojis.length && rng() < style.emojiRate * 2) {
        line += style.topEmojis[pickInt(style.topEmojis.length, rng)]!;
      }
    }
    const len = charLength(line);
    if (len < target)
      line += GENERIC_STUBS[pickInt(GENERIC_STUBS.length, rng)]!.slice(0, target - len);
    else if (len > target * 2) line = Array.from(line).slice(0, target).join("");
    if (line.trim() && !context.includes(line.trim())) lines.push(line);
    else lines.push(GENERIC_STUBS[pickInt(GENERIC_STUBS.length, rng)]!);
  }
  return lines;
}

/**
 * Picks a random holdout exemplar and pairs it with a distractor: another holdout reply when
 * possible, otherwise a style-aware stub.
 */
export function buildBlindTurn(
  holdout: Exemplar[],
  style: StyleProfile | undefined,
  rng: Rng = Math.random,
): BlindTurnQuestion | null {
  if (holdout.length === 0) return null;
  const target = holdout[pickInt(holdout.length, rng)]!;
  const realText = formatExemplarReply(target.reply);

  const others = holdout.filter((e) => e.id !== target.id);
  let fakeLines: string[];
  if (others.length > 0) {
    fakeLines = [...others[pickInt(others.length, rng)]!.reply];
  } else {
    fakeLines = styleStubReply(target.context, style, rng);
  }
  let fakeText = formatExemplarReply(fakeLines);
  if (fakeText === realText) {
    fakeLines = styleStubReply(target.context, style, rng);
    fakeText = formatExemplarReply(fakeLines);
  }

  const realLeft = rng() < 0.5;
  return {
    exemplarId: target.id,
    context: target.context,
    prior: target.prior,
    leftText: realLeft ? realText : fakeText,
    rightText: realLeft ? fakeText : realText,
    realSide: realLeft ? "left" : "right",
  };
}

export function gradeBlindPick(question: BlindTurnQuestion, picked: "left" | "right"): boolean {
  return picked === question.realSide;
}
