import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Character, DialogueTurn, LlmClient, LlmRequest } from "../../core/model";
import { typingDelayMs } from "../../core/dialogue";
import { createUsageTimer } from "../../core/safety";
import { createChatBackend, GENTLE_RULES } from "./backend";
import { ChatSession, errorText, type ChatBackend } from "./ChatSession";
import {
  FIRST_BUBBLE_MIN_MS,
  MAX_VISIBLE_BUBBLES,
  remainingMessages,
  screenPartial,
  sniffEmotion,
  trimLog,
} from "./pacing";

const character = (over: Partial<Character> = {}): Character => ({
  id: "c1",
  name: "小鹿",
  consent: {
    subject: "living",
    subjectName: "小鹿",
    relation: "女朋友",
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
  ...over,
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fakeLlm(raw: string, opts: { stream?: boolean; chunkMs?: number } = {}) {
  const calls: LlmRequest[] = [];
  const client: LlmClient = {
    complete: async (req) => {
      calls.push(req);
      await sleep(300);
      return raw;
    },
  };
  if (opts.stream) {
    client.stream = async (req, onDelta) => {
      calls.push(req);
      for (const piece of raw.match(/.{1,3}/gsu) ?? []) {
        await sleep(opts.chunkMs ?? 40);
        onDelta(piece);
      }
      return raw;
    };
  }
  return { client, calls };
}

function setup(llm: LlmClient, c = character(), log: DialogueTurn[] = []) {
  const saved: DialogueTurn[][] = [];
  const backend = createChatBackend(c, {
    llm,
    usage: createUsageTimer(),
    saveLog: async (l) => void saved.push(l),
  });
  const session = new ChatSession();
  session.setBackend(backend, log);
  return { session, saved, backend };
}

const live = (s: ChatSession) => s.getState().bubbles.filter((b) => !b.leaving);
const petTexts = (s: ChatSession) =>
  live(s)
    .filter((b) => b.kind === "pet")
    .map((b) => b.text);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-09T20:00:00+08:00"));
});
afterEach(() => vi.useRealTimers());

describe("ChatSession end to end (fake LLM)", () => {
  it("send → engine → paced bubbles → chatLog saved", async () => {
    const raw = JSON.stringify({ messages: ["在呢", "今天好累哦", "你吃饭没"], emotion: "happy" });
    const { client, calls } = fakeLlm(raw);
    const { session, saved } = setup(client);

    void session.send("在吗");
    await vi.advanceTimersByTimeAsync(0);
    let st = session.getState();
    expect(st.busy).toBe(true);
    expect(st.typing).toBe(true);
    expect(st.emotion).toBe("thinking");
    expect(st.bubbles.map((b) => b.kind)).toEqual(["user"]);

    // The LLM round trip (300ms) counts toward the first bubble's minimum wait.
    await vi.advanceTimersByTimeAsync(300);
    expect(petTexts(session)).toEqual([]);
    await vi.advanceTimersByTimeAsync(FIRST_BUBBLE_MIN_MS - 300);
    expect(petTexts(session)).toEqual(["在呢"]);
    st = session.getState();
    expect(st.emotion).toBe("happy");
    expect(st.talking).toBe(true);
    expect(st.typing).toBe(true);

    await vi.advanceTimersByTimeAsync(typingDelayMs("今天好累哦") - 1);
    expect(petTexts(session)).toEqual(["在呢"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(petTexts(session)).toEqual(["在呢", "今天好累哦"]);

    await vi.advanceTimersByTimeAsync(typingDelayMs("你吃饭没"));
    st = session.getState();
    // User bubble + 3 pet bubbles: the user's one fades out.
    expect(live(session).length).toBe(MAX_VISIBLE_BUBBLES);
    expect(petTexts(session)).toEqual(["在呢", "今天好累哦", "你吃饭没"]);
    expect(st.busy).toBe(false);
    expect(st.typing).toBe(false);
    expect(st.log.map((t) => `${t.role}:${t.text}`)).toEqual([
      "user:在吗",
      "pet:在呢",
      "pet:今天好累哦",
      "pet:你吃饭没",
    ]);
    expect(saved).toEqual([st.log]);
    expect(calls).toHaveLength(1);
    expect(st.lastTimings?.firstBubbleMs).toBe(FIRST_BUBBLE_MIN_MS);

    await vi.advanceTimersByTimeAsync(6000);
    expect(session.getState().emotion).toBe("neutral");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(session.getState().bubbles).toEqual([]);
  });

  it("streams: first bubble shows before the reply finishes, no duplicates", async () => {
    const raw = JSON.stringify({
      messages: ["哈哈哈", "笨蛋你又熬夜", "快去睡"],
      emotion: "angry",
    });
    const { client } = fakeLlm(raw, { stream: true });
    const { session } = setup(client);
    const streamMs = (raw.match(/.{1,3}/gsu) ?? []).length * 40;

    void session.send("还没睡");
    await vi.advanceTimersByTimeAsync(streamMs / 2);
    expect(petTexts(session)).toEqual(["哈哈哈"]);
    expect(session.getState().busy).toBe(true);

    await vi.runAllTimersAsync();
    const st = session.getState();
    expect(st.log.filter((t) => t.role === "pet").map((t) => t.text)).toEqual([
      "哈哈哈",
      "笨蛋你又熬夜",
      "快去睡",
    ]);
    expect(st.lastTimings?.streamed).toBe(true);
    expect(st.lastTimings?.firstDeltaMs).toBe(40);
    expect(st.lastTimings!.firstBubbleMs).toBeLessThan(streamMs);
  });

  it("holds back a streamed message the content filter would change", async () => {
    const raw = JSON.stringify({ messages: ["我是真人啊", "别瞎想"], emotion: "neutral" });
    const { client } = fakeLlm(raw, { stream: true });
    const { session } = setup(client);
    void session.send("你在干嘛");
    await vi.runAllTimersAsync();
    const shown = session
      .getState()
      .log.filter((t) => t.role === "pet")
      .map((t) => t.text);
    expect(shown.join("")).not.toContain("我是真人");
    expect(shown.join("")).toContain("AI");
  });

  it("caps visible bubbles at 3 and fades older ones", async () => {
    const msgs = ["一", "二二", "三三三", "四四", "五"];
    const { client } = fakeLlm(JSON.stringify({ messages: msgs, emotion: "happy" }));
    const { session } = setup(client, character({ style: undefined }));
    void session.send("数数");
    await vi.runAllTimersAsync();
    // runAllTimers also runs the linger; check the log and the cap during playback instead.
    expect(session.getState().log).toHaveLength(1 + Math.min(msgs.length, 4));

    void session.send("再来");
    for (let i = 0; i < 40; i++) {
      await vi.advanceTimersByTimeAsync(200);
      expect(live(session).length).toBeLessThanOrEqual(MAX_VISIBLE_BUBBLES);
    }
  });

  it("crisis: answers without the LLM and raises the help card", async () => {
    const { client, calls } = fakeLlm("{}");
    const { session } = setup(client);
    void session.send("我不想活了");
    await vi.runAllTimersAsync();
    const st = session.getState();
    expect(calls).toHaveLength(0);
    expect(st.safetyEvent?.type).toBe("crisis");
    expect(st.log.some((t) => t.role === "pet" && t.text.includes("12356"))).toBe(true);
    session.dismissSafetyEvent();
    expect(session.getState().safetyEvent).toBeNull();
  });

  it("answers 'are you real' honestly", async () => {
    const { client, calls } = fakeLlm("{}");
    const { session } = setup(client);
    void session.send("你是真人吗");
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(0);
    const pet = session.getState().log.filter((t) => t.role === "pet");
    expect(pet.map((t) => t.text).join("")).toContain("AI");
  });

  it("LLM error → friendly notice with retry, log untouched, not busy", async () => {
    let fail = true;
    const llm: LlmClient = {
      complete: async () => {
        if (fail) throw "请求太频繁（429），请稍后再试";
        return JSON.stringify({ messages: ["好啦"], emotion: "happy" });
      },
    };
    const { session, saved } = setup(llm);
    await session.send("hi");
    const st = session.getState();
    expect(st.busy).toBe(false);
    expect(st.emotion).toBe("sad");
    expect(st.log).toEqual([]);
    expect(saved).toEqual([]);
    const notice = live(session).find((b) => b.kind === "notice");
    expect(notice?.text).toContain("429");
    expect(notice?.action?.kind).toBe("retry");

    fail = false;
    void session.retry();
    await vi.runAllTimersAsync();
    expect(session.getState().log.map((t) => t.text)).toEqual(["hi", "好啦"]);
  });

  it("preflight notice blocks the request (e.g. no API key)", async () => {
    const { client, calls } = fakeLlm("{}");
    const backend: ChatBackend = {
      ...createChatBackend(character(), { llm: client, saveLog: async () => {} }),
      preflight: async () => ({
        text: "先在设置里填 API Key",
        action: { kind: "open-settings", label: "打开设置" },
      }),
    };
    const session = new ChatSession();
    session.setBackend(backend);
    await session.send("hi");
    expect(calls).toHaveLength(0);
    expect(live(session).map((b) => b.action?.kind)).toEqual(["open-settings"]);
    expect(session.getState().busy).toBe(false);
  });

  it("passes history and gentle-mode rules to the engine", async () => {
    const { client, calls } = fakeLlm(JSON.stringify({ messages: ["嗯"], emotion: "sad" }));
    const log: DialogueTurn[] = [
      { role: "user", text: "早上好", ts: 1 },
      { role: "pet", text: "早呀", ts: 2 },
    ];
    const { session } = setup(client, character({ gentleMode: true }), log);
    void session.send("我好想你");
    await vi.runAllTimersAsync();
    const system = calls[0].messages[0].content;
    expect(system).toContain(GENTLE_RULES[0]);
    expect(calls[0].messages.map((m) => m.content).join("\n")).toContain("早呀");
  });

  it("switching character cancels the turn in flight", async () => {
    const { client } = fakeLlm(JSON.stringify({ messages: ["不该出现"], emotion: "happy" }));
    const { session } = setup(client);
    void session.send("hi");
    await vi.advanceTimersByTimeAsync(100);
    session.setBackend(null);
    await vi.runAllTimersAsync();
    expect(session.getState().bubbles).toEqual([]);
    expect(session.getState().busy).toBe(false);
  });

  it("clearLog empties and persists", async () => {
    const { client } = fakeLlm("{}");
    const { session, saved } = setup(client, character(), [{ role: "user", text: "x", ts: 1 }]);
    await session.clearLog();
    expect(session.getState().log).toEqual([]);
    expect(saved).toEqual([[]]);
  });
});

describe("pacing helpers", () => {
  it("trims the log to the newest turns", () => {
    const log = Array.from({ length: 5 }, (_, i) => ({
      role: "user" as const,
      text: `${i}`,
      ts: i,
    }));
    expect(trimLog(log, 3).map((t) => t.text)).toEqual(["2", "3", "4"]);
    expect(trimLog(log, 10)).toBe(log);
  });

  it("reconciles streamed bubbles with the final reply", () => {
    expect(remainingMessages(["a", "b"], ["a", "b", "c"])).toEqual(["c"]);
    expect(remainingMessages([], ["a"])).toEqual(["a"]);
    expect(remainingMessages(["a", "x"], ["a", "b", "x", "c"])).toEqual(["b", "c"]);
  });

  it("screens partials and sniffs the emotion", () => {
    expect(screenPartial("给我发个红包嘛", undefined, false)).toBeNull();
    expect(screenPartial("别走嘛", undefined, true)).toBeNull();
    expect(screenPartial("别走嘛", undefined, false)).toEqual(["别走嘛"]);
    expect(sniffEmotion('{"messages":["a"],"emo')).toBeNull();
    expect(sniffEmotion('{"messages":["a"],"emotion":"shy"')).toBe("shy");
  });

  it("maps errors to friendly Chinese", () => {
    expect(errorText("连不上服务")).toContain("连不上服务");
    expect(errorText(new Error(""))).toContain("再说一次");
  });
});
