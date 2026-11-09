import type {
  CleanMessage,
  EvidenceRef,
  LlmClient,
  PersonaCard,
  PersonaTrait,
  Session,
} from "../model";
import { estimateTokens } from "../text/chars";
import { extractJson } from "../text/json";
import { textMessages } from "./sessions";

export interface PersonaSubject {
  name: string;
  relation: string;
}

export interface PersonaProgress {
  stage: "extract" | "merge" | "done";
  done: number;
  total: number;
}

export interface PersonaCardOptions {
  /** Target characters of chat transcript per LLM call. Default 6000. */
  batchChars?: number;
  /** Larger histories are sampled evenly over time down to this many batches. Default 40. */
  maxBatches?: number;
  /** Parallel LLM calls. Default 2. */
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (p: PersonaProgress) => void;
  now?: () => number;
  userNotes?: string;
  maxTraits?: number;
}

export interface PersonaCostEstimate {
  batches: number;
  approxInputChars: number;
  approxTokens: number;
  /** Rough completion tokens (extraction + merge), shown separately since they cost more. */
  approxOutputTokens: number;
}

interface Batch {
  text: string;
  aliases: string[];
}

interface Plan {
  batches: Batch[];
  /** Short alias ("m12") → message, only for messages actually sent to the model. */
  aliases: Map<string, CleanMessage>;
}

interface RawCard {
  summary: string;
  traits: { text: string; evidence: string[] }[];
  addressing: string[];
  taboos: string[];
}

const MAX_LINE_CHARS = 200;
const MERGE_GROUP_CHARS = 12_000;
const EXTRACT_OUTPUT_TOKENS = 600;
const MERGE_OUTPUT_TOKENS = 1500;

function speaker(role: CleanMessage["role"], name: string): string | null {
  if (role === "ta") return name;
  if (role === "me") return "我";
  return null;
}

function dateLabel(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function planBatches(
  sessions: Session[],
  name: string,
  batchChars: number,
  maxBatches: number,
): Plan {
  const aliases = new Map<string, CleanMessage>();
  const batches: Batch[] = [];
  let lines: string[] = [];
  let ids: string[] = [];
  let size = 0;
  const flush = () => {
    if (lines.length > 0) batches.push({ text: lines.join("\n"), aliases: ids });
    lines = [];
    ids = [];
    size = 0;
  };
  const push = (line: string, alias?: string) => {
    if (size + line.length > batchChars && lines.length > 0) flush();
    lines.push(line);
    if (alias) ids.push(alias);
    size += line.length + 1;
  };

  for (const s of sessions) {
    if (!s.turns.some((t) => t.role === "ta" && textMessages(t).length > 0)) continue;
    push(`--- ${dateLabel(s.start)} ---`);
    for (const t of s.turns) {
      const who = speaker(t.role, name);
      if (!who) continue;
      for (const m of textMessages(t)) {
        const alias = `m${aliases.size + 1}`;
        aliases.set(alias, m);
        const text = Array.from(m.text.trim().replace(/\s+/g, " "))
          .slice(0, MAX_LINE_CHARS)
          .join("");
        push(`[${alias}] ${who}：${text}`, alias);
      }
    }
  }
  flush();

  if (batches.length <= maxBatches) return { batches, aliases };
  const sampled: Batch[] = [];
  for (let i = 0; i < maxBatches; i++) {
    sampled.push(batches[Math.floor((i * batches.length) / maxBatches)]);
  }
  const shown = new Map<string, CleanMessage>();
  for (const b of sampled) for (const a of b.aliases) shown.set(a, aliases.get(a)!);
  return { batches: sampled, aliases: shown };
}

function extractSystem({ name, relation }: PersonaSubject): string {
  return [
    `你是一名细心的对话分析助手。下面是用户（"我"）与${name}（用户的${relation}）的聊天片段，每条消息以 [编号] 开头。`,
    `请只根据这些片段，总结${name}的人格与说话特点。要求：`,
    "- 只写片段中有明确依据的结论，不要猜测或补充片段外的信息。",
    "- 每条 trait 简洁（不超过 40 字），可涵盖：性格、说话习惯、兴趣爱好、常聊话题、关心的人和事、与“我”的相处方式、价值观。",
    `- 每条 trait 的 evidence 列出 1~3 个支持它的消息编号（优先${name}自己说的话），编号必须原样来自片段。`,
    `- addressing：${name}对“我”的称呼；taboos：${name}明显反感或回避的话题、说法。没有就给空数组。`,
    '只输出 JSON，不要其他文字：{"summary": "一两句话概括", "traits": [{"text": "…", "evidence": ["m12"]}], "addressing": [], "taboos": []}',
  ].join("\n");
}

function mergeSystem({ name, relation }: PersonaSubject, maxTraits: number): string {
  return [
    `下面是从用户与${name}（用户的${relation}）的多段聊天中分别提取的人格分析结果（JSON 数组）。请合并成一份：`,
    "- 合并意思相同或相近的 trait，保留最具体的表述，evidence 取并集（每条最多 3 个编号，编号原样保留）。",
    "- 互相矛盾的结论，只保留证据更多的一方，或写成“有时…有时…”。",
    `- traits 最多 ${maxTraits} 条，按重要性排序；summary 用 2~4 句话概括${name}这个人。`,
    "- addressing、taboos 去重合并。",
    '只输出 JSON：{"summary": "…", "traits": [{"text": "…", "evidence": ["m12"]}], "addressing": [], "taboos": []}',
  ].join("\n");
}

function strings(v: unknown): string[] {
  if (typeof v === "string") return v.trim() ? [v.trim()] : [];
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === "string" || typeof x === "number" ? String(x).trim() : ""))
    .filter(Boolean);
}

function toRawCard(value: unknown): RawCard | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  const traits: RawCard["traits"] = [];
  if (Array.isArray(o.traits)) {
    for (const t of o.traits) {
      if (typeof t === "string") {
        traits.push({ text: t.trim(), evidence: [] });
      } else if (t && typeof t === "object") {
        const r = t as Record<string, unknown>;
        const text =
          typeof r.text === "string"
            ? r.text.trim()
            : typeof r.trait === "string"
              ? r.trait.trim()
              : "";
        if (text) traits.push({ text, evidence: strings(r.evidence ?? r.evidences ?? r.ids) });
      }
    }
  }
  return {
    summary: typeof o.summary === "string" ? o.summary.trim() : "",
    traits,
    addressing: strings(o.addressing),
    taboos: strings(o.taboos),
  };
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Aborted", "AbortError");
}

function withAbort<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

async function runPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker),
  );
  return results;
}

const normalizeTrait = (t: string) => t.replace(/[\p{P}\p{S}\s]/gu, "");

function localMerge(cards: RawCard[], maxTraits: number): RawCard {
  const traits: RawCard["traits"] = [];
  for (const c of cards) {
    for (const t of c.traits) {
      const key = normalizeTrait(t.text);
      const same = traits.find((x) => {
        const k = normalizeTrait(x.text);
        return k === key || k.includes(key) || key.includes(k);
      });
      if (same) {
        if (t.text.length > same.text.length) same.text = t.text;
        same.evidence = [...new Set([...same.evidence, ...t.evidence])];
      } else {
        traits.push({ text: t.text, evidence: [...t.evidence] });
      }
    }
  }
  traits.sort((a, b) => b.evidence.length - a.evidence.length);
  return {
    summary: cards.map((c) => c.summary).find(Boolean) ?? "",
    traits: traits.slice(0, maxTraits),
    addressing: [...new Set(cards.flatMap((c) => c.addressing))],
    taboos: [...new Set(cards.flatMap((c) => c.taboos))],
  };
}

function groupForMerge(cards: RawCard[]): RawCard[][] {
  const groups: RawCard[][] = [];
  let cur: RawCard[] = [];
  let size = 0;
  for (const c of cards) {
    const len = JSON.stringify(c).length;
    if (size + len > MERGE_GROUP_CHARS && cur.length > 0) {
      groups.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(c);
    size += len;
  }
  if (cur.length > 0) groups.push(cur);
  return groups;
}

/** Dry run of the batching, for showing the cost before calling the LLM. */
export function estimatePersonaCost(
  sessions: Session[],
  opts: Pick<PersonaCardOptions, "batchChars" | "maxBatches"> & { name?: string } = {},
): PersonaCostEstimate {
  const subject = { name: opts.name ?? "TA", relation: "朋友" };
  const { batches } = planBatches(
    sessions,
    subject.name,
    opts.batchChars ?? 6000,
    opts.maxBatches ?? 40,
  );
  const sys = extractSystem(subject);
  let chars = 0;
  let tokens = 0;
  for (const b of batches) {
    chars += sys.length + b.text.length;
    tokens += estimateTokens(sys) + estimateTokens(b.text);
  }
  // Merge input is roughly the extraction output re-sent once (twice if it needs two rounds).
  const mergeTokens = batches.length > 1 ? batches.length * EXTRACT_OUTPUT_TOKENS : 0;
  chars += Math.round(mergeTokens / 0.6);
  tokens += mergeTokens;
  return {
    batches: batches.length,
    approxInputChars: chars,
    approxTokens: tokens,
    approxOutputTokens:
      batches.length * EXTRACT_OUTPUT_TOKENS + (batches.length > 1 ? MERGE_OUTPUT_TOKENS : 0),
  };
}

/**
 * Two-stage LLM summary: per-batch extraction with message-id evidence, then merge.
 * Evidence ids the model invented are dropped, and so are traits left without evidence.
 */
export async function generatePersonaCard(
  sessions: Session[],
  subject: PersonaSubject,
  llm: LlmClient,
  opts: PersonaCardOptions = {},
): Promise<PersonaCard> {
  const { signal, onProgress } = opts;
  const maxTraits = opts.maxTraits ?? 20;
  const plan = planBatches(sessions, subject.name, opts.batchChars ?? 6000, opts.maxBatches ?? 40);
  const byId = new Map<string, CleanMessage>();
  for (const m of plan.aliases.values()) byId.set(m.id, m);

  const call = async (system: string, user: string): Promise<RawCard | null> => {
    if (signal?.aborted) throw abortError(signal);
    const raw = await withAbort(
      llm.complete({
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.2,
        json: true,
        signal,
      }),
      signal,
    );
    return toRawCard(extractJson(raw));
  };

  let done = 0;
  const total = plan.batches.length;
  onProgress?.({ stage: "extract", done, total });
  const extracted = await runPool(plan.batches, opts.concurrency ?? 2, async (b) => {
    const card = await call(extractSystem(subject), b.text);
    onProgress?.({ stage: "extract", done: ++done, total });
    return card;
  });
  let cards = extracted.filter((c): c is RawCard => c !== null);

  while (cards.length > 1) {
    const groups = groupForMerge(cards);
    let merged = 0;
    onProgress?.({ stage: "merge", done: 0, total: groups.length });
    const next = await runPool(groups, opts.concurrency ?? 2, async (g) => {
      const result =
        g.length === 1
          ? g[0]
          : ((await call(mergeSystem(subject, maxTraits), JSON.stringify(g))) ??
            localMerge(g, maxTraits));
      onProgress?.({ stage: "merge", done: ++merged, total: groups.length });
      return result;
    });
    // A merge round that does not shrink the list (one oversized card per group) would loop.
    cards = next.length < cards.length ? next : [localMerge(next, maxTraits)];
  }

  const card = cards[0] ?? { summary: "", traits: [], addressing: [], taboos: [] };
  const traits: PersonaTrait[] = [];
  const seen = new Set<string>();
  for (const t of card.traits) {
    const key = normalizeTrait(t.text);
    if (!key || seen.has(key)) continue;
    const evidence = resolveEvidence(t.evidence, plan.aliases, byId);
    if (evidence.length === 0) continue;
    seen.add(key);
    traits.push({ text: t.text, evidence });
    if (traits.length >= maxTraits) break;
  }

  onProgress?.({ stage: "done", done: 1, total: 1 });
  return {
    name: subject.name,
    relation: subject.relation,
    summary: card.summary,
    traits,
    addressing: [...new Set(card.addressing)].slice(0, 8),
    taboos: [...new Set(card.taboos)].slice(0, 10),
    userNotes: opts.userNotes ?? "",
    updatedAt: (opts.now ?? Date.now)(),
  };
}

function resolveEvidence(
  refs: string[],
  aliases: Map<string, CleanMessage>,
  byId: Map<string, CleanMessage>,
): EvidenceRef[] {
  const out: EvidenceRef[] = [];
  const used = new Set<string>();
  for (const ref of refs) {
    const r = ref.replace(/^[[【#\s]+|[\]】\s]+$/g, "");
    const alias = /^m?(\d+)$/i.exec(r);
    const msg = (alias ? aliases.get(`m${alias[1]}`) : undefined) ?? byId.get(r);
    if (!msg || used.has(msg.id)) continue;
    used.add(msg.id);
    out.push({
      messageId: msg.id,
      ts: msg.ts,
      excerpt: Array.from(msg.text.trim()).slice(0, 60).join(""),
    });
    if (out.length >= 3) break;
  }
  return out;
}
