import { describe, expect, it } from "vitest";
import type { SafetyHooks } from "../dialogue";
import { createSafetyGuard } from ".";

describe("safety guard", () => {
  it("plugs into DialogueEngine as SafetyHooks", () => {
    const hooks: SafetyHooks = createSafetyGuard({});
    expect(hooks.precheck("我不想活了", [])?.safety).toBe("crisis");
  });
});
