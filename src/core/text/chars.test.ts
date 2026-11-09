import { describe, expect, it } from "vitest";
import { charLength, estimateTokens, extractEmojis, isEmojiOnly, isRedacted } from "./chars";

describe("text helpers", () => {
  it("charLength counts code points", () => {
    expect(charLength("好😄👍🏻")).toBe(4);
  });

  it("extractEmojis: unicode, ZWJ sequences and WeChat codes, not placeholders", () => {
    expect(extractEmojis("哈[微笑]😄[图片]👨‍👩‍👧[手机号]")).toEqual(["[微笑]", "😄", "👨‍👩‍👧"]);
  });

  it("isEmojiOnly", () => {
    expect(isEmojiOnly("😂😂 [捂脸]！")).toBe(true);
    expect(isEmojiOnly("好😂")).toBe(false);
  });

  it("isRedacted recognises common placeholder shapes", () => {
    for (const t of ["打 [手机号]", "[已脱敏:邮箱]", "<PHONE>", "【地址已隐藏】"]) {
      expect(isRedacted(t)).toBe(true);
    }
    expect(isRedacted("[微笑] 好的")).toBe(false);
  });

  it("estimateTokens weights CJK higher", () => {
    expect(estimateTokens("你好你好你")).toBe(3);
    expect(estimateTokens("hello world")).toBe(4);
  });
});
