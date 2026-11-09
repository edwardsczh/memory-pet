import { Channel, invoke } from "@tauri-apps/api/core";
import type { LlmClient, LlmRequest, LlmSettings } from "../model";

/** Mirrors `StreamEvent` in `src-tauri/src/llm.rs`. */
type StreamEvent = { event: "delta"; data: string } | { event: "done" };

export interface LlmTestResult {
  ok: boolean;
  latencyMs: number;
  /** Start of the model's reply, when ok. */
  sample?: string;
  /** User-facing Chinese error message, when not ok. */
  error?: string;
}

/**
 * `LlmClient` backed by the Rust commands. Errors are rejected with the
 * user-facing Chinese message from Rust (a string, not an `Error`).
 */
export function createTauriLlmClient(): LlmClient {
  return {
    complete: (req) => invoke<string>("llm_complete", { req }),
    stream: (req, onDelta) => streamCompletion(req, onDelta),
  };
}

async function streamCompletion(req: LlmRequest, onDelta: (text: string) => void): Promise<string> {
  let markDone!: () => void;
  const done = new Promise<void>((resolve) => (markDone = resolve));
  const channel = new Channel<StreamEvent>();
  channel.onmessage = (msg) => {
    if (msg.event === "delta") onDelta(msg.data);
    else markDone();
  };
  const full = await invoke<string>("llm_stream", { req, channel });
  // The command can resolve before the last channel messages are dispatched.
  await done;
  return full;
}

export const getLlmSettings = () => invoke<LlmSettings>("llm_get_settings");

export const saveLlmSettings = (baseUrl: string, model: string) =>
  invoke<void>("llm_save_settings", { baseUrl, model });

/** Stores the key in the vault; it can never be read back from the webview. */
export const setLlmKey = (key: string) => invoke<void>("llm_set_key", { key });

export const clearLlmKey = () => invoke<void>("llm_clear_key");

/** Sends a tiny request with the saved settings. Never rejects for provider errors. */
export const testLlm = () => invoke<LlmTestResult>("llm_test");

export const openSettingsWindow = () => invoke<void>("open_settings_window");
