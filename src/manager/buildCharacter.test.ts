import { describe, expect, it } from "vitest";
import demoJson from "../../fixtures/demo/xiaolu-wechat-exporter.json?raw";
import { buildSystemPrompt } from "../core/dialogue/prompt";
import { parseImport } from "../core/ingest";
import type { ConsentRecord } from "../core/model";
import { buildCharacterRecord, buildPromptCharacter } from "./buildCharacter";

describe("buildCharacterRecord", () => {
  it("builds 小鹿 from wechat exporter fixture", async () => {
    const parsed = parseImport("xiaolu-wechat-exporter.json", demoJson);
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

describe("buildCharacterRecord without a screenshot", () => {
  it("builds from a small JSON import", async () => {
    const parsed = parseImport(
      "chat.json",
      JSON.stringify([
        { time: "2024-01-02 21:03:00", sender: "阿哲", text: "在吗" },
        { time: "2024-01-02 21:03:20", sender: "小鹿", text: "在的呀" },
      ]),
    );
    const { character, assets } = await buildCharacterRecord(
      {
        subject: "living",
        subjectName: "小鹿",
        relation: "女朋友",
        subjectConsented: true,
        personalUseOnly: true,
        voiceConsent: false,
        declaredAt: 1,
        ageAdult: true,
      },
      parsed,
      { me: ["阿哲"], ta: ["小鹿"] },
      { now: 5 },
    );
    expect(character.name).toBe("小鹿");
    expect(character.persona?.userNotes ?? "").not.toMatch(/截图/);
    expect(assets.report.kept).toBe(2);
    expect(assets.sessions.length).toBeGreaterThan(0);
  });
});

describe("buildPromptCharacter", () => {
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

  it("creates a character from the typed prompt and no file", () => {
    const prompt = "说话很短，会叫我宝";
    const { character, assets } = buildPromptCharacter(consent, `  ${prompt}  `, { now: 5 });
    expect(character.name).toBe("小鹿");
    expect(character.persona?.summary).toBe(prompt);
    expect(character.persona?.userNotes).toMatch(/没有从截图里抽出句子/);
    expect(assets.sessions).toEqual([]);
    expect(assets.report.kept).toBe(0);
    expect(assets.index.size).toBe(0);
    const system = buildSystemPrompt({
      persona: character.persona!,
      style: character.style,
      exemplars: [],
      history: [],
      userText: "在吗",
      now: 5,
    });
    expect(system).toContain(prompt);
    expect(system).not.toMatch(/抽出的句子/);
  });

  it("refuses a blank prompt", () => {
    expect(() => buildPromptCharacter(consent, "   ")).toThrow(/提示/);
  });
});
