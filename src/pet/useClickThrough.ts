import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isHit } from "./hitTest";

interface CursorPayload {
  x: number;
  y: number;
}

/**
 * Bridges the Rust cursor poller to the DOM hit test and reports the result back,
 * so the window only captures the mouse over the avatar and interactive UI.
 *
 * While `pinned` is true (a mouse button is held on the avatar) the window keeps
 * capturing the mouse even if the cursor drifts over transparent pixels, otherwise
 * the mouseup would be delivered to the app underneath.
 */
export function useClickThrough(pinned: boolean): boolean {
  const [hit, setHit] = useState(false);
  const reported = useRef<boolean | null>(null);
  const pinnedRef = useRef(pinned);

  useEffect(() => {
    pinnedRef.current = pinned;
  }, [pinned]);

  useEffect(() => {
    if (!isTauri()) return;

    const report = (next: boolean) => {
      setHit(next);
      if (reported.current === next) return;
      reported.current = next;
      void invoke("set_cursor_hit", { hit: next });
    };

    const unlisten = listen<CursorPayload>("pet://cursor", ({ payload }) => {
      report(pinnedRef.current || isHit(payload.x, payload.y));
    });
    // The Rust side switches to click-through by itself when the cursor leaves
    // the window, so forget what we last reported to resync on re-entry.
    const unlistenLeave = listen("pet://cursor-left", () => {
      reported.current = null;
      setHit(false);
    });

    return () => {
      void unlisten.then((fn) => fn());
      void unlistenLeave.then((fn) => fn());
    };
  }, []);

  return hit;
}
