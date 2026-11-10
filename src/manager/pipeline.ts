import type { Character, ConsentRecord, PersonaCard, SpeakerMapping } from "../core/model";
import { cleanImport, decodeBytes, parseImport } from "../core/ingest";
import {
  ExemplarIndex,
  buildStyleProfile,
  extractExemplars,
  generatePersonaCard,
  splitHoldout,
  type PersonaProgress,
} from "../core/persona";
import type { LlmClient } from "../core/model";
import type { CharacterRepo } from "../core/storage/characters";
import { CHARACTERS_CHANGED_EVENT, newCharacterId } from "../core/storage/characters";
import { isTauri } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";

export interface ImportPipelineInput {
  fileName: string;
  bytes: Uint8Array;
  mapping: SpeakerMapping;
  conversationId?: string;
}

export interface ImportPipelineResult {
  sessions: ReturnType<typeof cleanImport>["sessions"];
  report: ReturnType<typeof cleanImport>["report"];
  style: ReturnType<typeof buildStyleProfile>;
  index: ExemplarIndex;
  holdout: ReturnType<typeof splitHoldout>;
}

/** Parse, clean, and build persona assets from one export file. */
export function runImportPipeline(input: ImportPipelineInput): ImportPipelineResult {
  const text = decodeBytes(input.bytes);
  const parsed = parseImport(input.fileName, text, {
    conversation: input.conversationId,
  });
  const { sessions, report } = cleanImport(parsed, input.mapping);
  const style = buildStyleProfile(sessions, { meNames: input.mapping.me });
  const split = splitHoldout(extractExemplars(sessions));
  const index = ExemplarIndex.build(split.train);
  return { sessions, report, style, index, holdout: split };
}

export function consentComplete(c: ConsentRecord, firstRunAdult: boolean): boolean {
  if (!firstRunAdult || !c.ageAdult) return false;
  if (!c.personalUseOnly) return false;
  if (c.subject === "self") return c.subjectName.trim().length > 0 && c.relation.trim().length > 0;
  if (c.subject === "living") return c.subjectConsented && c.subjectName.trim().length > 0;
  if (c.subject === "deceased")
    return c.subjectName.trim().length > 0 && c.relation.trim().length > 0;
  return false;
}

export function defaultConsent(partial?: Partial<ConsentRecord>): ConsentRecord {
  const now = Date.now();
  return {
    subject: "living",
    subjectName: "",
    relation: "",
    subjectConsented: false,
    personalUseOnly: true,
    voiceConsent: false,
    declaredAt: now,
    ageAdult: true,
    ...partial,
  };
}

export async function persistCharacterAssets(
  repo: CharacterRepo,
  id: string,
  pipeline: ImportPipelineResult,
): Promise<void> {
  await repo.putAsset(id, "sessions", pipeline.sessions);
  await repo.putAsset(id, "index", pipeline.index.toJSON());
  await repo.putAsset(id, "holdout", pipeline.holdout.holdout);
  await repo.putAsset(id, "importReport", pipeline.report);
}

export async function saveCharacterWithStyle(
  repo: CharacterRepo,
  character: Character,
  pipeline: ImportPipelineResult,
  activate = true,
): Promise<Character> {
  const next: Character = {
    ...character,
    style: pipeline.style,
    gentleMode: character.consent.subject === "deceased",
  };
  await repo.save(next);
  await persistCharacterAssets(repo, next.id, pipeline);
  if (activate) await repo.setActiveId(next.id);
  await notifyCharactersChanged();
  return next;
}

export async function generateAndSavePersona(
  repo: CharacterRepo,
  character: Character,
  llm: LlmClient,
  onProgress?: (p: PersonaProgress) => void,
  signal?: AbortSignal,
): Promise<PersonaCard> {
  const sessions = await repo.getAsset(character.id, "sessions");
  if (!sessions?.length) throw new Error("请先完成聊天记录导入");
  const persona = await generatePersonaCard(
    sessions,
    {
      name: character.consent.subjectName || character.name,
      relation: character.consent.relation,
    },
    llm,
    {
      onProgress,
      signal,
      userNotes: character.persona?.userNotes,
    },
  );
  const updated: Character = { ...character, persona };
  await repo.save(updated);
  await notifyCharactersChanged();
  return persona;
}

export function createCharacterDraft(input: {
  name: string;
  avatar: string;
  consent: ConsentRecord;
}): Character {
  const now = Date.now();
  return {
    id: newCharacterId(),
    name: input.name.trim() || "未命名",
    consent: { ...input.consent, declaredAt: input.consent.declaredAt || now },
    avatar: input.avatar,
    createdAt: now,
    gentleMode: input.consent.subject === "deceased",
    archived: false,
  };
}

export function exportConsentRecord(character: Character): string {
  return JSON.stringify(
    {
      characterId: character.id,
      characterName: character.name,
      consent: character.consent,
      exportedAt: new Date().toISOString(),
    },
    null,
    2,
  );
}

async function notifyCharactersChanged(): Promise<void> {
  if (isTauri()) await emit(CHARACTERS_CHANGED_EVENT);
}
