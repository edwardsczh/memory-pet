import { describe, expect, it } from "vitest";
import { acceptScreenshotDrop, isScreenshotFile } from "./screenshotDrop";

describe("acceptScreenshotDrop", () => {
  it("accepts png, jpg, and webp and does not invent text", () => {
    const drop = acceptScreenshotDrop([
      { name: "微信截图.png", type: "image/png" },
      { name: "chat.jpg", type: "" },
      { name: "chat.webp", type: "image/webp" },
      { name: "backup.json", type: "application/json" },
      { name: "sticker.gif", type: "image/gif" },
    ]);
    expect(drop.images).toEqual([
      { name: "微信截图.png" },
      { name: "chat.jpg" },
      { name: "chat.webp" },
    ]);
    expect(drop.ignored).toEqual(["backup.json", "sticker.gif"]);
    expect(drop).not.toHaveProperty("messages");
    expect(drop).not.toHaveProperty("text");
    expect(JSON.stringify(drop)).not.toMatch(/在吗|小鹿:/);
    expect(isScreenshotFile({ name: "a.JPEG", type: "" })).toBe(true);
  });

  it("stays quiet when nothing is a screenshot", () => {
    const drop = acceptScreenshotDrop([{ name: "notes.txt", type: "text/plain" }]);
    expect(drop.images).toEqual([]);
    expect(drop.ignored).toEqual(["notes.txt"]);
  });
});
