import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Closes the pet window (and with it the app). Needs the
 * `core:window:allow-close` capability. No-op outside Tauri.
 */
export async function exitApp(): Promise<void> {
  if (!isTauri()) return;
  await getCurrentWindow().close();
}

/** Hides the pet window; needs `core:window:allow-hide`. No-op outside Tauri. */
export async function hideWindow(): Promise<void> {
  if (!isTauri()) return;
  await getCurrentWindow().hide();
}

/** Needs `core:window:allow-show`. No-op outside Tauri. */
export async function showWindow(): Promise<void> {
  if (!isTauri()) return;
  await getCurrentWindow().show();
}
