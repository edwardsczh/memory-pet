import { describe, expect, it } from "vitest";
import type { ConsentRecord } from "../core/model";
import { buildCharacterRecord } from "./buildCharacter";
import {
  CLEARED_PICTURE_NOTICE,
  deleteReviewLine,
  deleteReviewPicture,
  discardReview,
  mappingForScreenshot,
  reviewToImport,
  settlePicture,
  type ReviewPicture,
} from "./screenshotReview";

const consent: ConsentRecord = {
  subject: "living",
  subjectName: "小鹿",
  relation: "女朋友",
  subjectConsented: true,
  personalUseOnly: true,
  voiceConsent: false,
  declaredAt: 1,
  ageAdult: true,
};

function picture(
  id: string,
  name: string,
  lines: { text: string; who: "me" | "ta" | "unknown" }[],
): ReviewPicture {
  return settlePicture({ id, name, status: "reading", lines: [], notice: null }, lines);
}

describe("screenshot review before save", () => {
  const shots = [
    picture("a", "a.png", [
      { text: "在吗", who: "me" },
      { text: "在的呀", who: "ta" },
    ]),
    picture("b", "b.png", [{ text: "早点休息", who: "ta" }]),
  ];

  it("deletes a line, a picture, or all of it without saving", async () => {
    const withoutLine = deleteReviewLine(shots, "a", "a-l1");
    expect(withoutLine.saved).toBe(false);
    expect(withoutLine.pictures[0].lines.map((line) => line.text)).toEqual(["在的呀"]);
    expect(
      reviewToImport(withoutLine.pictures, 1_700_000_000_000)?.messages.map((m) => m.text),
    ).toEqual(["在的呀", "早点休息"]);

    const cleared = deleteReviewLine(withoutLine.pictures, "a", "a-l2");
    expect(cleared.saved).toBe(false);
    expect(cleared.pictures[0].notice).toBe(CLEARED_PICTURE_NOTICE);
    expect(cleared.pictures[0].lines).toEqual([]);

    const withoutPicture = deleteReviewPicture(shots, "b");
    expect(withoutPicture.saved).toBe(false);
    expect(withoutPicture.pictures.map((p) => p.id)).toEqual(["a"]);

    const discarded = discardReview();
    expect(discarded.saved).toBe(false);
    expect(discarded.pictures).toEqual([]);
    expect(reviewToImport(discarded.pictures)).toBeNull();

    const kept = reviewToImport(withoutPicture.pictures, 1_700_000_000_000);
    expect(kept?.messages.map((m) => m.text)).toEqual(["在吗", "在的呀"]);
    const { character, assets } = await buildCharacterRecord(
      consent,
      kept!,
      mappingForScreenshot(kept!),
      { now: 5 },
    );
    expect(character.name).toBe("小鹿");
    expect(assets.report.kept).toBe(2);
    const texts = assets.sessions.flatMap((session) =>
      session.turns.flatMap((turn) => turn.messages.map((message) => message.text)),
    );
    expect(texts).toEqual(["在吗", "在的呀"]);
  });
});
