import type {
  Character,
  DialogueTurn,
  LlmClient,
  PersonaCard,
  SafetyEvent,
} from "../../core/model";
import { DialogueEngine } from "../../core/dialogue";
import { ExemplarIndex, type SerializedExemplarIndex } from "../../core/persona";
import { createSafetyGuard, type UsageTimer } from "../../core/safety";
import type { ChatBackend } from "./ChatSession";

/** Grief-friendly mode rules, appended after the identity rules (`extraRules`). */
export const GENTLE_RULES = [
  "温和模式：用户可能在怀念已经离开的人。语气温柔、克制、慢一点，不开玩笑、不吐槽、不撒娇。",
  "不要说“我还在”“我回来了”“我一直都在你身边”这类暗示 TA 仍然在世或会回来的话。",
  "不主动提起离世、病情、葬礼等细节；用户提起时温柔回应，不追问。",
  "用户表达思念或难过时，先接住情绪，再轻轻鼓励他和身边的家人朋友聊聊。",
];

export function fallbackPersona(c: Character): PersonaCard {
  return {
    name: c.name,
    relation: c.consent.relation,
    summary: "",
    traits: [],
    addressing: c.style?.nicknamesForMe.slice(0, 2) ?? [],
    taboos: [],
    userNotes: "",
    updatedAt: c.createdAt,
  };
}

export function loadIndex(raw: unknown): ExemplarIndex | undefined {
  if (!raw) return undefined;
  try {
    return ExemplarIndex.fromJSON(raw as SerializedExemplarIndex);
  } catch (err) {
    console.error("exemplar index unreadable", err);
    return undefined;
  }
}

export interface ChatBackendDeps {
  llm: LlmClient;
  usage?: UsageTimer;
  index?: unknown;
  saveLog(log: DialogueTurn[]): Promise<void>;
  preflight?: ChatBackend["preflight"];
  onSafetyEvent?: (e: SafetyEvent) => void;
  styleStrength?: number;
}

/** Dialogue engine + safety guard for one character, in the shape `ChatSession` drives. */
export function createChatBackend(c: Character, deps: ChatBackendDeps): ChatBackend {
  const persona = c.persona ?? fallbackPersona(c);
  const safety = createSafetyGuard({
    taName: c.name,
    aliases: [c.consent.relation, c.consent.subjectName].filter((a) => a && a !== c.name),
    addressing: persona.addressing[0],
    subject: c.consent.subject,
    usage: deps.usage,
    onEvent: deps.onSafetyEvent,
  });
  const engine = new DialogueEngine({
    llm: deps.llm,
    persona,
    style: c.style,
    index: loadIndex(deps.index),
    safety,
    styleStrength: deps.styleStrength,
    extraRules: c.gentleMode ? GENTLE_RULES : undefined,
  });
  return {
    reply: (history, text, opts) => engine.reply(history, text, opts),
    style: c.style,
    saveLog: deps.saveLog,
    preflight: deps.preflight,
  };
}
