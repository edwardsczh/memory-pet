import { describe, expect, it } from "vitest";
import type { LlmRequest } from "../../core/model";
import { createCharacterRepo } from "../../core/storage/characters";
import { createLocalVault } from "../../core/storage/vault";
import { createChatBackend } from "./backend";
import { DEMO_CHARACTER_ID, installDemoCharacter } from "./demoCharacter";

describe("demo character 小鹿", () => {
  it("is saved as the active character and drives the engine with exemplars", async () => {
    const repo = createCharacterRepo(createLocalVault());
    const r = await installDemoCharacter(repo, 0);
    expect(r.exemplars).toBeGreaterThan(200);
    expect(await repo.getActiveId()).toBe(DEMO_CHARACTER_ID);

    const c = await repo.get(DEMO_CHARACTER_ID);
    expect(c?.style?.messageCount).toBeGreaterThan(500);
    const calls: LlmRequest[] = [];
    const backend = createChatBackend(c!, {
      llm: {
        complete: async (req) => {
          calls.push(req);
          return '{"messages":["奶茶！"],"emotion":"happy"}';
        },
      },
      index: await repo.getAsset(DEMO_CHARACTER_ID, "index"),
      saveLog: async () => {},
    });
    const reply = await backend.reply([], "要不要喝奶茶", {});
    expect(reply.messages).toEqual(["奶茶！"]);
    const system = calls[0].messages[0].content;
    expect(system).toContain("小鹿");
    expect(system).toMatch(/用户：.*\nTA：/);
  });
});
