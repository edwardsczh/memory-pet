import { emit, isTauri } from "@tauri-apps/api/core";
import { CHARACTERS_CHANGED_EVENT } from "../core/storage/characters";

export async function notifyCharactersChanged() {
  if (isTauri()) await emit(CHARACTERS_CHANGED_EVENT);
}
