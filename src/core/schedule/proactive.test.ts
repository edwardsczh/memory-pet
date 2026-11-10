import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROACTIVE_GREET_SETTINGS,
  isProactiveQuietHour,
  localDayKey,
  proactiveGreetText,
  shouldGreet,
} from "./proactive";
import type { Character } from "../model";

const ts = (y: number, mo: number, d: number, h: number, mi = 0) =>
  new Date(y, mo - 1, d, h, mi).getTime();

const baseCharacter: Character = {
  id: "c1",
  name: "小明",
  consent: {
    subject: "living",
    subjectName: "小明",
    relation: "朋友",
    subjectConsented: true,
    personalUseOnly: true,
    voiceConsent: false,
    declaredAt: 0,
    ageAdult: true,
  },
  avatar: "momo",
  createdAt: 0,
  gentleMode: false,
  archived: false,
  persona: {
    name: "小明",
    relation: "朋友",
    summary: "",
    traits: [],
    addressing: ["老铁"],
    taboos: [],
    userNotes: "",
    updatedAt: 0,
  },
};

describe("proactive greet schedule", () => {
  it("blocks quiet hours 23:00–08:00 by default", () => {
    expect(isProactiveQuietHour(ts(2026, 1, 10, 23, 0))).toBe(true);
    expect(isProactiveQuietHour(ts(2026, 1, 10, 3, 0))).toBe(true);
    expect(isProactiveQuietHour(ts(2026, 1, 10, 7, 59))).toBe(true);
    expect(isProactiveQuietHour(ts(2026, 1, 10, 8, 0))).toBe(false);
    expect(isProactiveQuietHour(ts(2026, 1, 10, 12, 0))).toBe(false);
    expect(isProactiveQuietHour(ts(2026, 1, 10, 22, 59))).toBe(false);
  });

  it("shouldGreet is false in quiet hours and true in daytime with no prior greet", () => {
    expect(shouldGreet(ts(2026, 1, 10, 9, 0), null)).toBe(true);
    expect(shouldGreet(ts(2026, 1, 10, 23, 5), null)).toBe(false);
  });

  it("allows at most one greet per local day", () => {
    const morning = ts(2026, 1, 10, 9, 0);
    const afternoon = ts(2026, 1, 10, 15, 0);
    const nextDay = ts(2026, 1, 11, 9, 0);
    expect(shouldGreet(afternoon, morning)).toBe(false);
    expect(shouldGreet(nextDay, morning)).toBe(true);
    expect(localDayKey(morning)).not.toBe(localDayKey(nextDay));
  });

  it("respects custom settings", () => {
    expect(
      shouldGreet(ts(2026, 1, 10, 22, 0), null, {
        ...DEFAULT_PROACTIVE_GREET_SETTINGS,
        quietStartHour: 22,
        quietEndHour: 7,
      }),
    ).toBe(false);
  });

  it("builds greet copy from addressing and time of day", () => {
    expect(proactiveGreetText(ts(2026, 1, 10, 9, 0), baseCharacter)).toContain("早上好");
    expect(proactiveGreetText(ts(2026, 1, 10, 9, 0), baseCharacter)).toContain("老铁");
    const gentle = proactiveGreetText(ts(2026, 1, 10, 18, 0), {
      ...baseCharacter,
      gentleMode: true,
      persona: undefined,
    });
    expect(gentle).toContain("晚上好");
    expect(gentle).not.toContain("想聊聊");
  });
});
