import { isTauri } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { CHARACTERS_CHANGED_EVENT } from "../core/storage/characters";

export async function notifyCharactersChanged() {
  if (isTauri()) await emit(CHARACTERS_CHANGED_EVENT);
}
