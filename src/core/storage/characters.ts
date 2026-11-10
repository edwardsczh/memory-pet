import type { Character, CleanReport, DialogueTurn, Exemplar, Session } from "../model";
import { PROACTIVE_GREET_VAULT_KEY } from "../schedule/proactive";
import type { Vault } from "./vault";

/**
 * Per-character persistence shared by the management window (import, persona
 * editing) and the pet window (chat). Layout inside the vault:
 *
 * - `characters/<id>`: the `Character` record (consent, persona, style, avatar).
 * - `app/active`: `{ id }` of the character the pet currently plays.
 * - `c-<id>/<asset>`: bulky data, loaded only when needed.
 */
export interface CharacterAssets {
  sessions: Session[];
  /** `ExemplarIndex#toJSON()` output. */
  index: unknown;
  holdout: Exemplar[];
  importReport: CleanReport;
  chatLog: DialogueTurn[];
}

export type CharacterAssetKey = keyof CharacterAssets;

const CHARACTERS = "characters";
const APP = "app";
const assetNs = (id: string) => `c-${id}`;

/** Tauri event broadcast to every window after a character is saved, deleted or activated. */
export const CHARACTERS_CHANGED_EVENT = "app://characters-changed";

export function newCharacterId(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function createCharacterRepo(vault: Vault) {
  return {
    async list(): Promise<Character[]> {
      const ids = await vault.list(CHARACTERS);
      const all = await Promise.all(ids.map((id) => vault.get<Character>(CHARACTERS, id)));
      return all
        .filter((c): c is Character => c !== null)
        .sort((a, b) => a.createdAt - b.createdAt);
    },
    get: (id: string) => vault.get<Character>(CHARACTERS, id),
    save: (c: Character) => vault.put(CHARACTERS, c.id, c),
    async remove(id: string): Promise<void> {
      await vault.delete(CHARACTERS, id);
      await vault.wipe(assetNs(id));
      const active = await vault.get<{ id: string }>(APP, "active");
      if (active?.id === id) await vault.delete(APP, "active");
    },
    async getActiveId(): Promise<string | null> {
      return (await vault.get<{ id: string }>(APP, "active"))?.id ?? null;
    },
    setActiveId: (id: string) => vault.put(APP, "active", { id }),
    async getLastProactiveGreet(): Promise<number | null> {
      const row = await vault.get<{ at: number }>(APP, PROACTIVE_GREET_VAULT_KEY);
      return row?.at ?? null;
    },
    setLastProactiveGreet(at: number) {
      return vault.put(APP, PROACTIVE_GREET_VAULT_KEY, { at });
    },
    getAsset<K extends CharacterAssetKey>(id: string, key: K): Promise<CharacterAssets[K] | null> {
      return vault.get<CharacterAssets[K]>(assetNs(id), key);
    },
    putAsset<K extends CharacterAssetKey>(id: string, key: K, value: CharacterAssets[K]) {
      return vault.put(assetNs(id), key, value);
    },
  };
}

export type CharacterRepo = ReturnType<typeof createCharacterRepo>;
