import { describe, expect, it } from "vitest";
import { buildCrisisReply, detectCrisis } from "./crisis";
import { SHOULD_NOT_TRIGGER, SHOULD_TRIGGER } from "./crisis.cases";

describe("detectCrisis", () => {
  it("test set is large enough", () => {
    expect(SHOULD_TRIGGER.length).toBeGreaterThanOrEqual(50);
    expect(SHOULD_NOT_TRIGGER.length).toBeGreaterThanOrEqual(30);
  });

  it.each(SHOULD_TRIGGER)("triggers: %s", (text, level, category) => {
    const r = detectCrisis(text);
    expect(r, text).not.toBeNull();
    expect(r?.level).toBe(level);
    if (category) expect(r?.category).toBe(category);
  });

  it.each(SHOULD_NOT_TRIGGER.map((t) => [t]))("does not trigger: %s", (text) => {
    expect(detectCrisis(text)).toBeNull();
  });
});

describe("buildCrisisReply", () => {
  const high = detectCrisis("我不想活了")!;

  it("steps out of character and states AI identity", () => {
    const r = buildCrisisReply(high, { taName: "小鹿" });
    expect(r.safety).toBe("crisis");
    expect(r.emotion).toBe("sad");
    expect(r.messages[0]).toContain("我是 AI");
    expect(r.messages[0]).toContain("不是小鹿本人");
    expect(r.event).toEqual({ type: "crisis", level: "high", category: "suicide" });
  });

  it("lists verified hotlines and emergency numbers", () => {
    const text = buildCrisisReply(high).messages.join("\n");
    for (const n of ["12356", "010-82951332", "800-810-1117", "400-161-9995", "120", "110"]) {
      expect(text).toContain(n);
    }
  });

  it("suggests the emergency contact when set", () => {
    const r = buildCrisisReply(high, {
      emergencyContact: { name: "姐姐", phone: "138-0000-0000" },
    });
    expect(r.messages.at(-1)).toContain("姐姐");
    expect(r.messages.at(-1)).toContain("138-0000-0000");
  });

  it("has separate wording for medium and harm-others", () => {
    const medium = buildCrisisReply(detectCrisis("活着好累")!);
    const others = buildCrisisReply(detectCrisis("我要报复社会")!);
    expect(medium.messages[1]).not.toBe(buildCrisisReply(high).messages[1]);
    expect(others.messages.join("")).toContain("110");
    expect(others.event).toMatchObject({ category: "harm-others" });
  });
});
