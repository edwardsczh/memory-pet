import { useEffect, useRef, useState } from "react";

/** Collapse after the input has lost focus for this long. */
const BLUR_CLOSE_MS = 8000;
const MAX_CHARS = 500;

interface ChatInputProps {
  busy: boolean;
  placeholder?: string;
  onSend(text: string): void;
  onClose(): void;
  onOpenLog(): void;
}

export function ChatInput({ busy, placeholder, onSend, onClose, onOpenLog }: ChatInputProps) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLInputElement | null>(null);
  const blurTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    ref.current?.focus();
    return () => window.clearTimeout(blurTimer.current);
  }, []);

  const send = () => {
    if (busy || !text.trim()) return;
    onSend(text);
    setText("");
  };

  return (
    <form
      className="chat-input"
      data-hit
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
      onFocus={() => window.clearTimeout(blurTimer.current)}
      onBlur={() => {
        window.clearTimeout(blurTimer.current);
        blurTimer.current = window.setTimeout(onClose, BLUR_CLOSE_MS);
      }}
    >
      <button
        type="button"
        className="chat-icon-btn"
        onClick={onOpenLog}
        title="聊天记录"
        aria-label="聊天记录"
      >
        ☰
      </button>
      <input
        ref={ref}
        value={text}
        maxLength={MAX_CHARS}
        placeholder={busy ? "等 TA 说完…" : (placeholder ?? "想说点什么？")}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        aria-label="输入消息"
      />
      <button
        type="submit"
        className="chat-send"
        disabled={busy || !text.trim()}
        aria-label="发送"
        title="发送（Enter）"
      >
        ↑
      </button>
    </form>
  );
}
