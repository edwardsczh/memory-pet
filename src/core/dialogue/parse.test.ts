import { describe, expect, it } from "vitest";
import { normalizeEmotion, parseReply, partialMessages } from "./parse";

describe("parseReply: well-formed and common wrappers", () => {
  const cases: [string, string, string[], string][] = [
    ["plain JSON", '{"messages": ["好呀", "几点"], "emotion": "happy"}', ["好呀", "几点"], "happy"],
    ["json fence", '```json\n{"messages": ["好呀"], "emotion": "sad"}\n```', ["好呀"], "sad"],
    ["bare fence", '```\n{"messages": ["好呀"], "emotion": "sad"}\n```', ["好呀"], "sad"],
    ["unclosed fence", '```json\n{"messages": ["好呀"], "emotion": "shy"}', ["好呀"], "shy"],
    [
      "prose before",
      '好的，这是回复：{"messages": ["嗯嗯"], "emotion": "happy"}',
      ["嗯嗯"],
      "happy",
    ],
    [
      "prose after",
      '{"messages": ["嗯嗯"], "emotion": "happy"}\n希望这样可以！',
      ["嗯嗯"],
      "happy",
    ],
    ["trailing commas", '{"messages": ["a", "b",], "emotion": "happy",}', ["a", "b"], "happy"],
    [
      "single quotes",
      "{'messages': ['好的', '去吧'], 'emotion': 'angry'}",
      ["好的", "去吧"],
      "angry",
    ],
    ["smart quotes", "{“messages”: [“好的”], “emotion”: “happy”}", ["好的"], "happy"],
    ["unquoted keys", '{messages: ["好的"], emotion: "thinking"}', ["好的"], "thinking"],
    ["chinese colon", '{"messages"： ["好的"], "emotion"： "happy"}', ["好的"], "happy"],
    [
      "raw newline in string",
      '{"messages": ["第一句\n第二句"], "emotion": "happy"}',
      ["第一句", "第二句"],
      "happy",
    ],
    [
      "escaped newline",
      '{"messages": ["第一句\\n第二句"], "emotion": "happy"}',
      ["第一句", "第二句"],
      "happy",
    ],
    ["string instead of array", '{"messages": "就一句", "emotion": "happy"}', ["就一句"], "happy"],
    ["singular key", '{"message": "就一句", "emotion": "happy"}', ["就一句"], "happy"],
    ["reply key", '{"reply": ["行"], "mood": "happy"}', ["行"], "happy"],
    ["nested", '{"reply": {"messages": ["行"], "emotion": "sad"}}', ["行"], "sad"],
    [
      "object items",
      '{"messages": [{"text": "a"}, {"content": "b"}], "emotion": "happy"}',
      ["a", "b"],
      "happy",
    ],
    ["bare array", '["好", "那走吧"]', ["好", "那走吧"], "neutral"],
    ["upper-case keys", '{"Messages": ["行"], "Emotion": "HAPPY"}', ["行"], "happy"],
    ["emotion synonym", '{"messages": ["行"], "emotion": "开心"}', ["行"], "happy"],
    ["emotion invalid", '{"messages": ["行"], "emotion": "ecstatic"}', ["行"], "neutral"],
    ["emotion missing", '{"messages": ["行"]}', ["行"], "neutral"],
    ["emotion non-string", '{"messages": ["行"], "emotion": 3}', ["行"], "neutral"],
    [
      "speaker prefix",
      '{"messages": ["TA：好呀", "TA: 走"], "emotion": "happy"}',
      ["好呀", "走"],
      "happy",
    ],
    [
      "empty strings dropped",
      '{"messages": ["", "  ", "嗯"], "emotion": "happy"}',
      ["嗯"],
      "happy",
    ],
    ["BOM", '\uFEFF{"messages": ["嗯"], "emotion": "happy"}', ["嗯"], "happy"],
    ["CRLF", '{\r\n"messages": ["嗯"],\r\n"emotion": "happy"\r\n}', ["嗯"], "happy"],
    [
      "braces inside text",
      '{"messages": ["你看 {这个} [那个]"], "emotion": "happy"}',
      ["你看 {这个} [那个]"],
      "happy",
    ],
    ["escaped quotes", '{"messages": ["他说\\"好\\""], "emotion": "happy"}', ['他说"好"'], "happy"],
    [
      "emoji",
      '{"messages": ["好耶😄", "[微笑]"], "emotion": "happy"}',
      ["好耶😄", "[微笑]"],
      "happy",
    ],
  ];
  for (const [name, raw, messages, emotion] of cases) {
    it(name, () => {
      expect(parseReply(raw)).toEqual({ messages, emotion });
    });
  }
});

describe("parseReply: broken output", () => {
  it("truncated mid-string", () => {
    expect(parseReply('{"messages": ["好呀", "几点见')).toEqual({
      messages: ["好呀", "几点见"],
      emotion: "neutral",
    });
  });

  it("truncated before emotion value", () => {
    expect(parseReply('{"messages": ["好呀"], "emotion": ').messages).toEqual(["好呀"]);
  });

  it("unescaped quotes inside a message", () => {
    expect(parseReply('{"messages": ["他说"好的"就走了", "嗯"], "emotion": "sad"}')).toEqual({
      messages: ['他说"好的"就走了', "嗯"],
      emotion: "sad",
    });
  });

  it("plain text falls back to lines", () => {
    expect(parseReply("好呀\n\n几点见？")).toEqual({
      messages: ["好呀", "几点见？"],
      emotion: "neutral",
    });
  });

  it("plain text with bullets, quotes and an emotion line", () => {
    expect(parseReply('- "好呀"\n- 几点见？\nemotion: happy')).toEqual({
      messages: ["好呀", "几点见？"],
      emotion: "happy",
    });
  });

  it("plain text that starts with a WeChat emoji code", () => {
    expect(parseReply("[微笑] 好的")).toEqual({ messages: ["[微笑] 好的"], emotion: "neutral" });
  });

  it("JSON without messages falls back to the text", () => {
    expect(parseReply('{"emotion": "sad"}').emotion).toBe("sad");
    expect(parseReply('{"emotion": "sad"}').messages.length).toBeGreaterThan(0);
  });

  it("blank input yields no messages", () => {
    expect(parseReply("")).toEqual({ messages: [], emotion: "neutral" });
    expect(parseReply("   \n ")).toEqual({ messages: [], emotion: "neutral" });
  });

  it("never throws on junk", () => {
    for (const junk of [
      "{",
      "}",
      "[",
      "]]]",
      '{"messages": [',
      '"',
      "{{{{",
      "```",
      "null",
      "123",
    ]) {
      expect(() => parseReply(junk)).not.toThrow();
    }
  });
});

describe("parseReply success rate on generated malformations", () => {
  const msgSets = [
    ["好呀"],
    ["哈哈哈哈", "笑死我了"],
    ["在呢～", "怎么啦", "想我了？"],
    ["今天降温了", "多穿点哦", "别感冒了😷"],
    ["嗯嗯", "[微笑]"],
  ];
  const emotions = ["happy", "sad", "neutral", "shy", "thinking", "surprised", "angry"];
  type Mutator = (json: string) => string;
  const wrappers: Mutator[] = [
    (j) => j,
    (j) => "```json\n" + j + "\n```",
    (j) => "```\n" + j + "\n```",
    (j) => "好的：\n" + j,
    (j) => j + "\n\n（以上是回复）",
    (j) => "Sure! Here you go:\n```json\n" + j + "\n```\nLet me know.",
    (j) => "  \n" + j + "  \n",
  ];
  const mutators: Mutator[] = [
    (j) => j,
    (j) => j.replace(/]/, ",]").replace(/}$/, ",}"),
    (j) => j.replace(/"/g, "'"),
    (j) => j.replace(/"(messages|emotion)"/g, "$1"),
    (j) => j.replace(/"(messages|emotion)"/g, "“$1”"),
    (j) => j.replace(/, /g, ",\n  ").replace("{", "{\n  "),
    (j) => j.replace(/("emotion":\s*")\w+/, "$1WHATEVER"),
    (j) => j.replace(/,\s*"emotion".*$/, ""),
    (j) => j.slice(0, j.lastIndexOf("]")),
  ];

  it("≥ 99% recover the exact messages", () => {
    let total = 0;
    let ok = 0;
    const failures: string[] = [];
    for (const msgs of msgSets) {
      for (const emo of emotions) {
        const json = JSON.stringify({ messages: msgs, emotion: emo })
          .replace(/,"/g, ', "')
          .replace(/":/g, '": ');
        for (const w of wrappers) {
          for (const m of mutators) {
            const raw = w(m(json));
            total++;
            const r = parseReply(raw);
            if (JSON.stringify(r.messages) === JSON.stringify(msgs)) ok++;
            else failures.push(raw);
          }
        }
      }
    }
    const rate = ok / total;
    console.info(
      `[parseReply] ${ok}/${total} malformed variants recovered (${(rate * 100).toFixed(2)}%)`,
    );
    expect(total).toBeGreaterThan(2000);
    expect(rate, failures.slice(0, 5).join("\n---\n")).toBeGreaterThanOrEqual(0.99);
  });
});

describe("normalizeEmotion", () => {
  it("maps valid, synonyms and junk", () => {
    expect(normalizeEmotion("Happy ")).toBe("happy");
    expect(normalizeEmotion("害羞")).toBe("shy");
    expect(normalizeEmotion("lol")).toBe("neutral");
    expect(normalizeEmotion(undefined)).toBe("neutral");
  });
});

describe("partialMessages", () => {
  it("returns only completed strings", () => {
    expect(partialMessages('{"messages": ["好呀", "几点')).toEqual(["好呀"]);
    expect(partialMessages('{"messages": ["好呀", "几点"], "emo')).toEqual(["好呀", "几点"]);
    expect(partialMessages('{"mess')).toEqual([]);
  });
});
