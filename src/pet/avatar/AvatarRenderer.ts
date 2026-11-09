import type { Emotion } from "../../core/model";
import type { AlphaMask } from "../alphaMask";
import type { AvatarManifest } from "./manifest";

/**
 * Draws one character and owns its idle behaviour (breathing, blinking,
 * fidgeting). Implementations: `SpriteAvatarRenderer` (layered sprites);
 * Live2D / Spine renderers can implement the same contract later.
 *
 * Setters may be called before `load` resolves; the latest values are applied
 * once the character is ready.
 */
export interface AvatarRenderer {
  /** Root element; the caller mounts it and handles pointer events on it. */
  readonly element: HTMLElement;
  /**
   * Element marked `data-hit="alpha"` and registered with the hit test. Its
   * alpha mask follows the displayed layers.
   */
  readonly hitElement: HTMLElement;

  load(manifestHref: string): Promise<AvatarManifest>;
  setEmotion(emotion: Emotion): void;
  setTalking(talking: boolean): void;
  /** Breathing, blinking and fidgets. Off freezes the character on its current frame. */
  setIdleAnimation(enabled: boolean): void;
  /** Mask of the currently displayed expression, or null before load. */
  getAlphaMask(): AlphaMask | null;
  dispose(): void;
}
