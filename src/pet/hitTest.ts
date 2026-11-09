import type { AlphaMask } from "./alphaMask";

/**
 * Decides whether a point (CSS px, window-relative) should capture the mouse.
 *
 * - Elements marked `data-hit="alpha"` are hit only where their registered
 *   alpha mask is opaque (the avatar).
 * - Any other element marked `data-hit` is hit by its whole box (bubbles, buttons).
 * - Everything else is click-through.
 */
const alphaTargets = new WeakMap<Element, AlphaMask>();

export function registerAlphaTarget(el: Element, mask: AlphaMask | null): void {
  if (mask) alphaTargets.set(el, mask);
  else alphaTargets.delete(el);
}

export function isHit(x: number, y: number): boolean {
  const el = document.elementFromPoint(x, y)?.closest("[data-hit]");
  if (!el) return false;
  if (el.getAttribute("data-hit") !== "alpha") return true;

  const mask = alphaTargets.get(el);
  if (!mask) return false;
  // The bounding box includes CSS transforms (breathing, bounces), so scaling
  // into mask space keeps the mask aligned with what is on screen.
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  return mask.isOpaque(
    ((x - rect.left) * mask.width) / rect.width,
    ((y - rect.top) * mask.height) / rect.height,
  );
}
