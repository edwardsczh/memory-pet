/** OpenAI-compatible providers offered in the settings page. Model names stay free-form. */
export interface LlmPreset {
  id: string;
  name: string;
  baseUrl: string;
  /** Suggested default model. */
  model: string;
  /** Other common model names, shown as suggestions. */
  models: string[];
  needsKey: boolean;
  /** Where to get an API key. */
  keyUrl?: string;
}

export const LLM_PRESETS: readonly LlmPreset[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-reasoner"],
    needsKey: true,
    keyUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "dashscope",
    name: "通义千问（DashScope）",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    models: ["qwen-plus", "qwen-turbo", "qwen-max"],
    needsKey: true,
    keyUrl: "https://bailian.console.aliyun.com/",
  },
  {
    id: "moonshot",
    name: "Kimi（Moonshot）",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "moonshot-v1-8k",
    models: ["moonshot-v1-8k", "moonshot-v1-32k", "kimi-latest"],
    needsKey: true,
    keyUrl: "https://platform.moonshot.cn/console/api-keys",
  },
  {
    id: "zhipu",
    name: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4-flash",
    models: ["glm-4-flash", "glm-4-plus", "glm-4-air"],
    needsKey: true,
    keyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
  },
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"],
    needsKey: true,
    keyUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "ollama",
    name: "本地 Ollama",
    baseUrl: "http://localhost:11434/v1",
    model: "qwen2.5:7b",
    models: ["qwen2.5:7b", "qwen2.5:14b", "llama3.1:8b"],
    needsKey: false,
  },
];

export const CUSTOM_PRESET_ID = "custom";

function normalize(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

/** Finds the preset whose base URL matches, or undefined for a custom endpoint. */
export function matchPreset(baseUrl: string): LlmPreset | undefined {
  const target = normalize(baseUrl);
  return LLM_PRESETS.find((p) => normalize(p.baseUrl) === target);
}

export function presetById(id: string): LlmPreset | undefined {
  return LLM_PRESETS.find((p) => p.id === id);
}
