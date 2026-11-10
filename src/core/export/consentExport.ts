import type { Character, ConsentRecord } from "../model";

export const CONSENT_EXPORT_VERSION = 1;

/** JSON shape for consent / persona backup — never includes raw chat. */
export interface ConsentExportDocument {
  version: typeof CONSENT_EXPORT_VERSION;
  exportedAt: number;
  characterId: string;
  characterName: string;
  consent: ConsentRecord;
  personaSummary: string | null;
}

const FORBIDDEN_KEYS = new Set([
  "messages",
  "sessions",
  "exemplars",
  "holdout",
  "style",
  "text",
  "content",
]);

/** Build an export snapshot from a stored character (no chat assets). */
export function buildConsentExport(
  character: Character,
  exportedAt: number = Date.now(),
): ConsentExportDocument {
  return {
    version: CONSENT_EXPORT_VERSION,
    exportedAt,
    characterId: character.id,
    characterName: character.name,
    consent: { ...character.consent },
    personaSummary: character.persona?.summary?.trim() ? character.persona.summary.trim() : null,
  };
}

export function serializeConsentExport(doc: ConsentExportDocument): string {
  return JSON.stringify(doc, null, 2);
}

/** Guardrail for tests and callers: reject keys that imply raw chat leaked in. */
export function assertNoChatFields(value: unknown, path = ""): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoChatFields(item, `${path}[${i}]`));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(`forbidden export field: ${path ? `${path}.` : ""}${key}`);
    }
    assertNoChatFields(child, path ? `${path}.${key}` : key);
  }
}

export function consentExportFilename(character: Character, exportedAt: number): string {
  const safe =
    character.name.replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "") || "character";
  const day = new Date(exportedAt).toISOString().slice(0, 10);
  return `memory-pet-consent-${safe}-${day}.json`;
}
