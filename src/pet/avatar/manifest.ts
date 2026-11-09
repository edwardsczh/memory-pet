import type { Emotion } from "../../core/model";

const EMOTION_KEYS: Record<Emotion, true> = {
  neutral: true,
  happy: true,
  sad: true,
  angry: true,
  surprised: true,
  shy: true,
  thinking: true,
};
export const EMOTIONS = Object.keys(EMOTION_KEYS) as Emotion[];

/** Layers for one expression. Paths are relative to the manifest's directory. */
export interface EmotionFrames {
  eyes: string;
  mouth: string;
  brows: string | null;
  /** Eyes-closed layer swapped in for blinks; null when the eyes are already closed. */
  blink: string | null;
  /** Open-mouth layer alternated with `mouth` while talking; null keeps the mouth still. */
  talk: string | null;
  /** Overlays drawn above everything (blush, tears, marks). */
  fx: string[];
}

export interface AvatarCredit {
  title: string;
  author: string;
  url: string;
  license: string;
  licenseUrl: string;
  attribution: string;
}

/**
 * A layered sprite character. All layers share one canvas, so they are stacked
 * without offsets in this order: base, mouth, eyes, brows, front, fx.
 */
export interface AvatarManifest {
  id: string;
  name: string;
  /** Display size in CSS px. */
  size: { width: number; height: number };
  /** Point of the canvas (0–1) that stays fixed while breathing / bouncing. */
  anchor: { x: number; y: number };
  layers: { base: string[]; front: string[] };
  emotions: Partial<Record<Emotion, EmotionFrames>> & { neutral: EmotionFrames };
  credits: AvatarCredit[];
}

export class ManifestError extends Error {
  constructor(message: string) {
    super(`avatar manifest: ${message}`);
    this.name = "ManifestError";
  }
}

export function manifestUrl(characterId: string): string {
  return `/avatar/${encodeURIComponent(characterId)}/manifest.json`;
}

/** Resolves a layer path against the directory of the manifest it came from. */
export function layerUrl(manifestHref: string, path: string): string {
  return manifestHref.slice(0, manifestHref.lastIndexOf("/") + 1) + path;
}

/** Frames for `emotion`, falling back to neutral when the character lacks it. */
export function resolveEmotion(manifest: AvatarManifest, emotion: Emotion): EmotionFrames {
  return manifest.emotions[emotion] ?? manifest.emotions.neutral;
}

/** Every distinct layer path the manifest references, for preloading. */
export function allLayers(manifest: AvatarManifest): string[] {
  const paths = [...manifest.layers.base, ...manifest.layers.front];
  for (const f of Object.values(manifest.emotions)) {
    paths.push(f.eyes, f.mouth, ...f.fx);
    for (const p of [f.brows, f.blink, f.talk]) if (p) paths.push(p);
  }
  return [...new Set(paths)];
}

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(o: Obj, key: string, where: string): string {
  const v = o[key];
  if (typeof v !== "string" || v.length === 0)
    throw new ManifestError(`${where}.${key} must be a non-empty string`);
  return v;
}

function num(o: Obj, key: string, where: string, min: number, max: number): number {
  const v = o[key];
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) {
    throw new ManifestError(`${where}.${key} must be a number in [${min}, ${max}]`);
  }
  return v;
}

// Manifests may later come from user-imported characters, so layers must stay
// inside the character directory.
function layerPath(v: unknown, where: string): string {
  if (typeof v !== "string" || v.length === 0)
    throw new ManifestError(`${where} must be a layer path`);
  if (v.startsWith("/") || v.includes("\\") || v.includes(":") || v.split("/").includes("..")) {
    throw new ManifestError(
      `${where} must be a relative path inside the character directory: ${v}`,
    );
  }
  return v;
}

function optionalLayer(o: Obj, key: string, where: string): string | null {
  return o[key] === undefined || o[key] === null ? null : layerPath(o[key], `${where}.${key}`);
}

function layerList(v: unknown, where: string): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new ManifestError(`${where} must be an array of layer paths`);
  return v.map((p, i) => layerPath(p, `${where}[${i}]`));
}

function parseFrames(v: unknown, where: string): EmotionFrames {
  if (!isObj(v)) throw new ManifestError(`${where} must be an object`);
  return {
    eyes: layerPath(v.eyes, `${where}.eyes`),
    mouth: layerPath(v.mouth, `${where}.mouth`),
    brows: optionalLayer(v, "brows", where),
    blink: optionalLayer(v, "blink", where),
    talk: optionalLayer(v, "talk", where),
    fx: layerList(v.fx, `${where}.fx`),
  };
}

function parseCredit(v: unknown, i: number): AvatarCredit {
  const where = `credits[${i}]`;
  if (!isObj(v)) throw new ManifestError(`${where} must be an object`);
  return {
    title: str(v, "title", where),
    author: str(v, "author", where),
    url: str(v, "url", where),
    license: str(v, "license", where),
    licenseUrl: str(v, "licenseUrl", where),
    attribution: str(v, "attribution", where),
  };
}

/** Validates untrusted manifest JSON. Unknown emotion keys are ignored. */
export function parseManifest(raw: unknown): AvatarManifest {
  if (!isObj(raw)) throw new ManifestError("root must be an object");
  if (raw.version !== 1) throw new ManifestError(`unsupported version ${String(raw.version)}`);

  const id = str(raw, "id", "manifest");
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) throw new ManifestError(`invalid id "${id}"`);

  if (!isObj(raw.size)) throw new ManifestError("size must be an object");
  const size = {
    width: num(raw.size, "width", "size", 1, 4096),
    height: num(raw.size, "height", "size", 1, 4096),
  };
  const anchorRaw = raw.anchor === undefined ? { x: 0.5, y: 1 } : raw.anchor;
  if (!isObj(anchorRaw)) throw new ManifestError("anchor must be an object");
  const anchor = { x: num(anchorRaw, "x", "anchor", 0, 1), y: num(anchorRaw, "y", "anchor", 0, 1) };

  if (!isObj(raw.layers)) throw new ManifestError("layers must be an object");
  const layers = {
    base: layerList(raw.layers.base, "layers.base"),
    front: layerList(raw.layers.front, "layers.front"),
  };
  if (layers.base.length === 0) throw new ManifestError("layers.base needs at least one layer");

  if (!isObj(raw.emotions)) throw new ManifestError("emotions must be an object");
  if (raw.emotions.neutral === undefined) throw new ManifestError("emotions.neutral is required");
  const emotions: Partial<Record<Emotion, EmotionFrames>> = {};
  for (const e of EMOTIONS) {
    if (raw.emotions[e] !== undefined) emotions[e] = parseFrames(raw.emotions[e], `emotions.${e}`);
  }

  if (!Array.isArray(raw.credits) || raw.credits.length === 0) {
    throw new ManifestError("credits must list the source and license of the art");
  }

  return {
    id,
    name: str(raw, "name", "manifest"),
    size,
    anchor,
    layers,
    emotions: emotions as AvatarManifest["emotions"],
    credits: raw.credits.map(parseCredit),
  };
}
