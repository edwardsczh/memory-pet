import type { Character } from "../../core/model";
import { cleanImport, parseImport } from "../../core/ingest";
import {
  buildStyleProfile,
  ExemplarIndex,
  extractExemplars,
  splitHoldout,
} from "../../core/persona";
import type { CharacterRepo } from "../../core/storage/characters";

export const DEMO_CHARACTER_ID = "demo-xiaolu";

/**
 * Builds the fictional demo character 小鹿 from fixtures/demo (阿哲 = user) with the real import
 * and persona pipeline, so the pet can be tested end to end without the management window.
 * Dev builds only: the caller imports this module lazily behind `import.meta.env.DEV`.
 */
export async function installDemoCharacter(repo: CharacterRepo, now = Date.now()) {
  const { default: raw } = await import("../../../fixtures/demo/xiaolu-wechat-exporter.json?raw");
  const parsed = parseImport("xiaolu-wechat-exporter.json", raw);
  const { sessions, report } = cleanImport(parsed, { me: ["阿哲"], ta: ["小鹿"] });
  const style = buildStyleProfile(sessions);
  const exemplars = extractExemplars(sessions);
  const split = splitHoldout(exemplars);
  const index = ExemplarIndex.build(split.train);

  const character: Character = {
    id: DEMO_CHARACTER_ID,
    name: "小鹿",
    consent: {
      subject: "living",
      subjectName: "小鹿",
      relation: "女朋友",
      subjectConsented: true,
      personalUseOnly: true,
      voiceConsent: false,
      declaredAt: now,
      ageAdult: true,
    },
    persona: {
      name: "小鹿",
      relation: "女朋友",
      summary: "（示例）说话轻快俏皮，爱撒娇也爱吐槽，很在意对方有没有好好吃饭睡觉。",
      traits: [],
      addressing: style.nicknamesForMe.length ? style.nicknamesForMe.slice(0, 2) : ["笨蛋"],
      taboos: [],
      userNotes: "虚构演示角色，数据来自 fixtures/demo。",
      updatedAt: now,
    },
    style,
    avatar: "momo",
    createdAt: now,
    gentleMode: false,
    archived: false,
  };
  await repo.save(character);
  await repo.putAsset(DEMO_CHARACTER_ID, "sessions", sessions);
  await repo.putAsset(DEMO_CHARACTER_ID, "index", index.toJSON());
  await repo.putAsset(DEMO_CHARACTER_ID, "holdout", split.holdout);
  await repo.putAsset(DEMO_CHARACTER_ID, "importReport", report);
  await repo.setActiveId(DEMO_CHARACTER_ID);
  return { character, exemplars: index.size, sessions: sessions.length };
}
