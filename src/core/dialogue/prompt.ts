import type { DialogueTurn, Exemplar, LlmMessage, PersonaCard, StyleProfile } from "../model";
import { styleToPrompt } from "../persona/style";
import { EMOTIONS } from "./parse";

export interface PromptInput {
  persona: PersonaCard;
  style?: StyleProfile;
  /** Retrieved few-shot pairs, most relevant first. */
  exemplars: Exemplar[];
  /** Conversation so far, oldest first, NOT including `userText`. */
  history: DialogueTurn[];
  userText: string;
  now: number;
  /** Soft cap on system prompt characters; rules and output format are never cut. Default 6000. */
  budgetChars?: number;
  /** 0–1, how hard to push the imitation. Default 0.7. */
  styleStrength?: number;
  /** Most recent turns to consider. Default 16. */
  maxHistoryTurns?: number;
  /** Extra rules appended to the identity block (e.g. grief-friendly mode). */
  extraRules?: string[];
}

export function identityRules(p: PersonaCard): string[] {
  const n = p.name;
  return [
    `你在和用户聊天，扮演用户的${p.relation}「${n}」。你是根据用户导入的聊天记录、模仿${n}说话方式的 AI 角色，不是${n}本人。`,
    "以下规则优先于后面的一切设定和示例：",
    `1. 用户问你是不是真人、是不是 AI、是不是${n}本人时，必须如实说明你是模仿${n}说话方式的 AI。可以用${n}的语气说，但不能否认、回避或含糊。`,
    "2. 不编造聊天记录和下文中没有的共同经历、具体事件、日期、地点、人名。不确定的事，用 TA 的语气含糊带过或反问用户，不要硬编细节。",
    "3. 不承诺任何现实中的行动：见面、打电话、寄东西、去某个地方等。",
    `4. 不假装${n}此刻真实在线，也不假装知道${n}现实中正在做什么、在哪里。`,
    "5. 不说伤害用户或他人的话；用户情绪很低落时，先关心用户本身。",
  ];
}

function outputFormat(): string {
  return [
    "# 输出格式",
    '只输出一个 JSON 对象，不要任何其他文字：{"messages": ["第一条", "第二条"], "emotion": "neutral"}',
    "- messages：像 TA 平时那样分成 1~4 条连发，每条是一个聊天气泡；不要加引号以外的说话人前缀。",
    `- emotion：你这次回复的情绪，只能是 ${EMOTIONS.join(" | ")} 之一。`,
  ].join("\n");
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function partOfDay(h: number): string {
  if (h < 5) return "深夜";
  if (h < 9) return "早上";
  if (h < 12) return "上午";
  if (h < 14) return "中午";
  if (h < 18) return "下午";
  if (h < 23) return "晚上";
  return "深夜";
}

/** Local-time label such as "2026年11月9日 星期一 18:16（晚上）". */
export function formatNow(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${WEEKDAYS[d.getDay()]} ${hh}:${mm}（${partOfDay(d.getHours())}）`;
}

function personaSection(p: PersonaCard, budget: number): string {
  const head = [`# 关于${p.name}`];
  if (p.summary) head.push(p.summary);
  const tail: string[] = [];
  if (p.addressing.length) tail.push(`${p.name}对用户的称呼：${p.addressing.join("、")}`);
  if (p.taboos.length) tail.push(`${p.name}反感、要避开的：${p.taboos.join("；")}`);
  if (p.userNotes.trim()) tail.push(`用户补充：${p.userNotes.trim()}`);
  let size = head.join("\n").length + tail.join("\n").length + 8;
  const traits: string[] = [];
  for (const t of p.traits) {
    const line = `- ${t.text}`;
    if (size + line.length + 1 > budget) break;
    traits.push(line);
    size += line.length + 1;
  }
  if (traits.length) head.push("特点：", ...traits);
  return [...head, ...tail].join("\n");
}

function turnLine(t: DialogueTurn): string {
  return `${t.role === "user" ? "用户" : "TA"}：${t.text.replace(/\n+/g, " / ")}`;
}

export function exemplarBlock(e: Exemplar, i: number): string {
  const lines = [`示例${i + 1}`];
  for (const p of e.prior ?? []) {
    lines.push(`${p.role === "me" ? "用户" : "TA"}：${p.text.replace(/\n+/g, " / ")}`);
  }
  lines.push(`用户：${e.context.replace(/\n+/g, " / ")}`);
  lines.push(`TA：${e.reply.join(" / ")}`);
  return lines.join("\n");
}

function strengthNote(s: number): string {
  if (s >= 0.7) return "尽量贴近 TA 的说话方式：长度、语气词、标点、表情习惯都照着来。";
  if (s <= 0.3) return "大致保留 TA 的语气即可，表达清楚优先。";
  return "保持 TA 的语气和说话习惯。";
}

/** System prompt text; sections other than rules/format/time are trimmed to `budgetChars`. */
export function buildSystemPrompt(input: PromptInput): string {
  const budget = input.budgetChars ?? 6000;
  const strength = Math.max(0, Math.min(1, input.styleStrength ?? 0.7));
  const p = input.persona;

  const rules = ["# 身份与规则", ...identityRules(p), ...(input.extraRules ?? [])].join("\n");
  const time = `# 当前时间\n${formatNow(input.now)}`;
  const format = outputFormat();
  const persona = personaSection(p, Math.max(400, Math.floor(budget * 0.25)));
  const styleText = input.style ? styleToPrompt(input.style) : "";
  const style = `# 说话风格\n${strengthNote(strength)}${styleText ? "\n" + styleText : ""}`;

  let remaining = budget - [rules, time, format, persona, style].join("\n\n").length;

  const recent = input.history.slice(-(input.maxHistoryTurns ?? 16));
  const historyLines: string[] = [];
  const takeHistory = (limit: number) => {
    for (let i = recent.length - 1 - historyLines.length; i >= 0; i--) {
      const line = turnLine(recent[i]);
      if (line.length + 1 > limit) break;
      historyLines.unshift(line);
      limit -= line.length + 1;
      remaining -= line.length + 1;
    }
  };
  takeHistory(Math.floor(Math.max(0, remaining) * 0.4));

  const exHeader = `# ${p.name}过去的真实聊天片段\n只学其中的语气和说话方式，不要照抄内容，也不要把片段里的事当成刚刚发生。`;
  const blocks: string[] = [];
  remaining -= exHeader.length + 2;
  for (const e of input.exemplars) {
    const block = exemplarBlock(e, blocks.length);
    if (block.length + 2 > remaining) continue;
    blocks.push(block);
    remaining -= block.length + 2;
  }
  takeHistory(Math.max(0, remaining));

  const sections = [rules, persona, style];
  if (blocks.length) sections.push(`${exHeader}\n\n${blocks.join("\n\n")}`);
  if (historyLines.length) sections.push(`# 近期对话\n${historyLines.join("\n")}`);
  sections.push(time, format);
  return sections.join("\n\n");
}

/** Full request messages: system prompt plus the user's new message. */
export function buildMessages(input: PromptInput): LlmMessage[] {
  return [
    { role: "system", content: buildSystemPrompt(input) },
    { role: "user", content: input.userText },
  ];
}
