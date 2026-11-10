import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

const DRAG_THRESHOLD_PX = 4;

/**
 * Tells a click on the character from a drag: dragging the window only starts after the
 * pointer moved a few pixels with the button held. `pressed` pins click-through capture.
 */
export function usePetPointer(handlers: { onClick(): void; onDrag?(): void }) {
  const [pressed, setPressed] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const latest = useRef(handlers);

  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    if (!pressed) return;
    const onMove = (e: PointerEvent) => {
      const s = start.current;
      if (!s || Math.hypot(e.clientX - s.x, e.clientY - s.y) < DRAG_THRESHOLD_PX) return;
      start.current = null;
      setPressed(false);
      latest.current.onDrag?.();
      if (isTauri()) void getCurrentWindow().startDragging();
    };
    const onUp = () => {
      if (start.current) latest.current.onClick();
      start.current = null;
      setPressed(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [pressed]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    start.current = { x: e.clientX, y: e.clientY };
    setPressed(true);
  };

  return { pressed, onPointerDown };
}
