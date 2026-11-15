import { describe, expect, it } from "vitest";
import { SCREENSHOT_UNREAD, acceptScreenshotDrop } from "./screenshotDrop";

describe("acceptScreenshotDrop", () => {
  it("accepts images and does not pretend any line was extracted", () => {
    const drop = acceptScreenshotDrop([
      { name: "微信截图.png", type: "image/png" },
      { name: "chat.jpg", type: "" },
      { name: "backup.json", type: "application/json" },
    ]);
    expect(drop.images).toEqual([{ name: "微信截图.png" }, { name: "chat.jpg" }]);
    expect(drop.ignored).toEqual(["backup.json"]);
    expect(drop.message).toBe(SCREENSHOT_UNREAD);
    expect(drop.message).toMatch(/还不能读取图片/);
    expect(drop.message).toMatch(/没有从截图里抽出任何句子/);
    expect(drop).not.toHaveProperty("messages");
    expect(drop).not.toHaveProperty("text");
    expect(JSON.stringify(drop)).not.toMatch(/在吗|小鹿:/);
  });

  it("stays quiet when nothing is an image", () => {
    const drop = acceptScreenshotDrop([{ name: "notes.txt", type: "text/plain" }]);
    expect(drop.images).toEqual([]);
    expect(drop.message).toBeNull();
  });
});
