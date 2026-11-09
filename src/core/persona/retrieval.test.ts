import { describe, expect, it } from "vitest";
import type { Exemplar } from "../model";
import { mulberry32 } from "./exemplars";
import { ExemplarIndex, tokenize, type DenseRetriever } from "./retrieval";

const DAY = 86_400_000;

function ex(id: string, context: string, reply: string[], ts = 0): Exemplar {
  return { id, sessionId: id, ts, context, reply };
}

const corpus = [
  ex("food1", "晚上吃什么好", ["火锅吧", "好久没吃了"], 10 * DAY),
  ex("food2", "我饿了", ["那快去吃饭呀"], 20 * DAY),
  ex("sleep", "睡不着怎么办", ["数羊", "或者听歌"], 30 * DAY),
  ex("work", "老板又让我加班", ["绝了", "这老板"], 40 * DAY),
  ex("game", "晚上打游戏吗", ["来啊 几点"], 50 * DAY),
  ex("weather", "今天好冷", ["多穿点", "别感冒了"], 60 * DAY),
];

describe("tokenize", () => {
  it("Han unigrams + bigrams, Latin words, emoji", () => {
    expect(tokenize("吃饭OK😄[微笑]")).toEqual(["😄", "[微笑]", "吃", "吃饭", "饭", "ok"]);
  });

  it("normalizes full-width Latin", () => {
    expect(tokenize("ＯＫ")).toEqual(["ok"]);
  });
});

describe("ExemplarIndex", () => {
  const index = ExemplarIndex.build(corpus);

  it("finds topically related exemplars first", () => {
    expect(index.search("今晚吃什么", 2)[0].exemplar.id).toBe("food1");
    expect(index.search("又要加班了好烦", 1)[0].exemplar.id).toBe("work");
    expect(index.search("好冷啊", 1)[0].exemplar.id).toBe("weather");
  });

  it("pads with most recent exemplars when nothing matches", () => {
    const hits = index.search("量子力学", 3);
    expect(hits.map((h) => h.exemplar.id)).toEqual(["weather", "game", "work"]);
    expect(hits.every((h) => h.score === 0)).toBe(true);
  });

  it("can disable padding", () => {
    const idx = ExemplarIndex.build(corpus, { fillWithRecent: false });
    expect(idx.search("量子力学", 3)).toEqual([]);
  });

  it("recency breaks ties between equally relevant exemplars", () => {
    const idx = ExemplarIndex.build(
      [ex("old", "早安", ["早"], 0), ex("new", "早安", ["早呀"], 400 * DAY)],
      {
        mmrLambda: 1,
      },
    );
    expect(idx.search("早安", 1)[0].exemplar.id).toBe("new");
  });

  it("MMR prefers a diverse second result over a near-duplicate", () => {
    const idx = ExemplarIndex.build(
      [
        ex("a", "周末去爬山吗", ["去去去"], 1),
        ex("a-dup", "周末去爬山吗", ["去去去"], 2),
        ex("b", "周末去看电影吗", ["好呀 看啥"], 3),
      ],
      { mmrLambda: 0.5 },
    );
    const ids = idx.search("周末去爬山", 2).map((h) => h.exemplar.id);
    expect(ids).toContain("b");
  });

  it("round-trips through JSON", () => {
    const restored = ExemplarIndex.fromJSON(JSON.parse(JSON.stringify(index)));
    expect(restored.size).toBe(index.size);
    for (const q of ["今晚吃什么", "睡不着", "游戏"]) {
      expect(restored.search(q, 3)).toEqual(index.search(q, 3));
    }
  });

  it("rejects unknown formats", () => {
    expect(() => ExemplarIndex.fromJSON({ version: 2 } as never)).toThrow();
  });

  it("hybrid search fuses dense results", async () => {
    const dense: DenseRetriever = {
      search: async () => [{ id: "sleep", score: 0.9 }],
    };
    const hits = await index.searchHybrid("量子力学", 2, dense);
    expect(hits[0].exemplar.id).toBe("sleep");
  });

  it("empty index", () => {
    expect(ExemplarIndex.build([]).search("你好")).toEqual([]);
  });
});

describe("ExemplarIndex performance", () => {
  it("10k exemplars: single query well under 200ms", () => {
    const rand = mulberry32(1);
    const vocab = Array.from(
      "的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经十三之进着等部度家电力里如水化高自二理起小物现实加量都两体制机当使点从业本去把性好应开它合还因由其些然前外天政四日那社义事平形相全表间样与关各重新线内数正心反你明看原又么利比或但质气第向道命此变条只没结解问意建月公无系军很情者最立代想已通并提直题党程展五果料象员革位入常文总次品式活设及管特件长求老头基资边流路级少图山统接知较将组见计别她手角期根论运农指几九区强放决西被干做必战先回则任取据处府县",
    );
    const pick = () => vocab[Math.floor(rand() * vocab.length)];
    const sentence = (n: number) => Array.from({ length: n }, pick).join("");
    const data: Exemplar[] = [];
    for (let i = 0; i < 10_000; i++) {
      data.push(ex(`e${i}`, sentence(4 + Math.floor(rand() * 30)), [sentence(6)], i * 60_000));
    }

    const t0 = performance.now();
    const index = ExemplarIndex.build(data);
    const buildMs = performance.now() - t0;

    const queries = Array.from({ length: 50 }, () => sentence(12));
    index.search(queries[0], 6);
    const times: number[] = [];
    for (const q of queries) {
      const t = performance.now();
      const hits = index.search(q, 6);
      times.push(performance.now() - t);
      expect(hits).toHaveLength(6);
    }
    times.sort((a, b) => a - b);
    const p50 = times[Math.floor(times.length / 2)];
    const max = times[times.length - 1];
    console.info(
      `[retrieval perf] 10k exemplars: build ${buildMs.toFixed(1)}ms, query p50 ${p50.toFixed(2)}ms, max ${max.toFixed(2)}ms`,
    );
    expect(max).toBeLessThan(200);
  });
});
