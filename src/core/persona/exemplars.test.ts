import { describe, expect, it } from "vitest";
import type { Exemplar } from "../model";
import { makeSession } from "../testing/sessions";
import { extractExemplars, splitHoldout } from "./exemplars";

const T = Date.UTC(2024, 4, 1, 12);

describe("extractExemplars", () => {
  it("pairs user turn → TA reply with up to two prior turns", () => {
    const s = makeSession("s1", T, [
      ["ta", "在干嘛"],
      ["me", "刚下班"],
      ["ta", "辛苦啦", "吃饭没"],
      ["me", "还没呢", "不知道吃啥"],
      ["ta", "去吃那家面吧", "上次你说好吃"],
    ]);
    const ex = extractExemplars([s]);
    expect(ex).toHaveLength(2);
    expect(ex[0]).toMatchObject({
      id: "s1#2",
      sessionId: "s1",
      context: "刚下班",
      reply: ["辛苦啦", "吃饭没"],
      prior: [{ role: "ta", text: "在干嘛" }],
    });
    expect(ex[0].ts).toBe(T + 2 * 60_000);
    expect(ex[1].context).toBe("还没呢\n不知道吃啥");
    expect(ex[1].prior).toEqual([
      { role: "me", text: "刚下班" },
      { role: "ta", text: "辛苦啦\n吃饭没" },
    ]);
  });

  it("contextTurns: 0 omits prior", () => {
    const s = makeSession("s1", T, [
      ["ta", "在干嘛"],
      ["me", "刚下班"],
      ["ta", "辛苦啦"],
    ]);
    expect(extractExemplars([s], { contextTurns: 0 })[0].prior).toBeUndefined();
  });

  it("drops short, emoji-only, media-only and redacted pairs", () => {
    const s = makeSession("s1", T, [
      ["me", "我好看吗"],
      ["ta", "嗯"],
      ["me", "哈哈"],
      ["ta", "😂😂", "[捂脸]"],
      ["me", "看这个"],
      ["ta", "@image"],
      ["me", "你电话多少"],
      ["ta", "[手机号] 打这个"],
      ["me", "@sticker"],
      ["ta", "笑死我了"],
      ["me", "晚安"],
      ["ta", "晚安哦～😴"],
    ]);
    const ex = extractExemplars([s]);
    expect(ex.map((e) => e.reply)).toEqual([["晚安哦～😴"]]);
  });

  it("does not pair across other speakers", () => {
    const s = makeSession("g", T, [
      ["me", "大家好"],
      ["other", "你好"],
      ["ta", "嗨嗨嗨"],
    ]);
    expect(extractExemplars([s])).toEqual([]);
  });

  it("trims long context from the front", () => {
    const long = "啊".repeat(50) + "结尾在这";
    const s = makeSession("s", T, [
      ["me", long],
      ["ta", "好的好的"],
    ]);
    const [e] = extractExemplars([s], { maxContextChars: 10 });
    expect(e.context).toBe("…" + "啊".repeat(6) + "结尾在这");
  });
});

describe("splitHoldout", () => {
  const ex: Exemplar[] = [];
  for (let s = 0; s < 50; s++) {
    for (let i = 0; i < 4; i++) {
      ex.push({
        id: `s${s}#${i}`,
        sessionId: `s${s}`,
        ts: s * 1000 + i,
        context: "x",
        reply: ["y"],
      });
    }
  }

  it("is deterministic, session-disjoint and near the ratio", () => {
    const a = splitHoldout(ex, 0.08, 7);
    const b = splitHoldout(ex, 0.08, 7);
    expect(a.holdout.map((e) => e.id)).toEqual(b.holdout.map((e) => e.id));
    expect(a.train.length + a.holdout.length).toBe(ex.length);
    expect(a.holdout.length).toBe(16);
    const trainSessions = new Set(a.train.map((e) => e.sessionId));
    expect(a.holdout.some((e) => trainSessions.has(e.sessionId))).toBe(false);
  });

  it("different seeds pick different sessions", () => {
    const a = splitHoldout(ex, 0.1, 1).holdout.map((e) => e.sessionId);
    const b = splitHoldout(ex, 0.1, 2).holdout.map((e) => e.sessionId);
    expect(a).not.toEqual(b);
  });

  it("never empties the training set", () => {
    const one = ex.filter((e) => e.sessionId === "s0");
    expect(splitHoldout(one, 0.5).train).toHaveLength(4);
  });
});
