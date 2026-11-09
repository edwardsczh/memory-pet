/**
 * Deterministically generates the fictional demo chat between 阿哲 (user) and
 * 小鹿 (TA) from the handwritten snippets in demo-script.ts, 2024-03-01 to
 * 2024-08-31, and writes it as:
 *
 *   fixtures/demo/xiaolu-wechat-exporter.json  WeChatExporter chat.json
 *   fixtures/demo/xiaolu-plain.txt             "2024-03-01 08:12 小鹿: 内容"
 *   fixtures/demo/xiaolu-qq.txt                QQ 消息管理器 TXT
 *
 * Run: node scripts/gen-demo-chat.ts [seed]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  AFTERNOON,
  BUSY_DAY,
  CAT,
  DRINK,
  EVENING,
  EVENTS,
  MEMORY,
  MISS,
  MORNING,
  NIGHT,
  NOON,
  SHARE,
  SLOTS,
  TEASE,
  TOGETHER,
} from "./demo-script.ts";
import {
  type Conversation,
  type DemoKind,
  type DemoMessage,
  cst,
  fmt,
  writePlainInline,
  writeQQTxt,
  writeWechatExporterJson,
} from "./fixture-writers.ts";

const ME = "阿哲";
const TA = "小鹿";
const MIN = 60_000;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const seed = Number(process.argv[2] ?? 20240301);
const rand = mulberry32(seed);
const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
const chance = (p: number) => rand() < p;
const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];

/** Draws without replacement and reshuffles when exhausted, so snippets don't repeat back to back. */
function deck(items: string[]): () => string {
  let bag: string[] = [];
  return () => {
    if (!bag.length) {
      bag = [...items];
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
    }
    return bag.pop()!;
  };
}

const draw = {
  morning: deck(MORNING),
  noon: deck(NOON),
  afternoon: deck(AFTERNOON),
  evening: deck(EVENING),
  night: deck(NIGHT),
  busy: deck(BUSY_DAY),
  topical: deck([...CAT, ...DRINK, ...MISS, ...MEMORY, ...SHARE, ...TEASE]),
};

const TOGETHER_SNIPPETS = deck([
  "T 我在楼下买早餐\nT 你要豆浆还是牛奶\nM 豆浆",
  "M 我去买水\nM 你要喝什么\nT {drink}！",
  "T 你在哪\nT 我出来了\nM 门口",
]);

function fill(template: string): string {
  return template.replace(/\{(\w+)\}/g, (m, slot: string) => (SLOTS[slot] ? pick(SLOTS[slot]) : m));
}

function lineMessage(line: string, ts: number): DemoMessage | null {
  const sender = line[0] === "T" ? TA : ME;
  const body = line.slice(2).trim();
  const media: Record<string, DemoKind> = {
    "[图片]": "image",
    "[表情]": "sticker",
    "[语音]": "voice",
    "[视频]": "video",
  };
  if (media[body]) return { ts, sender, kind: media[body], text: "" };
  if (body === "[撤回]") return { ts, sender, kind: "recall", text: "" };
  if (body.startsWith("[红包]"))
    return { ts, sender, kind: "transfer", text: `红包 ${body.slice(4).trim()}` };
  if (body.startsWith("[转账]"))
    return { ts, sender, kind: "transfer", text: body.slice(4).trim() };
  if (body.startsWith("[链接]")) return { ts, sender, kind: "link", text: body.slice(4).trim() };
  return body ? { ts, sender, kind: "text", text: body } : null;
}

/** Lays one snippet out in time starting at `start`; returns the time of its last message. */
function play(snippet: string, start: number, out: DemoMessage[]): number {
  let t = start;
  let prev = "";
  for (const raw of fill(snippet).split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("~")) {
      t += Number(line.slice(1)) * MIN * between(0.8, 1.2);
      prev = "";
      continue;
    }
    if (prev) t += line[0] === prev ? between(3_000, 25_000) : between(15_000, 4 * MIN);
    prev = line[0];
    const msg = lineMessage(line, Math.round(t));
    if (!msg) continue;
    out.push(msg);
    if (msg.sender === TA && msg.kind === "text" && msg.text.length > 6 && chance(0.012)) {
      t += between(5_000, 20_000);
      out.push({ ts: Math.round(t), sender: TA, kind: "recall", text: "" });
    }
  }
  return t;
}

function at(day: Date, hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return cst(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), h, m);
}

function atMinutes(day: Date, minutes: number): number {
  return (
    cst(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()) + Math.round(minutes * MIN)
  );
}

const NO_NIGHT = new Set(["05-01", "05-13", "07-12", "07-14"]);

const messages: DemoMessage[] = [];
let lastEnd = 0;
const schedule = (start: number, snippet: string) => {
  lastEnd = play(snippet, Math.max(start, lastEnd + 35 * MIN), messages);
};

for (
  let d = new Date(Date.UTC(2024, 2, 1));
  d <= new Date(Date.UTC(2024, 7, 31));
  d.setUTCDate(d.getUTCDate() + 1)
) {
  const key = `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
  const examWeeks = key >= "06-10" && key <= "06-21";

  if (TOGETHER.includes(key)) {
    if (chance(0.6)) schedule(atMinutes(d, between(9 * 60, 17 * 60)), TOGETHER_SNIPPETS());
    continue;
  }
  const events = EVENTS[key];
  if (events) {
    for (const [time, snippet] of events) schedule(at(d, time), snippet);
    if (!NO_NIGHT.has(key) && chance(0.6))
      schedule(Math.max(lastEnd + 10 * MIN, at(d, "22:30")), draw.night());
    continue;
  }
  if (chance(examWeeks ? 0.35 : 0.07)) {
    schedule(atMinutes(d, between(21 * 60, 23 * 60)), draw.busy());
    continue;
  }

  if (chance(weekend ? 0.3 : 0.45)) {
    schedule(
      atMinutes(d, weekend ? between(9 * 60 + 30, 11 * 60) : between(7 * 60 + 20, 9 * 60 + 10)),
      draw.morning(),
    );
  }
  if (chance(0.35)) schedule(atMinutes(d, between(11 * 60 + 40, 13 * 60 + 10)), draw.noon());
  if (chance(weekend ? 0.4 : 0.15)) {
    schedule(
      atMinutes(d, between(14 * 60 + 30, 17 * 60 + 30)),
      chance(0.5) ? draw.afternoon() : draw.topical(),
    );
  }
  if (chance(0.88)) {
    schedule(atMinutes(d, between(20 * 60, 22 * 60 + 10)), draw.evening());
    if (chance(0.3)) lastEnd = play(draw.topical(), lastEnd + between(1, 6) * MIN, messages);
  }
  if (chance(0.65)) {
    const start = Math.max(
      lastEnd + between(5, 40) * MIN,
      atMinutes(d, between(22 * 60 + 30, 24 * 60 + 20)),
    );
    lastEnd = play(draw.night(), start, messages);
  }
}

messages.sort((a, b) => a.ts - b.ts);

const conversation: Conversation = {
  title: TA,
  self: ME,
  isGroup: false,
  ids: { [ME]: "wxid_azhe_demo", [TA]: "wxid_xiaolu_demo" },
  messages,
};
const qq: Conversation = { ...conversation, ids: { [ME]: "1000001", [TA]: "1000002" } };

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "demo");
mkdirSync(root, { recursive: true });
writeFileSync(join(root, "xiaolu-wechat-exporter.json"), writeWechatExporterJson(conversation));
writeFileSync(join(root, "xiaolu-plain.txt"), writePlainInline(conversation));
writeFileSync(join(root, "xiaolu-qq.txt"), writeQQTxt(qq));

const byKind: Record<string, number> = {};
for (const m of messages) byKind[m.kind] = (byKind[m.kind] ?? 0) + 1;
const first = messages[0].ts;
const last = messages[messages.length - 1].ts;
console.log(
  `seed ${seed}: ${messages.length} messages, ${fmt(first, "YYYY-MM-DD")} ~ ${fmt(last, "YYYY-MM-DD")}`,
  JSON.stringify(byKind),
);
