import { describe, expect, it } from "vitest";
import type { Exemplar, StyleProfile } from "../core/model";
import { buildBlindTurn, formatExemplarReply, gradeBlindPick, styleStubReply } from "./blindTurn";

const T = Date.UTC(2024, 5, 1, 12);

function ex(id: string, context: string, reply: string[]): Exemplar {
  return { id, sessionId: "s1", ts: T, context, reply };
}

const style: StyleProfile = {
  messageCount: 40,
  avgLength: 12,
  medianLength: 10,
  avgBurst: 1.8,
  periodRate: 0.05,
  punctuation: [{ token: "～", rate: 0.2 }],
  catchphrases: [{ phrase: "哼", count: 5 }],
  emojiRate: 0.1,
  topEmojis: ["😂"],
  activeHours: new Array(24).fill(0),
  nicknamesForMe: ["笨蛋"],
  firstTs: T,
  lastTs: T + 1,
};

describe("buildBlindTurn", () => {
  it("returns null when holdout is empty", () => {
    expect(buildBlindTurn([], style, () => 0)).toBeNull();
  });

  it("uses another holdout reply as distractor when available", () => {
    const holdout = [
      ex("a", "刚下班", ["辛苦啦", "吃饭没"]),
      ex("b", "好无聊", ["那来玩", "我等你"]),
    ];
    const q = buildBlindTurn(holdout, style, () => 0);
    expect(q).not.toBeNull();
    expect(q!.exemplarId).toBe("a");
    const real = formatExemplarReply(holdout[0].reply);
    const fake = formatExemplarReply(holdout[1].reply);
    expect([q!.leftText, q!.rightText].sort()).toEqual([real, fake].sort());
    expect(q!.realSide).toBe("left");
  });

  it("uses style stub when only one holdout exemplar", () => {
    const holdout = [ex("only", "你在干嘛", ["在想你呀"])];
    const q = buildBlindTurn(holdout, style, () => 0.99);
    expect(q).not.toBeNull();
    expect(q!.leftText).not.toBe(q!.rightText);
    expect(q!.leftText === "在想你呀" || q!.rightText === "在想你呀").toBe(true);
  });

  it("gradeBlindPick matches realSide", () => {
    const q = buildBlindTurn([ex("x", "hi", ["yo"])], undefined, () => 0.2)!;
    expect(gradeBlindPick(q, q.realSide)).toBe(true);
    expect(gradeBlindPick(q, q.realSide === "left" ? "right" : "left")).toBe(false);
  });
});

describe("styleStubReply", () => {
  it("does not echo the user context verbatim", () => {
    const ctx = "今天加班到好晚";
    const lines = styleStubReply(ctx, style, () => 0.42);
    expect(lines.join("")).not.toContain(ctx);
    expect(lines.length).toBeGreaterThan(0);
  });
});
