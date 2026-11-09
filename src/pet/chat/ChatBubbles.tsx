import { AiBadge } from "../../compliance";
import type { Bubble } from "./ChatSession";

interface ChatBubblesProps {
  bubbles: Bubble[];
  typing: boolean;
  onAction(b: Bubble): void;
  onDismiss(id: number): void;
}

export function TypingDots() {
  return (
    <span className="chat-dots" aria-label="正在输入">
      <i />
      <i />
      <i />
    </span>
  );
}

/** Newest bubble at the bottom, its tail pointing at the character. */
export function ChatBubbles({ bubbles, typing, onAction, onDismiss }: ChatBubblesProps) {
  return (
    <div className="chat-bubbles" aria-live="polite">
      {bubbles.map((b) => (
        <div
          key={b.id}
          className={`chat-bubble is-${b.kind} ${b.leaving ? "is-leaving" : ""}`}
          data-hit
          onClick={b.action ? () => onAction(b) : () => onDismiss(b.id)}
        >
          {b.kind === "pet" && <AiBadge tooltipPlacement="bottom" className="chat-badge" />}
          <span className="chat-text">{b.text}</span>
          {b.action && (
            <button type="button" className="chat-action" data-hit>
              {b.action.label}
            </button>
          )}
        </div>
      ))}
      {typing && (
        <div className="chat-bubble is-pet is-typing" data-hit>
          <AiBadge tooltipPlacement="bottom" className="chat-badge" />
          <span className="chat-text">
            正在输入
            <TypingDots />
          </span>
        </div>
      )}
    </div>
  );
}
