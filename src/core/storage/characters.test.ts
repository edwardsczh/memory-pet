import { describe, expect, it } from "vitest";
import type { Character } from "../model";
import { createCharacterRepo, newCharacterId } from "./characters";
import { createLocalVault, isValidName } from "./vault";

function character(id: string, createdAt: number): Character {
  return {
    id,
    name: "小鹿",
    consent: {
      subject: "living",
      subjectName: "小鹿",
      relation: "女朋友",
      subjectConsented: true,
      personalUseOnly: true,
      voiceConsent: false,
      declaredAt: createdAt,
      ageAdult: true,
    },
    avatar: "momo",
    createdAt,
    gentleMode: false,
    archived: false,
  };
}

describe("character repo", () => {
  it("ids are valid vault names", () => {
    const id = newCharacterId();
    expect(isValidName(id)).toBe(true);
    expect(isValidName(`c-${id}`)).toBe(true);
  });

  it("saves, lists, activates and removes with assets", async () => {
    const repo = createCharacterRepo(createLocalVault());
    await repo.save(character("b", 2));
    await repo.save(character("a", 1));
    expect((await repo.list()).map((c) => c.id)).toEqual(["a", "b"]);

    await repo.setActiveId("a");
    await repo.putAsset("a", "chatLog", [{ role: "user", text: "hi", ts: 1 }]);
    expect(await repo.getAsset("a", "chatLog")).toHaveLength(1);

    await repo.remove("a");
    expect(await repo.get("a")).toBeNull();
    expect(await repo.getAsset("a", "chatLog")).toBeNull();
    expect(await repo.getActiveId()).toBeNull();
  });
});
