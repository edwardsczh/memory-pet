import { useState, type ReactNode } from "react";
import type { Emotion } from "../core/model";
import { CHARACTERS } from "./avatar/characters";
import { EMOTIONS } from "./avatar/manifest";

const EMOTION_LABELS: Record<Emotion, string> = {
  neutral: "平静",
  happy: "开心",
  sad: "难过",
  angry: "生气",
  surprised: "惊讶",
  shy: "害羞",
  thinking: "思考",
};

interface DebugPanelProps {
  characterId: string;
  emotion: Emotion;
  talking: boolean;
  onCharacter: (id: string) => void;
  onEmotion: (emotion: Emotion) => void;
  onTalking: (talking: boolean) => void;
  /** Extra dev controls rendered below the built-in rows. */
  children?: ReactNode;
}

/** Dev-only controls for switching character / expression / talking. */
export function DebugPanel(props: DebugPanelProps) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button className="debug-toggle" data-hit onClick={() => setOpen(true)}>
        调试
      </button>
    );
  }

  return (
    <div className="debug-panel" data-hit>
      <div className="debug-row">
        {CHARACTERS.map((c) => (
          <button
            key={c.id}
            className={c.id === props.characterId ? "on" : ""}
            onClick={() => props.onCharacter(c.id)}
          >
            {c.name}
          </button>
        ))}
        <button
          className={props.talking ? "on" : ""}
          onClick={() => props.onTalking(!props.talking)}
        >
          说话
        </button>
        <button onClick={() => setOpen(false)}>收起</button>
      </div>
      <div className="debug-row">
        {EMOTIONS.map((e) => (
          <button
            key={e}
            className={e === props.emotion ? "on" : ""}
            onClick={() => props.onEmotion(e)}
          >
            {EMOTION_LABELS[e]}
          </button>
        ))}
      </div>
      {props.children}
    </div>
  );
}
