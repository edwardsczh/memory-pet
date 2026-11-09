import type { Session, StyleProfile } from "../model";
import { charLength, extractEmojis, stripEmojis } from "../text/chars";
import { messagesOf, textMessages } from "./sessions";

export interface StyleOptions {
  /** Hour-of-day for activeHours; defaults to the runtime's local time zone. */
  hourOf?: (ts: number) => number;
  /** Minimum number of TA messages a phrase must appear in. Default 3. */
  minPhraseCount?: number;
  maxCatchphrases?: number;
  maxEmojis?: number;
  /** Markers rarer than this share of TA messages are omitted. Default 0.02. */
  minMarkerRate?: number;
  /** The user's display names, to recognise TA calling the user by (part of) name. */
  meNames?: string[];
}

interface Marker {
  token: string;
  test: (text: string, tail: string, core: string) => boolean;
}

const FINAL_PARTICLES = [
  "嘛",
  "呀",
  "啦",
  "呢",
  "吧",
  "哦",
  "噢",
  "喔",
  "哇",
  "咯",
  "嘞",
  "呐",
  "捏",
  "鸭",
];

/** `tail`: text without trailing emoji/space. `core`: tail without trailing punctuation. */
const MARKERS: Marker[] = [
  { token: "～", test: (_t, tail) => /[～~]$/.test(tail) },
  { token: "！", test: (_t, tail) => /[！!]$/.test(tail) },
  { token: "？", test: (_t, tail) => /[？?]$/.test(tail) },
  { token: "。。。", test: (t) => /。{2,}|…|\.{3,}/.test(t) },
  { token: "！！", test: (t) => /[！!]{2,}/.test(t) },
  { token: "？？", test: (t) => /[？?]{2,}/.test(t) },
  { token: "哈哈", test: (t) => /哈{2,}/.test(t) },
  { token: "hhh", test: (t) => /h{3,}/i.test(t) },
  { token: "233", test: (t) => /233/.test(t) },
  { token: "嗯嗯", test: (t) => /嗯嗯/.test(t) },
  { token: "嘿嘿", test: (t) => /嘿嘿/.test(t) },
  { token: "嘻嘻", test: (t) => /嘻嘻/.test(t) },
  { token: "呜呜", test: (t) => /呜{2,}/.test(t) },
  { token: "emm", test: (t) => /em{2,}/i.test(t) },
  ...FINAL_PARTICLES.map((p): Marker => ({
    token: p,
    test: (_t, _tail, core) => core.endsWith(p),
  })),
];

/** Characters that make an n-gram uninteresting when it consists only of them. */
const STOP_CHARS = new Set(
  "的了是我你他她它们在有和就都也这那个啊吗呢吧呀啦嘛哦噢嗯哈不没要会去说到着过来上下一很还又被把给对与及或而之其得地么什怎为好".split(
    "",
  ),
);

const ADDRESS_LEXICON = new Set([
  "宝",
  "宝宝",
  "宝贝",
  "宝儿",
  "贝贝",
  "亲",
  "亲爱的",
  "亲爱哒",
  "老公",
  "老婆",
  "媳妇",
  "笨蛋",
  "傻瓜",
  "傻子",
  "傻蛋",
  "猪",
  "猪猪",
  "小猪",
  "憨憨",
  "哥",
  "姐",
  "哥哥",
  "姐姐",
  "弟弟",
  "妹妹",
  "老弟",
  "老妹",
  "儿子",
  "闺女",
  "女儿",
  "乖",
  "乖乖",
  "孩子",
  "娃",
  "崽",
  "崽崽",
  "兄弟",
  "老铁",
  "大哥",
  "姐妹",
  "老板",
  "同学",
  "小可爱",
  "小朋友",
  "小笨蛋",
  "小傻瓜",
  "dear",
  "honey",
  "baby",
  "babe",
  "bro",
]);

/** Reduplications and 小X/老X words that are not forms of address. */
const NOT_ADDRESS = new Set([
  "哈哈",
  "嗯嗯",
  "嘿嘿",
  "嘻嘻",
  "呵呵",
  "呜呜",
  "啊啊",
  "哦哦",
  "噢噢",
  "喔喔",
  "好好",
  "对对",
  "是是",
  "行行",
  "拜拜",
  "谢谢",
  "来来",
  "走走",
  "看看",
  "想想",
  "等等",
  "慢慢",
  "刚刚",
  "常常",
  "天天",
  "偷偷",
  "快快",
  "小心",
  "小时",
  "小事",
  "小的",
  "老是",
  "老实",
  "老了",
  "老子",
  "阿姨",
]);

const SEP_RE = /[，,。！!？?～~\s、…；;：:]+/;

function tailOf(text: string): string {
  return stripEmojis(text).trimEnd();
}

function looksLikeAddress(word: string, meNames: string[]): boolean {
  if (NOT_ADDRESS.has(word)) return false;
  if (ADDRESS_LEXICON.has(word.toLowerCase())) return true;
  const chars = Array.from(word);
  if (chars.length === 2 && chars[0] === chars[1] && /\p{Script=Han}/u.test(chars[0])) return true;
  if (/^[小老阿][\u4e00-\u9fa5]$/.test(word)) return true;
  return meNames.some(
    (n) => n.length >= 2 && word.length >= 2 && (n.includes(word) || word.includes(n)),
  );
}

function addressCandidates(text: string): string[] {
  const clean = stripEmojis(text).trim();
  const parts = clean.split(SEP_RE).filter(Boolean);
  if (parts.length === 0) return [];
  const out = new Set<string>();
  const head = parts[0];
  const last = parts[parts.length - 1];
  if (charLength(head) <= 3) out.add(head);
  if (parts.length > 1 && charLength(last) <= 3) out.add(last);
  // "宝宝你吃了吗": multi-char lexicon words glued to the sentence.
  for (const w of ADDRESS_LEXICON) {
    if (charLength(w) < 2) continue;
    if (head.startsWith(w) || last.endsWith(w)) out.add(w);
  }
  return [...out];
}

/** Per-message set of phrase candidates: char 2–4-grams for Han runs, whole words for Latin. */
function phraseGrams(text: string): Set<string> {
  const grams = new Set<string>();
  const runs = stripEmojis(text)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  for (const run of runs) {
    if (/^[a-z0-9]+$/.test(run)) {
      if (run.length >= 2 && !/^\d+$/.test(run)) grams.add(run);
      continue;
    }
    const chars = Array.from(run);
    for (let n = 2; n <= 4; n++) {
      for (let i = 0; i + n <= chars.length; i++) {
        const g = chars.slice(i, i + n);
        if (g.every((c) => STOP_CHARS.has(c))) continue;
        if (g.every((c) => c === g[0])) continue;
        if (g.some((c) => /[a-z0-9]/.test(c))) continue;
        grams.add(g.join(""));
      }
    }
  }
  return grams;
}

function countGrams(texts: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of texts) {
    for (const g of phraseGrams(t)) counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  return counts;
}

function catchphrases(
  taTexts: string[],
  meTexts: string[],
  minCount: number,
  max: number,
): { phrase: string; count: number }[] {
  const ta = countGrams(taTexts);
  const me = countGrams(meTexts);
  const taN = Math.max(taTexts.length, 1);
  const meN = meTexts.length;
  const scored: { phrase: string; count: number; score: number }[] = [];
  for (const [phrase, count] of ta) {
    if (count < minCount) continue;
    // Excess over the user's own usage, so shared filler ("我觉得") ranks below TA's quirks.
    const ratio = meN > 0 ? count / taN / (((me.get(phrase) ?? 0) + 0.5) / (meN + 1)) : 2;
    if (ratio < 1.5) continue;
    scored.push({ phrase, count, score: count * Math.log2(1 + Math.min(ratio, 16)) });
  }
  scored.sort((a, b) => b.score - a.score || b.count - a.count || (a.phrase < b.phrase ? -1 : 1));
  const top = scored.slice(0, 200);
  const kept = top.filter(
    (c) =>
      !top.some(
        (o) =>
          o.phrase.length > c.phrase.length &&
          o.phrase.includes(c.phrase) &&
          o.count >= c.count * 0.75,
      ),
  );
  return kept.slice(0, max).map(({ phrase, count }) => ({ phrase, count }));
}

function topN(counts: Map<string, number>, n: number, minCount = 1): string[] {
  return [...counts]
    .filter(([, c]) => c >= minCount)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, n)
    .map(([k]) => k);
}

/** Statistics over TA's text messages only. */
export function buildStyleProfile(sessions: Session[], opts: StyleOptions = {}): StyleProfile {
  const hourOf = opts.hourOf ?? ((ts: number) => new Date(ts).getHours());
  const minMarkerRate = opts.minMarkerRate ?? 0.02;
  const ta = messagesOf(sessions, "ta");
  const me = messagesOf(sessions, "me");
  const n = ta.length;

  const lengths = ta.map((m) => charLength(m.text.trim())).sort((a, b) => a - b);
  const sum = lengths.reduce((a, b) => a + b, 0);
  const median =
    n === 0 ? 0 : n % 2 === 1 ? lengths[(n - 1) / 2] : (lengths[n / 2 - 1] + lengths[n / 2]) / 2;

  let taTurns = 0;
  for (const s of sessions) {
    for (const t of s.turns) {
      if (t.role === "ta" && textMessages(t).length > 0) taTurns++;
    }
  }

  let periods = 0;
  let withEmoji = 0;
  const markerHits = new Map<string, number>();
  const emojiCounts = new Map<string, number>();
  const addressCounts = new Map<string, number>();
  const hours = new Array<number>(24).fill(0);
  const meNames = opts.meNames ?? [];

  for (const m of ta) {
    const text = m.text.trim();
    const tail = tailOf(text);
    const core = tail.replace(/[\p{P}\p{S}]+$/u, "");
    if (/(?<!。)。$/.test(tail)) periods++;
    for (const mk of MARKERS) {
      if (mk.test(text, tail, core)) markerHits.set(mk.token, (markerHits.get(mk.token) ?? 0) + 1);
    }
    const emojis = extractEmojis(text);
    if (emojis.length > 0) withEmoji++;
    for (const e of emojis) emojiCounts.set(e, (emojiCounts.get(e) ?? 0) + 1);
    for (const w of addressCandidates(text)) {
      if (looksLikeAddress(w, meNames)) addressCounts.set(w, (addressCounts.get(w) ?? 0) + 1);
    }
    const h = hourOf(m.ts);
    if (h >= 0 && h < 24) hours[h]++;
  }

  const rate = (k: number) => (n === 0 ? 0 : k / n);
  const punctuation = [...markerHits]
    .map(([token, k]) => ({ token, rate: rate(k) }))
    .filter((p) => p.rate >= minMarkerRate)
    .sort((a, b) => b.rate - a.rate || (a.token < b.token ? -1 : 1))
    .slice(0, 12);

  return {
    messageCount: n,
    avgLength: n === 0 ? 0 : sum / n,
    medianLength: median,
    avgBurst: taTurns === 0 ? 0 : n / taTurns,
    periodRate: rate(periods),
    punctuation,
    catchphrases: catchphrases(
      ta.map((m) => m.text),
      me.map((m) => m.text),
      opts.minPhraseCount ?? 3,
      opts.maxCatchphrases ?? 15,
    ),
    emojiRate: rate(withEmoji),
    topEmojis: topN(emojiCounts, opts.maxEmojis ?? 8),
    activeHours: hours.map(rate),
    nicknamesForMe: topN(addressCounts, 5, 2),
    firstTs: n === 0 ? 0 : Math.min(...ta.map((m) => m.ts)),
    lastTs: n === 0 ? 0 : Math.max(...ta.map((m) => m.ts)),
  };
}

const pct = (r: number) => `${Math.round(r * 100)}%`;

/** Chinese style instructions for the system prompt. */
export function styleToPrompt(p: StyleProfile): string {
  if (p.messageCount === 0) return "";
  const lines: string[] = [];
  const avg = Math.round(p.avgLength);
  lines.push(
    `- 每条消息平均 ${avg} 个字（中位数 ${Math.round(p.medianLength)}），一次通常连发 ${p.avgBurst.toFixed(1)} 条。` +
      (p.medianLength <= 12 ? "消息要短，像发微信一样把话拆成几条短句。" : ""),
  );
  if (p.periodRate < 0.1) lines.push("- 句尾基本不加句号。");
  else if (p.periodRate > 0.4) lines.push(`- 习惯用句号结尾（约 ${pct(p.periodRate)} 的消息）。`);
  const marks = p.punctuation.filter((m) => m.rate >= 0.05).slice(0, 8);
  if (marks.length > 0) {
    lines.push(
      `- 常用的语气词/标点：${marks.map((m) => `「${m.token}」(${pct(m.rate)})`).join("、")}。`,
    );
  }
  if (p.catchphrases.length > 0) {
    lines.push(
      `- 口头禅：${p.catchphrases
        .slice(0, 8)
        .map((c) => `「${c.phrase}」`)
        .join("、")}，自然地偶尔用，不要每句都用。`,
    );
  }
  if (p.emojiRate < 0.03) lines.push("- 几乎不用表情。");
  else {
    lines.push(
      `- 约 ${pct(p.emojiRate)} 的消息带表情` +
        (p.topEmojis.length ? `，常用：${p.topEmojis.slice(0, 5).join(" ")}` : "") +
        "。",
    );
  }
  if (p.nicknamesForMe.length > 0) lines.push(`- 称呼对方：${p.nicknamesForMe.join("、")}。`);
  return lines.join("\n");
}
