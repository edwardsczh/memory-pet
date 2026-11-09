import type { Exemplar } from "../model";
import { extractEmojis, isCjk, stripEmojis } from "../text/chars";

export interface SearchHit {
  exemplar: Exemplar;
  /** Relevance after recency weighting; 0 for recency fill-ins with no term overlap. */
  score: number;
}

/** What the dialogue engine needs; ExemplarIndex is the default implementation. */
export interface ExemplarRetriever {
  search(query: string, k?: number): SearchHit[];
}

/**
 * Hook for a future embedding-based retriever (e.g. sidecar). Scores only need to be
 * comparable within one result list; fusion uses ranks.
 */
export interface DenseRetriever {
  search(query: string, k: number): Promise<{ id: string; score: number }[]>;
}

export interface IndexOptions {
  k1?: number;
  b?: number;
  /** Max boost for the newest exemplar: score × (1 + w · 2^(−age/halfLife)). Default 0.15. */
  recencyWeight?: number;
  recencyHalfLifeDays?: number;
  /** MMR trade-off; 1 = pure relevance, lower = more diverse. Default 0.7. */
  mmrLambda?: number;
  /** Candidates at least this similar (Jaccard) to an already picked one are skipped. Default 0.85. */
  dupThreshold?: number;
  /** Pad results with the most recent exemplars when fewer than k match. Default true. */
  fillWithRecent?: boolean;
}

const DEFAULTS: Required<IndexOptions> = {
  k1: 1.2,
  b: 0.75,
  recencyWeight: 0.15,
  recencyHalfLifeDays: 180,
  mmrLambda: 0.7,
  dupThreshold: 0.85,
  fillWithRecent: true,
};

export interface SerializedExemplarIndex {
  version: 1;
  options: IndexOptions;
  exemplars: Exemplar[];
}

/** Han unigrams + bigrams, whole Latin/digit words, and emoji as tokens. */
export function tokenize(text: string): string[] {
  const out: string[] = extractEmojis(text);
  const runs = stripEmojis(text)
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u);
  for (const run of runs) {
    if (!run) continue;
    let han: string[] = [];
    let other = "";
    const flushHan = () => {
      for (let i = 0; i < han.length; i++) {
        out.push(han[i]);
        if (i + 1 < han.length) out.push(han[i] + han[i + 1]);
      }
      han = [];
    };
    for (const ch of run) {
      if (isCjk(ch)) {
        if (other) out.push(other);
        other = "";
        han.push(ch);
      } else {
        flushHan();
        other += ch;
      }
    }
    flushHan();
    if (other) out.push(other);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

interface Posting {
  docs: number[];
  tfs: number[];
}

export class ExemplarIndex implements ExemplarRetriever {
  private readonly opts: Required<IndexOptions>;
  private readonly postings = new Map<string, Posting>();
  private readonly docLen: Float64Array;
  private readonly avgLen: number;
  private readonly recency: Float64Array;
  private readonly byRecent: number[];
  private readonly byId = new Map<string, number>();

  private constructor(
    private readonly exemplars: Exemplar[],
    private readonly options: IndexOptions,
  ) {
    this.opts = { ...DEFAULTS, ...options };
    const n = exemplars.length;
    this.docLen = new Float64Array(n);
    this.recency = new Float64Array(n);
    let total = 0;
    let maxTs = -Infinity;
    for (let d = 0; d < n; d++) {
      const ex = exemplars[d];
      this.byId.set(ex.id, d);
      maxTs = Math.max(maxTs, ex.ts);
      const terms = tokenize(ex.context);
      this.docLen[d] = terms.length;
      total += terms.length;
      const tf = new Map<string, number>();
      for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const [t, c] of tf) {
        let p = this.postings.get(t);
        if (!p) {
          p = { docs: [], tfs: [] };
          this.postings.set(t, p);
        }
        p.docs.push(d);
        p.tfs.push(c);
      }
    }
    this.avgLen = n === 0 ? 0 : total / n;
    const halfLife = this.opts.recencyHalfLifeDays * 86_400_000;
    for (let d = 0; d < n; d++) {
      const age = Math.max(0, maxTs - exemplars[d].ts);
      this.recency[d] = 1 + this.opts.recencyWeight * Math.pow(2, -age / halfLife);
    }
    this.byRecent = [...exemplars.keys()].sort((a, b) => exemplars[b].ts - exemplars[a].ts);
  }

  static build(exemplars: Exemplar[], opts: IndexOptions = {}): ExemplarIndex {
    return new ExemplarIndex(exemplars.slice(), opts);
  }

  static fromJSON(data: SerializedExemplarIndex): ExemplarIndex {
    if (!data || data.version !== 1 || !Array.isArray(data.exemplars)) {
      throw new Error("Unsupported exemplar index format");
    }
    return new ExemplarIndex(data.exemplars, data.options ?? {});
  }

  /** Stores exemplars and options; postings are rebuilt on load (fast, and format-proof). */
  toJSON(): SerializedExemplarIndex {
    return { version: 1, options: { ...this.options }, exemplars: this.exemplars };
  }

  get size(): number {
    return this.exemplars.length;
  }

  get(id: string): Exemplar | undefined {
    const d = this.byId.get(id);
    return d === undefined ? undefined : this.exemplars[d];
  }

  /** BM25 over the user-side context, recency-weighted, MMR-deduplicated. */
  search(query: string, k = 6): SearchHit[] {
    if (k <= 0 || this.exemplars.length === 0) return [];
    return this.finish(this.rank(query, Math.max(k * 5, 30)), k);
  }

  /** Reciprocal-rank fusion of BM25 and a dense retriever. */
  async searchHybrid(query: string, k: number, dense: DenseRetriever): Promise<SearchHit[]> {
    if (k <= 0 || this.exemplars.length === 0) return [];
    const pool = Math.max(k * 5, 30);
    const lexical = this.rank(query, pool);
    const vector = await dense.search(query, pool);
    const fused = new Map<number, number>();
    const rrf = (rank: number) => 1 / (60 + rank);
    lexical.forEach(([d], r) => fused.set(d, (fused.get(d) ?? 0) + rrf(r)));
    vector.forEach(({ id }, r) => {
      const d = this.byId.get(id);
      if (d !== undefined) fused.set(d, (fused.get(d) ?? 0) + rrf(r));
    });
    const ranked = [...fused]
      .map(([d, s]): [number, number] => [d, s * this.recency[d]])
      .sort((a, b) => b[1] - a[1]);
    return this.finish(ranked, k);
  }

  /** Top `limit` [docIndex, score] pairs, best first. */
  private rank(query: string, limit: number): [number, number][] {
    const qtf = new Map<string, number>();
    for (const t of tokenize(query)) qtf.set(t, (qtf.get(t) ?? 0) + 1);
    const n = this.exemplars.length;
    const { k1, b } = this.opts;
    const scores = new Map<number, number>();
    for (const [term, qc] of qtf) {
      const p = this.postings.get(term);
      if (!p) continue;
      const df = p.docs.length;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      for (let i = 0; i < p.docs.length; i++) {
        const d = p.docs[i];
        const tf = p.tfs[i];
        const norm = tf + k1 * (1 - b + (b * this.docLen[d]) / (this.avgLen || 1));
        scores.set(d, (scores.get(d) ?? 0) + qc * idf * ((tf * (k1 + 1)) / norm));
      }
    }
    const ranked: [number, number][] = [];
    for (const [d, s] of scores) ranked.push([d, s * this.recency[d]]);
    ranked.sort((a, b2) => b2[1] - a[1] || a[0] - b2[0]);
    return ranked.slice(0, limit);
  }

  private finish(ranked: [number, number][], k: number): SearchHit[] {
    const picked: [number, number][] = [];
    if (ranked.length > 0) {
      const { mmrLambda: lambda, dupThreshold } = this.opts;
      const top = ranked[0][1] || 1;
      const sets = new Map<number, Set<string>>();
      const termsOf = (d: number) => {
        let s = sets.get(d);
        if (!s) {
          const ex = this.exemplars[d];
          s = new Set(tokenize(ex.context + "\n" + ex.reply.join("\n")));
          sets.set(d, s);
        }
        return s;
      };
      const pool = ranked.slice();
      while (picked.length < k && pool.length > 0) {
        let best = -1;
        let bestVal = -Infinity;
        for (let i = 0; i < pool.length; i++) {
          const [d, s] = pool[i];
          let maxSim = 0;
          for (const [pd] of picked) maxSim = Math.max(maxSim, jaccard(termsOf(d), termsOf(pd)));
          if (maxSim >= dupThreshold) {
            pool.splice(i--, 1);
            continue;
          }
          const val = lambda * (s / top) - (1 - lambda) * maxSim;
          if (val > bestVal) {
            bestVal = val;
            best = i;
          }
        }
        if (best >= 0) picked.push(pool.splice(best, 1)[0]);
      }
    }
    if (this.opts.fillWithRecent && picked.length < k) {
      const have = new Set(picked.map(([d]) => d));
      for (const d of this.byRecent) {
        if (picked.length >= k) break;
        if (!have.has(d)) picked.push([d, 0]);
      }
    }
    return picked.map(([d, score]) => ({ exemplar: this.exemplars[d], score }));
  }
}
