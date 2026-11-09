import { describe, expect, it } from "vitest";
import { makeSession } from "../testing/sessions";
import { buildStyleProfile, styleToPrompt } from "./style";

const T1 = Date.UTC(2024, 0, 1, 22, 0);
const T2 = Date.UTC(2024, 0, 2, 8, 0);
const utcHour = (ts: number) => new Date(ts).getUTCHours();

const sessions = [
  makeSession("s1", T1, [
    ["me", "今天好累啊"],
    ["ta", "怎么啦，宝～", "绝了 又加班？"],
    ["me", "嗯 老板太烦了"],
    ["ta", "抱抱[抱抱]", "@image", "绝了这老板。"],
    ["me", "哈哈哈还好"],
    ["ta", "那早点睡哈哈哈😄"],
  ]),
  makeSession("s2", T2, [
    ["me", "我到家了"],
    ["ta", "宝，绝了你今天好早！"],
  ]),
];

describe("buildStyleProfile", () => {
  const p = buildStyleProfile(sessions, { hourOf: utcHour });

  it("counts only TA text messages", () => {
    expect(p.messageCount).toBe(6);
  });

  it("lengths match hand computation", () => {
    // 6 + 7 + 6 + 6 + 8 + 10 code points; "😄" counts as one.
    expect(p.avgLength).toBeCloseTo(43 / 6, 10);
    expect(p.medianLength).toBe(6.5);
  });

  it("burst, period and emoji rates", () => {
    expect(p.avgBurst).toBe(6 / 4);
    expect(p.periodRate).toBeCloseTo(1 / 6, 10);
    expect(p.emojiRate).toBeCloseTo(2 / 6, 10);
    expect(p.topEmojis).toEqual(["[抱抱]", "😄"]);
  });

  it("sentence-final markers", () => {
    const rate = Object.fromEntries(p.punctuation.map((x) => [x.token, x.rate]));
    expect(rate["～"]).toBeCloseTo(1 / 6, 10);
    expect(rate["？"]).toBeCloseTo(1 / 6, 10);
    expect(rate["！"]).toBeCloseTo(1 / 6, 10);
    expect(rate["哈哈"]).toBeCloseTo(1 / 6, 10);
    expect(rate["啦"]).toBeUndefined();
  });

  it("catchphrase by excess frequency over the user", () => {
    expect(p.catchphrases).toEqual([{ phrase: "绝了", count: 3 }]);
  });

  it("nickname for the user", () => {
    expect(p.nicknamesForMe).toEqual(["宝"]);
  });

  it("active hours and time range", () => {
    expect(p.activeHours[22]).toBeCloseTo(5 / 6, 10);
    expect(p.activeHours[8]).toBeCloseTo(1 / 6, 10);
    expect(p.activeHours.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(p.firstTs).toBe(T1 + 60_000);
    expect(p.lastTs).toBe(T2 + 60_000);
  });

  it("a phrase the user says just as often is not TA's catchphrase", () => {
    const s = makeSession("s", T1, [
      ["me", "我觉得可以", "我觉得不行", "我觉得还行"],
      ["ta", "我觉得也是", "我觉得挺好", "我觉得算了"],
    ]);
    const prof = buildStyleProfile([s], { hourOf: utcHour });
    expect(prof.catchphrases.map((c) => c.phrase)).not.toContain("我觉得");
  });

  it("empty input", () => {
    const e = buildStyleProfile([]);
    expect(e.messageCount).toBe(0);
    expect(e.avgLength).toBe(0);
    expect(e.activeHours).toHaveLength(24);
    expect(styleToPrompt(e)).toBe("");
  });

  it("ellipsis is not a period", () => {
    const s = makeSession("s", T1, [["ta", "好吧。。。", "行。", "嗯"]]);
    const prof = buildStyleProfile([s], { hourOf: utcHour });
    expect(prof.periodRate).toBeCloseTo(1 / 3, 10);
    expect(prof.punctuation.find((x) => x.token === "。。。")?.rate).toBeCloseTo(1 / 3, 10);
  });

  it("final particles before trailing emoji/punctuation", () => {
    const s = makeSession("s", T1, [["ta", "好呀😊", "走吧～", "来嘛！", "嗯"]]);
    const prof = buildStyleProfile([s], { hourOf: utcHour });
    const tokens = prof.punctuation.map((x) => x.token);
    expect(tokens).toEqual(expect.arrayContaining(["呀", "吧", "嘛"]));
  });
});

describe("styleToPrompt", () => {
  it("renders the main habits in Chinese", () => {
    const text = styleToPrompt(buildStyleProfile(sessions, { hourOf: utcHour }));
    expect(text).toContain("平均 7 个字");
    expect(text).toContain("「绝了」");
    expect(text).toContain("宝");
    expect(text).toContain("[抱抱]");
  });
});
