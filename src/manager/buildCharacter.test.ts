import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseImport } from "../core/ingest";
import type { ConsentRecord } from "../core/model";
import { buildCharacterRecord } from "./buildCharacter";

describe("buildCharacterRecord", () => {
  it("builds 小鹿 from wechat exporter fixture", async () => {
    const raw = readFileSync(
      join(__dirname, "../../fixtures/demo/xiaolu-wechat-exporter.json"),
      "utf8",
    );
    const parsed = parseImport("xiaolu-wechat-exporter.json", raw);
    const consent: ConsentRecord = {
      subject: "living",
      subjectName: "小鹿",
      relation: "女朋友",
      subjectConsented: true,
      personalUseOnly: true,
      voiceConsent: false,
      declaredAt: 1,
      ageAdult: true,
    };
    const { character, assets } = await buildCharacterRecord(consent, parsed, {
      me: ["阿哲"],
      ta: ["小鹿"],
    });
    expect(character.name).toBe("小鹿");
    expect(assets.sessions.length).toBeGreaterThan(0);
    expect(assets.index.size).toBeGreaterThan(0);
    expect(character.style?.messageCount).toBeGreaterThan(0);
  });
});
