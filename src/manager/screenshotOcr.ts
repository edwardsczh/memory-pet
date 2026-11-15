import { createWorker, OEM, PSM } from "tesseract.js";
import type { LineWho, SeenLine } from "./screenshotReview";

const MIN_CONFIDENCE = 40;

export interface OcrBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrLineBox {
  text: string;
  confidence: number;
  bbox: OcrBox;
}

/** Right-side bubbles are the user, left-side bubbles are the other person. */
export function whoFromBox(bbox: OcrBox, imageWidth: number): LineWho {
  if (!Number.isFinite(imageWidth) || imageWidth <= 0) return "unknown";
  const left = bbox.x0 / imageWidth;
  const right = bbox.x1 / imageWidth;
  const center = (bbox.x0 + bbox.x1) / 2 / imageWidth;
  if (right >= 0.72 && center >= 0.45) return "me";
  if (left <= 0.28 && center <= 0.55) return "ta";
  return "unknown";
}

/** Keep only text the recognizer returned. Nothing is added. */
export function linesFromOcr(boxes: OcrLineBox[], imageWidth: number): SeenLine[] {
  const sorted = [...boxes].sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  const lines: SeenLine[] = [];
  for (const box of sorted) {
    if (!(box.confidence >= MIN_CONFIDENCE)) continue;
    for (const part of box.text.split(/\n+/)) {
      const text = part.trim();
      if (!text) continue;
      lines.push({ text, who: whoFromBox(box.bbox, imageWidth) });
    }
  }
  return lines;
}

interface OcrBlock {
  paragraphs?: { lines?: OcrLineBox[] }[];
}

type Worker = Awaited<ReturnType<typeof createWorker>>;

let workerPromise: Promise<Worker> | null = null;
let jobChain: Promise<unknown> = Promise.resolve();

function inBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function langPath(): string {
  if (inBrowser()) return "/tessdata";
  const cwd = (globalThis as { process?: { cwd?: () => string } }).process?.cwd?.();
  return cwd ? `${cwd}/ocr` : "ocr";
}

async function startWorker(): Promise<Worker> {
  const browser = inBrowser();
  const worker = await createWorker("chi_sim", OEM.LSTM_ONLY, {
    langPath: langPath(),
    gzip: false,
    cacheMethod: "none",
    ...(browser
      ? {
          workerPath: "/tesseract/worker.min.js",
          corePath: "/tesseract/tesseract-core-simd-lstm.wasm.js",
          workerBlobURL: false,
        }
      : {}),
  });
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SPARSE_TEXT,
    user_defined_dpi: "300",
  });
  return worker;
}

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = startWorker().catch((err: unknown) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

function boxesFromPage(blocks: OcrBlock[] | null | undefined): OcrLineBox[] {
  const boxes: OcrLineBox[] = [];
  for (const block of blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        if (line?.bbox) boxes.push(line);
      }
    }
  }
  return boxes;
}

/**
 * Read one prepared image with the bundled simplified-Chinese model.
 * The model file is local. This does not call a cloud OCR service.
 */
export async function recognizeScreenshot(
  image: Uint8Array,
  imageWidth: number,
): Promise<SeenLine[]> {
  const run = jobChain.then(async () => {
    const worker = await getWorker();
    const result = await worker.recognize(image, {}, { text: true, blocks: true });
    const data = result.data as { text?: string; blocks?: OcrBlock[] | null };
    const fromBoxes = linesFromOcr(boxesFromPage(data.blocks), imageWidth);
    if (fromBoxes.length > 0) return fromBoxes;
    const fallback: SeenLine[] = [];
    for (const part of (data.text ?? "").split(/\n+/)) {
      const text = part.trim();
      if (text) fallback.push({ text, who: "unknown" });
    }
    return fallback;
  });
  jobChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function shutdownRecognizer(): Promise<void> {
  const pending = workerPromise;
  workerPromise = null;
  if (!pending) return;
  try {
    const worker = await pending;
    await worker.terminate();
  } catch {
    // The worker never started.
  }
}
