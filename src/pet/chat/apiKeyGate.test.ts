import { describe, expect, it } from "vitest";
import { LLM_PRESETS } from "../../core/llm/presets";
import { NO_API_KEY_EXPLANATION, needsApiKey } from "./apiKeyGate";

describe("needsApiKey", () => {
  it("asks for the user's own key on the default DeepSeek preset", () => {
    expect(LLM_PRESETS[0]?.id).toBe("deepseek");
    const deepseek = LLM_PRESETS[0]!;
    expect(needsApiKey({ hasKey: false, baseUrl: deepseek.baseUrl })).toBe(true);
    expect(needsApiKey({ hasKey: true, baseUrl: deepseek.baseUrl })).toBe(false);
  });

  it("lets a local OpenAI-compatible address through without a key", () => {
    expect(needsApiKey({ hasKey: false, baseUrl: "http://127.0.0.1:11434/v1" })).toBe(false);
    expect(needsApiKey({ hasKey: false, baseUrl: "http://localhost:8787/v1" })).toBe(false);
  });
});

describe("NO_API_KEY_EXPLANATION", () => {
  it("explains the missing key in Chinese and does not ship one", () => {
    expect(NO_API_KEY_EXPLANATION).toMatch(/没有内置 API Key/);
    expect(NO_API_KEY_EXPLANATION).toMatch(/你自己的 Key/);
    expect(NO_API_KEY_EXPLANATION).toMatch(/DeepSeek/);
    expect(NO_API_KEY_EXPLANATION).not.toMatch(/sk-[A-Za-z0-9]{8,}/);
  });
});
