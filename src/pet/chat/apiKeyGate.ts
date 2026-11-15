import { isTauri } from "@tauri-apps/api/core";
import { getLlmSettings } from "../../core/llm/tauriClient";

/** Shown before the first send when the installed app has no key of its own. */
export const NO_API_KEY_EXPLANATION =
  "这个版本没有内置 API Key。发出第一句之前，请在下面的设置里填入你自己的 Key。默认服务是 DeepSeek，也兼容其他 OpenAI 接口。Key 只保存在这台电脑上。本地模型地址可以不填 Key。";

export function isLocalLlmUrl(url: string): boolean {
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Cloud presets need a key the user brings. A local OpenAI-compatible URL does not. */
export function needsApiKey(settings: { hasKey: boolean; baseUrl: string }): boolean {
  return !settings.hasKey && !isLocalLlmUrl(settings.baseUrl);
}

/** False in the browser preview, where there is no vault and no installed app. */
export async function apiKeyMissing(): Promise<boolean> {
  if (!isTauri()) return false;
  return needsApiKey(await getLlmSettings());
}
