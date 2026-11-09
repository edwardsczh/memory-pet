import { describe, expect, it } from "vitest";
import type {
  DialogueTurn,
  Exemplar,
  LlmClient,
  LlmRequest,
  PersonaCard,
  StyleProfile,
} from "../model";
import { ExemplarIndex } from "../persona/retrieval";
import { DialogueEngine, exemplarCount, temperatureFor, type SafetyHooks } from "./engine";
import { buildSystemPrompt } from "./prompt";

const persona: PersonaCard = {
  name: "小雨",
  relation: "好朋友",
  summary: "热情、爱运动的大学同学",
  traits: [
    { text: "喜欢跑步和瑜伽", evidence: [{ messageId: "m1", ts: 0, excerpt: "我在练瑜伽" }] },
    { text: "说话直接，爱吐槽", evidence: [{ messageId: "m2", ts: 0, excerpt: "绝了" }] },
  ],
  addressing: ["宝"],
  taboos: ["催婚"],
  userNotes: "她叫我宝",
  updatedAt: 0,
};

const style: StyleProfile = {
  messageCount: 200,
  avgLength: 7,
  medianLength: 6,
  avgBurst: 2.2,
  periodRate: 0.01,
  punctuation: [{ token: "～", rate: 0.2 }],
  catchphrases: [{ phrase: "绝了", count: 12 }],
  emojiRate: 0.2,
  topEmojis: ["[呲牙]"],
  activeHours: new Array(24).fill(1 / 24),
  nicknamesForMe: ["宝"],
  firstTs: 0,
  lastTs: 0,
};

const exemplars: Exemplar[] = [
  {
    id: "e1",
    sessionId: "s1",
    ts: 1,
    context: "我加班到现在",
    reply: ["绝了", "你们老板是魔鬼吧"],
  },
  { id: "e2", sessionId: "s2", ts: 2, context: "周末去爬山吗", reply: ["去！", "几点"] },
  {
    id: "e3",
    sessionId: "s3",
    ts: 3,
    context: "我好困",
    reply: ["快睡～"],
    prior: [{ role: "ta", text: "还没睡？" }],
  },
];

const history: DialogueTurn[] = [
  { role: "user", text: "在吗", ts: 1 },
  { role: "pet", text: "在呢宝～", ts: 2 },
];

const NOW = new Date(2026, 10, 9, 18, 16).getTime();

function recordingLlm(answer = '{"messages": ["绝了。", "又加班？"], "emotion": "angry"}') {
  const requests: LlmRequest[] = [];
  const llm: LlmClient = {
    async complete(req) {
      requests.push(req);
      return answer;
    },
  };
  return { llm, requests };
}

describe("buildSystemPrompt", () => {
  const prompt = buildSystemPrompt({
    persona,
    style,
    exemplars,
    history,
    userText: "今天又加班",
    now: NOW,
  });

  it("contains the honesty and identity rules", () => {
    expect(prompt).toContain("不是小雨本人");
    expect(prompt).toContain("必须如实说明你是模仿小雨说话方式的 AI");
    expect(prompt).toContain("不编造");
    expect(prompt).toContain("不承诺任何现实中的行动");
    expect(prompt).toContain("不假装小雨此刻真实在线");
  });

  it("contains persona, style, exemplars, history and time", () => {
    expect(prompt).toContain("热情、爱运动的大学同学");
    expect(prompt).toContain("- 喜欢跑步和瑜伽");
    expect(prompt).toContain("催婚");
    expect(prompt).toContain("用户补充：她叫我宝");
    expect(prompt).toContain("「绝了」");
    expect(prompt).toContain("用户：我加班到现在\nTA：绝了 / 你们老板是魔鬼吧");
    expect(prompt).toContain("TA：还没睡？\n用户：我好困\nTA：快睡～");
    expect(prompt).toContain("# 近期对话\n用户：在吗\nTA：在呢宝～");
    expect(prompt).toContain("2026年11月9日 星期一 18:16（晚上）");
    expect(prompt).toContain('"messages"');
  });

  it("puts rules before everything else and format last", () => {
    expect(prompt.indexOf("# 身份与规则")).toBe(0);
    expect(prompt.trimEnd().endsWith("之一。")).toBe(true);
  });

  it("trims exemplars and old history to the budget but never the rules", () => {
    const longHistory: DialogueTurn[] = Array.from({ length: 40 }, (_, i) => ({
      role: i % 2 ? "pet" : "user",
      text: `第${i}句` + "很长的话".repeat(20),
      ts: i,
    }));
    const manyEx: Exemplar[] = Array.from({ length: 30 }, (_, i) => ({
      id: `x${i}`,
      sessionId: "s",
      ts: i,
      context: `问题${i}` + "内容".repeat(30),
      reply: ["回答" + "内容".repeat(30)],
    }));
    const small = buildSystemPrompt({
      persona,
      style,
      exemplars: manyEx,
      history: longHistory,
      userText: "hi",
      now: NOW,
      budgetChars: 3000,
    });
    expect(small.length).toBeLessThanOrEqual(3000);
    expect(small).toContain("必须如实说明");
    expect(small).toContain("# 输出格式");
    expect(small).toContain("第39句");
    expect(small).not.toContain("第0句");
    expect(small).toContain("问题0");
    expect(small).not.toContain("问题29");
  });
});

describe("DialogueEngine", () => {
  it("assembles the prompt with retrieved exemplars and parses the reply", async () => {
    const { llm, requests } = recordingLlm();
    const engine = new DialogueEngine({
      llm,
      persona,
      style,
      index: ExemplarIndex.build(exemplars),
      now: () => NOW,
    });
    const reply = await engine.reply(history, "今天又加班到十点");
    expect(reply).toEqual({ messages: ["绝了", "又加班？"], emotion: "angry" });

    const [req] = requests;
    expect(req.json).toBe(true);
    expect(req.temperature).toBe(temperatureFor(0.7));
    expect(req.messages[0].role).toBe("system");
    expect(req.messages[0].content).toContain("用户：我加班到现在");
    expect(req.messages[0].content).toContain("用户：在吗");
    expect(req.messages[1]).toEqual({ role: "user", content: "今天又加班到十点" });
  });

  it("styleStrength controls exemplar count and temperature", () => {
    expect(exemplarCount(0)).toBe(2);
    expect(exemplarCount(0.5)).toBe(6);
    expect(exemplarCount(1)).toBe(10);
    expect(temperatureFor(0)).toBe(0.5);
    expect(temperatureFor(1)).toBe(1);

    const searched: number[] = [];
    const engine = new DialogueEngine({
      llm: recordingLlm().llm,
      persona,
      index: {
        search: (_q, k = 6) => {
          searched.push(k);
          return [];
        },
      },
    });
    engine.buildRequest([], "hi", { styleStrength: 0 });
    engine.buildRequest([], "hi", { styleStrength: 1 });
    expect(searched).toEqual([2, 10]);
  });

  it("uses the previous turn as retrieval context for very short messages", () => {
    const queries: string[] = [];
    const engine = new DialogueEngine({
      llm: recordingLlm().llm,
      persona,
      index: { search: (q) => (queries.push(q), []) },
    });
    engine.buildRequest(history, "嗯");
    engine.buildRequest(history, "今天好累啊");
    expect(queries).toEqual(["在呢宝～\n嗯", "今天好累啊"]);
  });

  it("safety precheck short-circuits the LLM", async () => {
    const { llm, requests } = recordingLlm();
    const safety: SafetyHooks = {
      precheck: (t) =>
        t.includes("真人")
          ? { messages: ["我是模仿小雨的 AI"], emotion: "neutral", safety: "ai-identity" }
          : null,
      postcheck: (r) => r,
    };
    const engine = new DialogueEngine({ llm, persona, safety });
    const r = await engine.reply([], "你是真人吗");
    expect(r.safety).toBe("ai-identity");
    expect(requests).toHaveLength(0);
  });

  it("safety postcheck sees the post-processed reply", async () => {
    const seen: string[][] = [];
    const engine = new DialogueEngine({
      llm: recordingLlm().llm,
      persona,
      style,
      safety: {
        precheck: () => null,
        postcheck: (r) => (
          seen.push(r.messages),
          { ...r, messages: [...r.messages, "（已检查）"] }
        ),
      },
    });
    const r = await engine.reply([], "hi");
    expect(seen).toEqual([["绝了", "又加班？"]]);
    expect(r.messages).toContain("（已检查）");
  });

  it("plain-text and empty answers still produce a reply", async () => {
    const plain = new DialogueEngine({ llm: recordingLlm("好呀\n几点").llm, persona });
    expect((await plain.reply([], "去吗")).messages).toEqual(["好呀", "几点"]);
    const empty = new DialogueEngine({ llm: recordingLlm("").llm, persona });
    expect((await empty.reply([], "去吗")).messages.length).toBeGreaterThan(0);
  });

  it("streams partial bubbles when the client supports it", async () => {
    const chunks = ['{"messages": ["好', '呀", "几点', '见"], "emotion"', ': "happy"}'];
    const llm: LlmClient = {
      complete: async () => {
        throw new Error("should stream");
      },
      async stream(_req, onDelta) {
        for (const c of chunks) onDelta(c);
        return chunks.join("");
      },
    };
    const deltas: string[] = [];
    const partials: string[][] = [];
    const engine = new DialogueEngine({ llm, persona });
    const r = await engine.reply([], "去吗", {
      onDelta: (d) => deltas.push(d),
      onPartial: (m) => partials.push(m),
    });
    expect(deltas).toEqual(chunks);
    expect(partials).toEqual([["好呀"], ["好呀", "几点见"]]);
    expect(r).toEqual({ messages: ["好呀", "几点见"], emotion: "happy" });
  });

  it("echo LLM: system prompt reaches the model intact", async () => {
    const llm: LlmClient = {
      complete: async (req) =>
        JSON.stringify({ messages: [req.messages[0].content.slice(0, 7)], emotion: "neutral" }),
    };
    const engine = new DialogueEngine({ llm, persona });
    expect((await engine.reply([], "hi")).messages[0]).toBe("# 身份与规则");
  });
});
