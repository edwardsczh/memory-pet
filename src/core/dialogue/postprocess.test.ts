import { describe, expect, it } from "vitest";
import type { StyleProfile } from "../model";
import { postprocess, splitLong, typingDelayMs } from "./postprocess";

function profile(over: Partial<StyleProfile> = {}): StyleProfile {
  return {
    messageCount: 100,
    avgLength: 8,
    medianLength: 6,
    avgBurst: 2,
    periodRate: 0.02,
    punctuation: [],
    catchphrases: [],
    emojiRate: 0.1,
    topEmojis: [],
    activeHours: new Array(24).fill(1 / 24),
    nicknamesForMe: [],
    firstTs: 0,
    lastTs: 0,
    ...over,
  };
}

describe("postprocess", () => {
  it("drops trailing single periods when TA rarely uses them", () => {
    const r = postprocess(
      { messages: ["好的。", "那走吧。。。", "嗯"], emotion: "happy" },
      profile(),
    );
    expect(r.messages).toEqual(["好的", "那走吧。。。", "嗯"]);
  });

  it("keeps periods for TA who uses them", () => {
    const r = postprocess(
      { messages: ["好的。"], emotion: "neutral" },
      profile({ periodRate: 0.6 }),
    );
    expect(r.messages).toEqual(["好的。"]);
  });

  it("splits newlines into bubbles", () => {
    expect(postprocess({ messages: ["a\nb"], emotion: "neutral" }).messages).toEqual(["a", "b"]);
  });

  it("splits long messages at punctuation", () => {
    const long = "今天天气特别好我们去公园散步吧！顺便买点水果回来，晚上一起做饭吃？";
    const r = postprocess({ messages: [long], emotion: "happy" }, profile(), { maxChars: 16 });
    expect(r.messages).toEqual([
      "今天天气特别好我们去公园散步吧！",
      "顺便买点水果回来",
      "晚上一起做饭吃？",
    ]);
  });

  it("caps the burst by merging the shortest neighbours", () => {
    const r = postprocess(
      { messages: ["a", "b", "ccccc", "d", "eeeee"], emotion: "neutral" },
      profile(),
      {
        maxBurst: 3,
      },
    );
    expect(r.messages).toEqual(["a，b", "ccccc，d", "eeeee"]);
  });

  it("leaves safety replies alone", () => {
    const r = postprocess(
      { messages: ["我是 AI。我会如实告诉你。"], emotion: "neutral", safety: "ai-identity" },
      profile(),
      { maxChars: 5 },
    );
    expect(r.messages).toEqual(["我是 AI。我会如实告诉你。"]);
  });
});

describe("splitLong", () => {
  it("hard-wraps text without punctuation", () => {
    expect(splitLong("一二三四五六七八九十", 4)).toEqual(["一二三四", "五六七八", "九十"]);
  });

  it("returns short text unchanged", () => {
    expect(splitLong("短的", 10)).toEqual(["短的"]);
  });
});

describe("typingDelayMs", () => {
  it("grows with length and is clamped", () => {
    const p = profile({ medianLength: 6 });
    expect(typingDelayMs("好", p)).toBe(550);
    expect(typingDelayMs("一二三四五六", p)).toBe(1800);
    expect(typingDelayMs("字".repeat(500), p)).toBe(5000);
    expect(typingDelayMs("", p)).toBe(500);
  });
});
