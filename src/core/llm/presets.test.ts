import { describe, expect, it } from "vitest";
import { LLM_PRESETS, matchPreset, presetById } from "./presets";

describe("LLM presets", () => {
  it("have unique ids and http(s) base URLs without trailing slash", () => {
    expect(new Set(LLM_PRESETS.map((p) => p.id)).size).toBe(LLM_PRESETS.length);
    for (const p of LLM_PRESETS) {
      expect(p.baseUrl).toMatch(/^https?:\/\/[^/]+.*[^/]$/);
      expect(p.models).toContain(p.model);
    }
  });

  it("matches saved base URLs back to a preset", () => {
    expect(matchPreset("https://api.deepseek.com/v1/")?.id).toBe("deepseek");
    expect(matchPreset(" HTTP://localhost:11434/v1 ")?.id).toBe("ollama");
    expect(matchPreset("https://example.com/v1")).toBeUndefined();
    expect(presetById("ollama")?.needsKey).toBe(false);
  });
});
