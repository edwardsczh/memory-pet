import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Emotion } from "./core/model";
import { Avatar } from "./pet/avatar/Avatar";
import { DEFAULT_CHARACTER_ID } from "./pet/avatar/characters";
import { EMOTIONS } from "./pet/avatar/manifest";
import { DebugPanel } from "./pet/DebugPanel";
import { useClickThrough } from "./pet/useClickThrough";
import "./App.css";

const DRAG_THRESHOLD_PX = 4;
const GREETINGS = [
  "嗨～我在这儿呢",
  "今天过得怎么样呀",
  "拖我可以换个位置哦",
  "我还在学说话，等等我～",
];
const TALK_MS_PER_CHAR = 120;

function talkDuration(text: string): number {
  return Math.min(3000, Math.max(800, text.length * TALK_MS_PER_CHAR));
}

function randomOtherEmotion(current: Emotion): Emotion {
  const others = EMOTIONS.filter((e) => e !== current);
  return others[Math.floor(Math.random() * others.length)];
}

export default function App() {
  const [pressed, setPressed] = useState(false);
  const [bubble, setBubble] = useState<string | null>(GREETINGS[0]);
  const [characterId, setCharacterId] = useState<string>(DEFAULT_CHARACTER_ID);
  const [emotion, setEmotion] = useState<Emotion>("happy");
  const [speaking, setSpeaking] = useState(true);
  const [debugTalking, setDebugTalking] = useState(false);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const greetingIndex = useRef(0);
  const hit = useClickThrough(pressed);

  useEffect(() => {
    if (!bubble) return;
    const timer = window.setTimeout(() => setBubble(null), 4000);
    return () => window.clearTimeout(timer);
  }, [bubble]);

  useEffect(() => {
    if (!speaking || !bubble) return;
    const timer = window.setTimeout(() => setSpeaking(false), talkDuration(bubble));
    return () => window.clearTimeout(timer);
  }, [speaking, bubble]);

  // Distinguish click (new expression + bubble) from drag (move window): dragging only
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
        setSpeaking(true);
        setEmotion(randomOtherEmotion);
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

  const onAvatarPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
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
      <Avatar
        characterId={characterId}
        emotion={emotion}
        talking={(speaking && bubble !== null) || debugTalking}
        onPointerDown={onAvatarPointerDown}
      />
      {import.meta.env.DEV && (
        <>
          <DebugPanel
            characterId={characterId}
            emotion={emotion}
            talking={debugTalking}
            onCharacter={setCharacterId}
            onEmotion={setEmotion}
            onTalking={setDebugTalking}
          />
          <div className={`debug-chip ${hit ? "on" : ""}`}>{hit ? "捕获鼠标" : "点击穿透"}</div>
        </>
      )}
    </main>
  );
}
