import { describe, expect, it } from "vitest";
import { prepareRgba } from "./screenshotImage";

describe("prepareRgba", () => {
  it("keeps dark text and clears a light green bubble", () => {
    const data = new Uint8ClampedArray([
      25,
      25,
      25,
      255, // text
      149,
      236,
      105,
      255, // WeChat green
      255,
      255,
      255,
      255,
      136,
      136,
      136,
      255, // gray timestamp
    ]);
    prepareRgba(data);
    expect(Array.from(data)).toEqual([
      0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255,
    ]);
  });
});
