/**
 * Tolerant JSON extraction for LLM output: code fences, prose around the object, trailing
 * commas, smart quotes, unquoted keys, single quotes and truncated tails.
 */

/** Candidate JSON substrings, most likely first. */
function candidates(raw: string): string[] {
  const out: string[] = [];
  const fence = /```[a-zA-Z]*\s*\n?([\s\S]*?)(?:```|$)/g;
  for (const m of raw.matchAll(fence)) {
    if (m[1].trim()) out.push(m[1].trim());
  }
  for (const open of ["{", "["]) {
    const start = raw.indexOf(open);
    if (start >= 0) out.push(balancedFrom(raw, start));
  }
  out.push(raw.trim());
  return out;
}

/** Substring from `start` to its matching close bracket, or to the end if unbalanced. */
function balancedFrom(s: string, start: number): string {
  const stack: string[] = [];
  let inStr: string | null = null;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"') inStr = ch;
    else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") {
      stack.pop();
      if (stack.length === 0) return s.slice(start, i + 1);
    }
  }
  return s.slice(start);
}

/** Close an object/array cut off mid-stream so JSON.parse can recover what was complete. */
function closeTruncated(s: string): string {
  const stack: string[] = [];
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  let out = s;
  if (inStr) out += '"';
  out = out.replace(/[,:\s]+$/, "");
  // Inside an object a trailing string is a key without value; drop it.
  if (stack[stack.length - 1] === "}")
    out = out.replace(/([{,])\s*"[^"]*"$/, "$1").replace(/,$/, "");
  return out + stack.reverse().join("");
}

function repair(s: string): string {
  let t = s
    .replace(/^\uFEFF/, "")
    .replace(/[“”＂]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/：(?=\s*["[{\d])/g, ":")
    .replace(/，(?=\s*")/g, ",");
  if (!t.includes('"') && t.includes("'")) t = t.replace(/'/g, '"');
  t = t.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
  t = t.replace(/,(\s*[}\]])/g, "$1");
  // Raw newlines inside strings are invalid JSON but common in model output.
  t = t.replace(/"(?:[^"\\]|\\.)*"/g, (m) => m.replace(/\n/g, "\\n").replace(/\r/g, ""));
  return t;
}

function tryParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/** Best-effort parse of the first JSON object/array in `raw`; undefined if nothing usable. */
export function extractJson(raw: string): unknown {
  if (!raw) return undefined;
  for (const c of candidates(raw)) {
    if (!/^[[{]/.test(c)) continue;
    const direct = tryParse(c);
    if (direct !== undefined) return direct;
    const fixed = repair(c);
    const repaired = tryParse(fixed);
    if (repaired !== undefined) return repaired;
    const closed = tryParse(repair(closeTruncated(c)));
    if (closed !== undefined) return closed;
    // Truncated object followed by prose: retry without the trailing lines.
    const lines = c.split("\n");
    for (let cut = lines.length - 1; cut >= Math.max(1, lines.length - 6); cut--) {
      const head = lines.slice(0, cut).join("\n");
      const v = tryParse(repair(closeTruncated(head)));
      if (v !== undefined) return v;
    }
  }
  return undefined;
}
