import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isHit } from "../hitTest";

interface CursorPayload {
  x: number;
  y: number;
}

/**
 * True while the cursor is over a capturing part (opaque pixel or `data-hit` UI) inside
 * `selector`, and for `leaveMs` after. In Tauri the webview gets no pointer events while the
 * window is click-through, so this follows the Rust cursor poller instead of DOM hover.
 */
export function useHover(selector: string, leaveMs = 1200): boolean {
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    let timer: number | undefined;
    let last = false;
    const update = (over: boolean) => {
      if (over === last) return;
      last = over;
      window.clearTimeout(timer);
      if (over) setHovered(true);
      else timer = window.setTimeout(() => setHovered(false), leaveMs);
    };
    const check = (x: number, y: number) =>
      update(isHit(x, y) && !!document.elementFromPoint(x, y)?.closest(selector));

    if (!isTauri()) {
      const onMove = (e: PointerEvent) => check(e.clientX, e.clientY);
      const onLeave = () => update(false);
      window.addEventListener("pointermove", onMove);
      document.documentElement.addEventListener("pointerleave", onLeave);
      return () => {
        window.clearTimeout(timer);
        window.removeEventListener("pointermove", onMove);
        document.documentElement.removeEventListener("pointerleave", onLeave);
      };
    }
    const off = listen<CursorPayload>("pet://cursor", ({ payload }) => check(payload.x, payload.y));
    const offLeft = listen("pet://cursor-left", () => update(false));
    return () => {
      window.clearTimeout(timer);
      void off.then((fn) => fn());
      void offLeft.then((fn) => fn());
    };
  }, [selector, leaveMs]);

  return hovered;
}
