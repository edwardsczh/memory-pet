import { describe, expect, it } from "vitest";
import type { Character } from "../model";
import {
  assertNoChatFields,
  buildConsentExport,
  CONSENT_EXPORT_VERSION,
  serializeConsentExport,
} from "./consentExport";

const sample: Character = {
  id: "char-1",
  name: "小鹿",
  consent: {
    subject: "living",
    subjectName: "小鹿",
    relation: "女朋友",
    subjectConsented: true,
    personalUseOnly: true,
    voiceConsent: false,
    declaredAt: 1_700_000_000_000,
    ageAdult: true,
  },
  persona: {
    name: "小鹿",
    relation: "女朋友",
    summary: "活泼、爱用颜文字",
    traits: [{ text: "外向", evidence: [] }],
    addressing: ["宝"],
    taboos: [],
    userNotes: "",
    updatedAt: 1,
  },
  avatar: "momo",
  createdAt: 1,
  gentleMode: false,
  archived: false,
};

describe("consentExport", () => {
  it("includes consent, persona summary, and export time", () => {
    const doc = buildConsentExport(sample, 42);
    expect(doc.version).toBe(CONSENT_EXPORT_VERSION);
    expect(doc.exportedAt).toBe(42);
    expect(doc.characterId).toBe("char-1");
    expect(doc.characterName).toBe("小鹿");
    expect(doc.consent).toEqual(sample.consent);
    expect(doc.personaSummary).toBe("活泼、爱用颜文字");
  });

  it("serializes to valid JSON without chat fields", () => {
    const raw = serializeConsentExport(buildConsentExport(sample, 99));
    const parsed = JSON.parse(raw) as unknown;
    assertNoChatFields(parsed);
    expect(raw).not.toMatch(/"messages"/);
    expect(raw).not.toMatch(/"sessions"/);
  });

  it("uses null summary when persona missing or empty", () => {
    const noPersona = buildConsentExport({ ...sample, persona: undefined });
    expect(noPersona.personaSummary).toBeNull();
    const blank = buildConsentExport({
      ...sample,
      persona: { ...sample.persona!, summary: "   " },
    });
    expect(blank.personaSummary).toBeNull();
  });
});
