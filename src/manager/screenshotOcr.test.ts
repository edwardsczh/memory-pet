import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { afterAll, describe, expect, it } from "vitest";
import { prepareRgba } from "./screenshotImage";
import { linesFromOcr, recognizeScreenshot, shutdownRecognizer, whoFromBox } from "./screenshotOcr";
import { EMPTY_PICTURE_NOTICE, settlePicture } from "./screenshotReview";

const fixturePath = "fixtures/screenshots/wechat-lines.png";

function preparePng(bytes: Uint8Array): { png: Uint8Array; width: number } {
  const image = PNG.sync.read(bytes);
  prepareRgba(image.data);
  return { png: PNG.sync.write(image), width: image.width };
}

describe("linesFromOcr", () => {
  it("labels the side of the bubble and does not add text", () => {
    const lines = linesFromOcr(
      [
        { text: "在吗\n", confidence: 90, bbox: { x0: 73, y0: 96, x1: 153, y1: 134 } },
        { text: "在的呀", confidence: 91, bbox: { x0: 703, y0: 236, x1: 826, y1: 274 } },
        { text: "昨天 21:03", confidence: 88, bbox: { x0: 363, y0: 30, x1: 556, y1: 67 } },
        { text: "噪", confidence: 12, bbox: { x0: 10, y0: 10, x1: 20, y1: 20 } },
      ],
      900,
    );
    expect(lines.map((line) => line.text)).toEqual(["昨天 21:03", "在吗", "在的呀"]);
    expect(lines.map((line) => line.who)).toEqual(["unknown", "ta", "me"]);
    expect(whoFromBox({ x0: 0, y0: 0, x1: 10, y1: 10 }, 0)).toBe("unknown");
  });
});

describe("recognizeScreenshot", () => {
  afterAll(async () => {
    await shutdownRecognizer();
  });

  it("reads the lines in the fixture image", async () => {
    const prepared = preparePng(readFileSync(fixturePath));
    const lines = await recognizeScreenshot(prepared.png, prepared.width);
    const compact = (text: string) => text.replace(/\s+/g, "");
    const known = ["昨天21:03", "在吗", "在的呀"];
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((line) => known.includes(compact(line.text)))).toBe(true);
    expect(lines.find((line) => compact(line.text) === "在吗")?.who).toBe("ta");
    expect(lines.find((line) => compact(line.text) === "在的呀")?.who).toBe("me");
    expect(lines.some((line) => line.text.includes("小鹿"))).toBe(false);
  }, 30_000);

  it("says a blank image has no text and does not save a character from it", async () => {
    const image = new PNG({ width: 64, height: 40 });
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = 255;
      image.data[i + 1] = 255;
      image.data[i + 2] = 255;
      image.data[i + 3] = 255;
    }
    prepareRgba(image.data);
    const lines = await recognizeScreenshot(PNG.sync.write(image), image.width);
    expect(lines).toEqual([]);
    const picture = settlePicture(
      { id: "blank", name: "blank.png", status: "reading", lines: [], notice: null },
      lines,
    );
    expect(picture.notice).toBe(EMPTY_PICTURE_NOTICE);
    expect(picture.notice).toMatch(/没有读出文字/);
    expect(picture.lines).toEqual([]);
  }, 30_000);
});
