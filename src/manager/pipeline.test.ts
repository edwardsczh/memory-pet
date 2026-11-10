import { describe, expect, it } from "vitest";
import demoJson from "../../fixtures/demo/xiaolu-wechat-exporter.json?raw";
import { consentComplete, defaultConsent, runImportPipeline } from "./pipeline";

describe("manager pipeline", () => {
  it("runs import on demo fixture", () => {
    const bytes = new TextEncoder().encode(demoJson);
    const result = runImportPipeline({
      fileName: "xiaolu-wechat-exporter.json",
      bytes,
      mapping: { me: ["阿哲"], ta: ["小鹿"] },
    });
    expect(result.style.messageCount).toBeGreaterThan(100);
    expect(result.sessions.length).toBeGreaterThan(10);
  });

  it("blocks incomplete consent", () => {
    const c = defaultConsent({ subjectName: "", personalUseOnly: true, ageAdult: true });
    expect(consentComplete(c, true)).toBe(false);
    const ok = defaultConsent({
      subject: "living",
      subjectName: "小鹿",
      relation: "朋友",
      subjectConsented: true,
      personalUseOnly: true,
      ageAdult: true,
    });
    expect(consentComplete(ok, true)).toBe(true);
  });
});
