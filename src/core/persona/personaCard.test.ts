import { describe, expect, it } from "vitest";
import type { LlmClient, LlmRequest, Session } from "../model";
import { makeSession } from "../testing/sessions";
import { estimatePersonaCost, generatePersonaCard, type PersonaProgress } from "./personaCard";

const T = Date.UTC(2024, 2, 1, 12);
const subject = { name: "小雨", relation: "朋友" };

function manySessions(n: number): Session[] {
  return Array.from({ length: n }, (_, i) =>
    makeSession(`s${i}`, T + i * 86_400_000, [
      ["me", `今天第${i}天，去跑步了`],
      ["ta", "厉害啊", "我最近也在练瑜伽，周末一起？"],
      ["me", "好啊"],
      ["ta", "那说定了哈哈哈"],
    ]),
  );
}

/** Answers extraction calls with the first TA alias it sees, plus a made-up one. */
function fakeLlm(mergeAnswer?: (req: LlmRequest) => string) {
  const calls: LlmRequest[] = [];
  const llm: LlmClient = {
    async complete(req) {
      calls.push(req);
      const sys = req.messages[0].content;
      const user = req.messages[1].content;
      if (sys.startsWith("下面是从") && mergeAnswer) return mergeAnswer(req);
      if (sys.startsWith("下面是从")) {
        const all = JSON.parse(user) as { traits: { text: string; evidence: string[] }[] }[];
        return JSON.stringify({
          summary: "爱运动、很热情的朋友",
          traits: [
            { text: "热爱运动，最近在练瑜伽", evidence: all.flatMap((c) => c.traits[0].evidence) },
            { text: "编出来的特点", evidence: ["m99999"] },
          ],
          addressing: [],
          taboos: ["熬夜"],
        });
      }
      const taAlias = /\[(m\d+)\] 小雨：/.exec(user)![1];
      return (
        "好的，分析如下：\n```json\n" +
        JSON.stringify({
          summary: "热情",
          traits: [
            { text: "热爱运动，最近在练瑜伽", evidence: [taAlias, "m88888"] },
            { text: "没有证据的结论", evidence: [] },
            { text: "只有幻觉证据", evidence: ["m77777", "msg-does-not-exist"] },
          ],
          addressing: ["你"],
          taboos: [],
        }) +
        "\n```"
      );
    },
  };
  return { llm, calls };
}

describe("estimatePersonaCost", () => {
  it("matches the number of extraction calls", async () => {
    const sessions = manySessions(60);
    const est = estimatePersonaCost(sessions, { batchChars: 600 });
    expect(est.batches).toBeGreaterThan(1);
    expect(est.approxTokens).toBeGreaterThan(0);
    expect(est.approxInputChars).toBeGreaterThan(est.approxTokens);
    const { llm, calls } = fakeLlm();
    await generatePersonaCard(sessions, subject, llm, { batchChars: 600 });
    expect(calls.filter((c) => c.messages[0].content.startsWith("你是")).length).toBe(est.batches);
  });

  it("caps batches by sampling", () => {
    expect(estimatePersonaCost(manySessions(60), { batchChars: 300, maxBatches: 5 }).batches).toBe(
      5,
    );
  });

  it("no TA messages, no batches", () => {
    const s = makeSession("s", T, [["me", "在吗"]]);
    expect(estimatePersonaCost([s]).batches).toBe(0);
  });
});

describe("generatePersonaCard", () => {
  it("single batch: keeps only evidence that exists in the data", async () => {
    const sessions = manySessions(2);
    const { llm, calls } = fakeLlm();
    const card = await generatePersonaCard(sessions, subject, llm, {
      now: () => 123,
      userNotes: "备注",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].json).toBe(true);
    expect(calls[0].messages[1].content).toContain("[m1] 我：今天第0天，去跑步了");
    expect(card).toMatchObject({
      name: "小雨",
      relation: "朋友",
      summary: "热情",
      addressing: ["你"],
      userNotes: "备注",
      updatedAt: 123,
    });
    expect(card.traits).toHaveLength(1);
    expect(card.traits[0].evidence).toEqual([
      { messageId: "s0-1", ts: T + 60_000, excerpt: "厉害啊" },
    ]);
  });

  it("multiple batches are merged by the LLM, hallucinated evidence dropped", async () => {
    const sessions = manySessions(30);
    const { llm, calls } = fakeLlm();
    const progress: PersonaProgress[] = [];
    const card = await generatePersonaCard(sessions, subject, llm, {
      batchChars: 500,
      onProgress: (p) => progress.push(p),
    });
    expect(calls.some((c) => c.messages[0].content.startsWith("下面是从"))).toBe(true);
    expect(card.summary).toBe("爱运动、很热情的朋友");
    expect(card.taboos).toEqual(["熬夜"]);
    expect(card.traits.map((t) => t.text)).toEqual(["热爱运动，最近在练瑜伽"]);
    expect(card.traits[0].evidence).toHaveLength(3);
    const ids = new Set(
      sessions.flatMap((s) => s.turns.flatMap((t) => t.messages.map((m) => m.id))),
    );
    for (const e of card.traits[0].evidence) expect(ids.has(e.messageId)).toBe(true);

    const extract = progress.filter((p) => p.stage === "extract");
    expect(extract[0].done).toBe(0);
    expect(extract[extract.length - 1].done).toBe(extract[0].total);
    expect(progress.some((p) => p.stage === "merge")).toBe(true);
    expect(progress[progress.length - 1].stage).toBe("done");
  });

  it("falls back to a local merge when the merge answer is not JSON", async () => {
    const { llm } = fakeLlm(() => "抱歉，我无法完成");
    const card = await generatePersonaCard(manySessions(30), subject, llm, { batchChars: 500 });
    expect(card.traits.map((t) => t.text)).toEqual(["热爱运动，最近在练瑜伽"]);
    expect(card.traits[0].evidence.length).toBeGreaterThan(0);
  });

  it("accepts real message ids as evidence", async () => {
    const llm: LlmClient = {
      complete: async () =>
        JSON.stringify({ summary: "", traits: [{ text: "爱笑", evidence: ["s0-3", "[m2]"] }] }),
    };
    const card = await generatePersonaCard(manySessions(1), subject, llm);
    expect(card.traits[0].evidence.map((e) => e.messageId)).toEqual(["s0-3", "s0-1"]);
  });

  it("can be cancelled", async () => {
    const controller = new AbortController();
    let calls = 0;
    const llm: LlmClient = {
      complete: (req) =>
        new Promise((resolve) => {
          calls++;
          expect(req.signal).toBe(controller.signal);
          setTimeout(() => resolve("{}"), 50);
        }),
    };
    const p = generatePersonaCard(manySessions(30), subject, llm, {
      batchChars: 500,
      concurrency: 1,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 10);
    await expect(p).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 80));
    expect(calls).toBe(1);
  });
});
