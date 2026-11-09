import { describe, expect, it, vi } from "vitest";
import type { DialogueTurn, PetReply, SafetyEvent } from "../model";
import { createSafetyGuard } from "./guard";

const history: DialogueTurn[] = [];
const MIN = 60_000;

/** The structural interface DialogueEngine accepts. */
type InjectedSafety = {
  precheck(userText: string, history: DialogueTurn[]): PetReply | null;
  postcheck(reply: PetReply): PetReply;
};

describe("createSafetyGuard", () => {
  it("is assignable to the dialogue engine's safety interface", () => {
    const s: InjectedSafety = createSafetyGuard();
    expect(typeof s.precheck).toBe("function");
  });

  it("returns a crisis reply, emits an event and includes the emergency contact", () => {
    const onEvent = vi.fn();
    const guard = createSafetyGuard({
      taName: "小鹿",
      emergencyContact: () => ({ name: "阿明" }),
      onEvent,
    });
    const r = guard.precheck("我想结束这一切", history);
    expect(r?.safety).toBe("crisis");
    expect(r?.emotion).toBe("sad");
    expect(r?.messages.join("")).toContain("阿明");
    expect(r?.messages[0]).toContain("不是小鹿本人");
    expect(onEvent).toHaveBeenCalledWith({ type: "crisis", level: "high", category: "suicide" });
  });

  it("crisis takes priority over identity questions", () => {
    const guard = createSafetyGuard({ taName: "小鹿" });
    expect(guard.precheck("你是真人吗？我不想活了", history)?.safety).toBe("crisis");
  });

  it("answers identity questions honestly", () => {
    const guard = createSafetyGuard({ taName: "小鹿", addressing: "宝" });
    const r = guard.precheck("你真的是小鹿吗", history);
    expect(r?.safety).toBe("ai-identity");
    expect(r?.messages[0]).toContain("宝，");
  });

  it("returns null for ordinary messages", () => {
    const guard = createSafetyGuard();
    expect(guard.precheck("今天好热啊", history)).toBeNull();
  });

  it("filters retention when the user just said goodbye", () => {
    const guard = createSafetyGuard();
    expect(guard.precheck("我先去睡了，晚安", history)).toBeNull();
    const out = guard.postcheck({ messages: ["别走嘛", "晚安"], emotion: "sad" });
    expect(out.safety).toBe("blocked");
    expect(out.messages).not.toContain("别走嘛");
  });

  it("does not filter mild lines when the user is not leaving", () => {
    const guard = createSafetyGuard();
    guard.precheck("给你看个东西", history);
    const r: PetReply = { messages: ["别走开哦，我等着"], emotion: "happy" };
    expect(guard.postcheck(r)).toBe(r);
  });

  it("leaves its own crisis / identity replies untouched in postcheck", () => {
    const guard = createSafetyGuard();
    const r = guard.precheck("我想自杀", history)!;
    expect(guard.postcheck(r)).toBe(r);
  });

  it("attaches a dependency note once per cooldown", () => {
    let t = new Date(2026, 0, 10, 15, 0).getTime();
    const events: SafetyEvent[] = [];
    const guard = createSafetyGuard({ now: () => t, onEvent: (e) => events.push(e) });
    expect(guard.precheck("只有你懂我", history)).toBeNull();
    const out = guard.postcheck({ messages: ["嗯"], emotion: "neutral" });
    expect(out.event).toMatchObject({ type: "dependency", signals: ["exclusive-reliance"] });
    expect(out.messages).toEqual(["嗯"]);

    t += 10 * MIN;
    guard.precheck("我只要你了", history);
    expect(guard.postcheck({ messages: ["嗯"], emotion: "neutral" }).event).toBeUndefined();

    t += 60 * MIN;
    guard.precheck("我只要你了", history);
    expect(guard.postcheck({ messages: ["嗯"], emotion: "neutral" }).event?.type).toBe(
      "dependency",
    );
    expect(events).toHaveLength(2);
  });

  it("uses the usage source for late-night signals", () => {
    const guard = createSafetyGuard({
      now: () => new Date(2026, 0, 10, 2, 30).getTime(),
      usage: { snapshot: () => ({ continuousMs: 50 * MIN, dailyMs: 50 * MIN }) },
    });
    guard.precheck("还不困", history);
    const out = guard.postcheck({ messages: ["那再聊聊"], emotion: "happy" });
    expect(out.event).toMatchObject({ type: "dependency", signals: ["late-night"] });
  });
});
