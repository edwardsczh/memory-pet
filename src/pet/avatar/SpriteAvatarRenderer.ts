import type { Emotion } from "../../core/model";
import { AlphaMask } from "../alphaMask";
import { registerAlphaTarget } from "../hitTest";
import type { AvatarRenderer } from "./AvatarRenderer";
import {
  EMOTIONS,
  layerUrl,
  parseManifest,
  resolveEmotion,
  type AvatarManifest,
  type EmotionFrames,
} from "./manifest";
import "./avatar.css";

const BLINK_INTERVAL_MS: [number, number] = [2000, 6000];
const BLINK_MS = 130;
const DOUBLE_BLINK_CHANCE = 0.2;
const MOUTH_FLAP_MS: [number, number] = [90, 190];
const FIDGET_AFTER_IDLE_MS = 20_000;
const FIDGET_INTERVAL_MS: [number, number] = [15_000, 30_000];
const FIDGETS = ["tilt", "sway", "hop"] as const;
const ONE_SHOT_CLASSES = ["avatar-pop", ...FIDGETS.map((f) => `avatar-fidget-${f}`)];

interface Face {
  frames: EmotionFrames;
  face: HTMLElement;
  fx: HTMLElement;
  /** Layers that make up the resting frame, in paint order, for the alpha mask. */
  maskLayers: HTMLImageElement[];
  mask?: AlphaMask | null;
}

function div(className: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = className;
  return el;
}

function between([min, max]: [number, number]): number {
  return min + Math.random() * (max - min);
}

/**
 * Layered sprite character ("立绘差分"). Every layer is an `<img>` created once
 * at load; expressions, blinks and mouth flaps only toggle visibility, and idle
 * motion is pure CSS transforms, so nothing is repainted in JS while idle.
 *
 * The alpha mask is rebuilt per expression (cached) from its resting frame.
 * Blink and talk frames stay inside the face, so they reuse that mask.
 */
export class SpriteAvatarRenderer implements AvatarRenderer {
  readonly element = div("avatar");
  readonly hitElement = div("avatar-body");
  private readonly motion = div("avatar-motion");

  private manifest: AvatarManifest | null = null;
  private faces = new Map<Emotion, Face>();
  private current: Face | null = null;
  private emotion: Emotion = "neutral";
  private talking = false;
  private idle = true;
  private disposed = false;

  private blinkTimer = 0;
  private blinkEndTimer = 0;
  private mouthTimer = 0;
  private fidgetTimer = 0;

  constructor() {
    this.hitElement.dataset.hit = "alpha";
    this.motion.append(this.hitElement);
    this.element.append(this.motion);
    this.element.addEventListener("pointerdown", this.onActivity);
    this.motion.addEventListener("animationend", this.onMotionEnd);
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  async load(manifestHref: string): Promise<AvatarManifest> {
    const res = await fetch(manifestHref);
    if (!res.ok) throw new Error(`avatar manifest ${manifestHref}: HTTP ${res.status}`);
    const manifest = parseManifest(await res.json());
    if (this.disposed) return manifest;

    const images: HTMLImageElement[] = [];
    const img = (path: string, className?: string) => {
      const el = document.createElement("img");
      el.src = layerUrl(manifestHref, path);
      el.alt = "";
      el.draggable = false;
      if (className) el.className = className;
      images.push(el);
      return el;
    };

    const { width, height } = manifest.size;
    const origin = `${manifest.anchor.x * 100}% ${manifest.anchor.y * 100}%`;
    Object.assign(this.element.style, { width: `${width}px`, height: `${height}px` });
    this.motion.style.transformOrigin = origin;
    this.hitElement.style.transformOrigin = origin;
    this.element.setAttribute("aria-label", manifest.name);

    const base = manifest.layers.base.map((p) => img(p));
    const front = manifest.layers.front.map((p) => img(p));
    const faceRoot = document.createDocumentFragment();
    const fxRoot = document.createDocumentFragment();
    const built = new Map<EmotionFrames, Face>();
    for (const emotion of EMOTIONS) {
      const frames = resolveEmotion(manifest, emotion);
      let face = built.get(frames);
      if (!face) {
        const faceEl = div("avatar-face");
        faceEl.hidden = true;
        faceEl.classList.toggle("has-blink", frames.blink !== null);
        faceEl.classList.toggle("has-talk", frames.talk !== null);
        const mouth = img(frames.mouth, "avatar-mouth");
        const eyes = img(frames.eyes, "avatar-eyes");
        const brows = frames.brows ? img(frames.brows) : null;
        faceEl.append(mouth);
        if (frames.talk) faceEl.append(img(frames.talk, "avatar-talk"));
        faceEl.append(eyes);
        if (frames.blink) faceEl.append(img(frames.blink, "avatar-blink"));
        if (brows) faceEl.append(brows);

        const fxEl = div("avatar-fx");
        fxEl.hidden = true;
        const fx = frames.fx.map((p) => img(p));
        fxEl.append(...fx);

        const own = [mouth, eyes, ...(brows ? [brows] : [])];
        face = { frames, face: faceEl, fx: fxEl, maskLayers: [...base, ...own, ...front, ...fx] };
        built.set(frames, face);
        faceRoot.append(faceEl);
        fxRoot.append(fxEl);
      }
      this.faces.set(emotion, face);
    }
    this.hitElement.replaceChildren(...base, faceRoot, ...front, fxRoot);

    await Promise.all(
      images.map((el) =>
        el.decode().catch(() => {
          throw new Error(`avatar layer failed to load: ${el.src}`);
        }),
      ),
    );
    if (this.disposed) return manifest;

    this.manifest = manifest;
    this.showEmotion(this.emotion, false);
    this.setTalking(this.talking);
    this.applyIdle();
    this.element.classList.add("is-ready");
    return manifest;
  }

  setEmotion(emotion: Emotion): void {
    this.emotion = emotion;
    this.onActivity();
    if (this.manifest) this.showEmotion(emotion, true);
  }

  setTalking(talking: boolean): void {
    this.talking = talking;
    this.onActivity();
    window.clearTimeout(this.mouthTimer);
    this.element.classList.remove("mouth-open");
    if (talking && this.manifest) this.flapMouth();
  }

  setIdleAnimation(enabled: boolean): void {
    this.idle = enabled;
    this.applyIdle();
  }

  getAlphaMask(): AlphaMask | null {
    return this.current?.mask ?? null;
  }

  dispose(): void {
    this.disposed = true;
    this.clearIdleTimers();
    window.clearTimeout(this.mouthTimer);
    document.removeEventListener("visibilitychange", this.onVisibility);
    registerAlphaTarget(this.hitElement, null);
    this.element.remove();
  }

  private showEmotion(emotion: Emotion, animate: boolean): void {
    const next = this.faces.get(emotion);
    if (!next || !this.manifest) return;
    if (next !== this.current) {
      if (this.current) {
        this.current.face.hidden = true;
        this.current.fx.hidden = true;
      }
      next.face.hidden = false;
      next.fx.hidden = false;
      this.current = next;
      if (next.mask === undefined) {
        const { width, height } = this.manifest.size;
        next.mask = AlphaMask.fromLayers(next.maskLayers, width, height);
      }
      registerAlphaTarget(this.hitElement, next.mask);
    }
    if (animate) this.playOneShot("avatar-pop");
  }

  private flapMouth = () => {
    this.element.classList.toggle("mouth-open");
    this.mouthTimer = window.setTimeout(this.flapMouth, between(MOUTH_FLAP_MS));
  };

  private get idleActive(): boolean {
    return this.idle && !document.hidden && this.manifest !== null && !this.disposed;
  }

  private applyIdle(): void {
    this.element.classList.toggle("idle-off", !this.idle || document.hidden);
    this.clearIdleTimers();
    if (!this.idleActive) return;
    this.scheduleBlink();
    this.scheduleFidget(FIDGET_AFTER_IDLE_MS);
  }

  private clearIdleTimers(): void {
    window.clearTimeout(this.blinkTimer);
    window.clearTimeout(this.blinkEndTimer);
    window.clearTimeout(this.fidgetTimer);
    this.element.classList.remove("is-blinking");
  }

  private scheduleBlink(): void {
    this.blinkTimer = window.setTimeout(() => {
      this.blink(Math.random() < DOUBLE_BLINK_CHANCE ? 2 : 1);
      this.scheduleBlink();
    }, between(BLINK_INTERVAL_MS));
  }

  private blink(times: number): void {
    this.element.classList.add("is-blinking");
    this.blinkEndTimer = window.setTimeout(() => {
      this.element.classList.remove("is-blinking");
      if (times > 1) this.blinkEndTimer = window.setTimeout(() => this.blink(times - 1), BLINK_MS);
    }, BLINK_MS);
  }

  private scheduleFidget(delay: number): void {
    window.clearTimeout(this.fidgetTimer);
    this.fidgetTimer = window.setTimeout(() => {
      this.playOneShot(`avatar-fidget-${FIDGETS[Math.floor(Math.random() * FIDGETS.length)]}`);
      this.scheduleFidget(between(FIDGET_INTERVAL_MS));
    }, delay);
  }

  private playOneShot(className: string): void {
    this.motion.classList.remove(...ONE_SHOT_CLASSES);
    // Force a style flush so re-adding the same class restarts the animation.
    void this.motion.offsetWidth;
    this.motion.classList.add(className);
  }

  private onActivity = () => {
    if (this.idleActive) this.scheduleFidget(FIDGET_AFTER_IDLE_MS);
  };

  private onMotionEnd = (e: AnimationEvent) => {
    if (e.target === this.motion) this.motion.classList.remove(...ONE_SHOT_CLASSES);
  };

  private onVisibility = () => this.applyIdle();
}
