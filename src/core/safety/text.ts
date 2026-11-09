/** Traditional forms of characters the safety rules look for. */
const TRADITIONAL: Record<string, string> = {
  殺: "杀",
  傷: "伤",
  藥: "药",
  絕: "绝",
  遺: "遗",
  書: "书",
  輕: "轻",
  盡: "尽",
  殘: "残",
  無: "无",
  義: "义",
  潰: "溃",
  沒: "没",
  個: "个",
  機: "机",
  嗎: "吗",
  離: "离",
  開: "开",
  別: "别",
  與: "与",
  會: "会",
  覺: "觉",
};

/** Full-width to half-width, a few traditional chars to simplified, lower-case, no whitespace. */
export function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[殺傷藥絕遺書輕盡殘無義潰沒個機嗎離開別與會覺]/g, (c) => TRADITIONAL[c]);
}

const CLAUSE_BREAK = /[,.!?;:，。！？；：、~～…\n]/;

/** Text of the current clause before `index` (stops at the previous punctuation). */
export function clauseBefore(text: string, index: number): string {
  const parts = text.slice(0, index).split(CLAUSE_BREAK);
  return parts[parts.length - 1];
}

export function withGlobal(re: RegExp): RegExp {
  return re.flags.includes("g") ? re : new RegExp(re.source, re.flags + "g");
}
