import type { ParsedImport, SpeakerMapping } from "../core/model";
import { buildImport } from "../core/ingest/build";

export type LineWho = "me" | "ta" | "unknown";

export const WHO_LABEL: Record<LineWho, string> = {
  me: "我",
  ta: "对方",
  unknown: "未知",
};

export const SENDER_BY_WHO: Record<LineWho, string> = WHO_LABEL;

export const EMPTY_PICTURE_NOTICE = "这张图片里没有读出文字，不会用它保存角色。";
export const UNREADABLE_PICTURE_NOTICE = "这张图片没能读出文字，不会用它保存角色。";
export const CLEARED_PICTURE_NOTICE = "这张图片里的句子已删掉，不会用它保存角色。";
export const DISCARD_NOTE = "没有保存这些截图。";

export interface SeenLine {
  text: string;
  who: LineWho;
}

export interface ReviewLine extends SeenLine {
  id: string;
}

export type PictureStatus = "reading" | "ready" | "empty" | "error";

export interface ReviewPicture {
  id: string;
  name: string;
  status: PictureStatus;
  lines: ReviewLine[];
  notice: string | null;
}

/** Review edits never write a character. `saved` stays false. */
export interface UnsavedReview {
  pictures: ReviewPicture[];
  saved: false;
}

let pictureSeq = 0;

export function nextPictureId(): string {
  pictureSeq += 1;
  return `shot-${pictureSeq}`;
}

export function readingPicture(id: string, name: string): ReviewPicture {
  return { id, name, status: "reading", lines: [], notice: null };
}

export function settlePicture(picture: ReviewPicture, lines: SeenLine[]): ReviewPicture {
  if (lines.length === 0) {
    return { ...picture, status: "empty", lines: [], notice: EMPTY_PICTURE_NOTICE };
  }
  return {
    ...picture,
    status: "ready",
    notice: null,
    lines: lines.map((line, i) => ({
      id: `${picture.id}-l${i + 1}`,
      text: line.text,
      who: line.who,
    })),
  };
}

export function unreadablePicture(picture: ReviewPicture): ReviewPicture {
  return { ...picture, status: "error", lines: [], notice: UNREADABLE_PICTURE_NOTICE };
}

function unsaved(pictures: ReviewPicture[]): UnsavedReview {
  return { pictures, saved: false };
}

export function deleteReviewLine(
  pictures: ReviewPicture[],
  pictureId: string,
  lineId: string,
): UnsavedReview {
  return unsaved(
    pictures.map((picture) => {
      if (picture.id !== pictureId) return picture;
      const lines = picture.lines.filter((line) => line.id !== lineId);
      if (lines.length === picture.lines.length) return picture;
      if (lines.length === 0) {
        return { ...picture, lines, status: "empty", notice: CLEARED_PICTURE_NOTICE };
      }
      return { ...picture, lines };
    }),
  );
}

export function deleteReviewPicture(pictures: ReviewPicture[], pictureId: string): UnsavedReview {
  return unsaved(pictures.filter((picture) => picture.id !== pictureId));
}

export function discardReview(): UnsavedReview {
  return unsaved([]);
}

/**
 * The lines the user still sees, in picture order, as an import the existing
 * memory path already accepts. Null when nothing is left to save.
 */
export function reviewToImport(pictures: ReviewPicture[], now = Date.now()): ParsedImport | null {
  const rows: { ts: number; sender: string; text: string; sourceId: string }[] = [];
  for (const picture of pictures) {
    for (const line of picture.lines) {
      rows.push({
        ts: now + rows.length * 1000,
        sender: SENDER_BY_WHO[line.who],
        text: line.text,
        sourceId: line.id,
      });
    }
  }
  if (rows.length === 0) return null;
  const hasMe = rows.some((row) => row.sender === SENDER_BY_WHO.me);
  return buildImport("plain-text", rows, {
    title: "微信截图",
    isGroup: false,
    selfSender: hasMe ? SENDER_BY_WHO.me : undefined,
    warnings: ["这些句子来自本机读取的截图，只保留了确认时还在的行。"],
  });
}

export function mappingForScreenshot(parsed: ParsedImport): SpeakerMapping {
  const names = new Set(parsed.participants.map((p) => p.sender));
  return {
    me: names.has(SENDER_BY_WHO.me) ? [SENDER_BY_WHO.me] : [],
    ta: names.has(SENDER_BY_WHO.ta) ? [SENDER_BY_WHO.ta] : [],
  };
}
