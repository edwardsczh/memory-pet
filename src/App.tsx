import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { PetAvatar } from "./pet/PetAvatar";
import { useClickThrough } from "./pet/useClickThrough";
import "./App.css";

const DRAG_THRESHOLD_PX = 4;
const GREETINGS = [
  "嗨～我在这儿呢",
  "今天过得怎么样呀",
  "拖我可以换个位置哦",
  "我还在学说话，等等我～",
];

export default function App() {
  const [pressed, setPressed] = useState(false);
  const [bubble, setBubble] = useState<string | null>(GREETINGS[0]);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const greetingIndex = useRef(0);
  const hit = useClickThrough(pressed);

  useEffect(() => {
    if (!bubble) return;
    const timer = window.setTimeout(() => setBubble(null), 4000);
    return () => window.clearTimeout(timer);
  }, [bubble]);

  // Distinguish click (show bubble) from drag (move window): dragging only
  // starts after the pointer has moved a few pixels with the button held.
  useEffect(() => {
    if (!pressed) return;
    const onMove = (e: PointerEvent) => {
      const start = pressStart.current;
      if (!start) return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_THRESHOLD_PX) return;
      pressStart.current = null;
      setPressed(false);
      if (isTauri()) void getCurrentWindow().startDragging();
    };
    const onUp = () => {
      if (pressStart.current) {
        greetingIndex.current = (greetingIndex.current + 1) % GREETINGS.length;
        setBubble(GREETINGS[greetingIndex.current]);
      }
      pressStart.current = null;
      setPressed(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [pressed]);

  const onAvatarPointerDown = (e: React.PointerEvent<HTMLImageElement>) => {
    if (e.button !== 0) return;
    pressStart.current = { x: e.clientX, y: e.clientY };
    setPressed(true);
  };

  return (
    <main className="stage">
      {bubble && (
        <div className="bubble" data-hit onClick={() => setBubble(null)}>
          <span className="ai-badge" title="你正在与 AI 互动">
            AI
          </span>
          {bubble}
        </div>
      )}
      <PetAvatar src="/avatar/placeholder/idle.svg" onPointerDown={onAvatarPointerDown} />
      {import.meta.env.DEV && (
        <div className={`debug-chip ${hit ? "on" : ""}`}>{hit ? "捕获鼠标" : "点击穿透"}</div>
      )}
    </main>
  );
}
