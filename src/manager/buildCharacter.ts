import type {
  Character,
  ConsentRecord,
  ParsedImport,
  PersonaCard,
  SpeakerMapping,
} from "../core/model";
import { cleanImport } from "../core/ingest";
import {
  ExemplarIndex,
  buildStyleProfile,
  extractExemplars,
  splitHoldout,
  type PersonaSubject,
} from "../core/persona";
import { generatePersonaCard } from "../core/persona/personaCard";
import type { LlmClient } from "../core/model";
import { newCharacterId } from "../core/storage/characters";

export interface BuiltCharacterAssets {
  sessions: ReturnType<typeof cleanImport>["sessions"];
  report: ReturnType<typeof cleanImport>["report"];
  style: ReturnType<typeof buildStyleProfile>;
  index: ExemplarIndex;
  holdout: ReturnType<typeof splitHoldout>;
}

export function buildAssets(parsed: ParsedImport, mapping: SpeakerMapping): BuiltCharacterAssets {
  const { sessions, report } = cleanImport(parsed, mapping);
  const style = buildStyleProfile(sessions, { meNames: mapping.me });
  const holdout = splitHoldout(extractExemplars(sessions));
  const train = holdout.train;
  const index = ExemplarIndex.build(train);
  return { sessions, report, style, index, holdout };
}

export function fallbackPersona(
  subject: PersonaSubject,
  style: ReturnType<typeof buildStyleProfile>,
  now: number,
): PersonaCard {
  const catchline = style.catchphrases[0]?.phrase;
  const summary = catchline
    ? `说话常有「${catchline}」等口头禅，平均每条约 ${Math.round(style.avgLength)} 字。`
    : `平均每条约 ${Math.round(style.avgLength)} 字，喜欢一次连发 ${style.avgBurst.toFixed(1)} 条左右。`;
  return {
    name: subject.name,
    relation: subject.relation,
    summary,
    traits: [],
    addressing: style.nicknamesForMe.length ? style.nicknamesForMe.slice(0, 3) : [],
    taboos: [],
    userNotes: "",
    updatedAt: now,
  };
}

const EMPTY_IMPORT: ParsedImport = {
  format: "plain-text",
  isGroup: false,
  participants: [],
  messages: [],
  warnings: [],
};

/**
 * A character from the prompt the user typed. No chat file is required, and
 * nothing is invented as if lines had been read out of a screenshot.
 */
export function buildPromptCharacter(
  consent: ConsentRecord,
  prompt: string,
  opts: { avatar?: string; now?: number } = {},
): { character: Character; assets: BuiltCharacterAssets } {
  const text = prompt.trim();
  if (!text) throw new Error("请先写一段提示");
  const now = opts.now ?? Date.now();
  const name = consent.subjectName.trim();
  const assets = buildAssets(EMPTY_IMPORT, { me: [], ta: [] });
  const persona: PersonaCard = {
    name,
    relation: consent.relation.trim(),
    summary: text,
    traits: [],
    addressing: [],
    taboos: [],
    userNotes: "没有导入聊天记录，也没有从截图里抽出句子。请只按上面的摘要说话。",
    updatedAt: now,
  };
  const character: Character = {
    id: newCharacterId(),
    name,
    consent,
    persona,
    style: assets.style,
    avatar: opts.avatar ?? (consent.subject === "self" ? "kai" : "momo"),
    createdAt: now,
    gentleMode: consent.subject === "deceased",
    archived: false,
  };
  return { character, assets };
}

export async function buildCharacterRecord(
  consent: ConsentRecord,
  parsed: ParsedImport,
  mapping: SpeakerMapping,
  opts: {
    avatar?: string;
    llm?: LlmClient;
    useLlmPersona?: boolean;
    now?: number;
  } = {},
): Promise<{ character: Character; assets: BuiltCharacterAssets }> {
  const now = opts.now ?? Date.now();
  const assets = buildAssets(parsed, mapping);
  const subject: PersonaSubject = { name: consent.subjectName, relation: consent.relation };
  let persona: PersonaCard;
  if (opts.useLlmPersona && opts.llm) {
    persona = await generatePersonaCard(assets.sessions, subject, opts.llm);
  } else {
    persona = fallbackPersona(subject, assets.style, now);
  }
  const character: Character = {
    id: newCharacterId(),
    name: consent.subjectName,
    consent,
    persona,
    style: assets.style,
    avatar: opts.avatar ?? "momo",
    createdAt: now,
    gentleMode: consent.subject === "deceased",
    archived: false,
  };
  return { character, assets };
}
