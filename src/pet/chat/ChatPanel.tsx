import { useEffect, useRef, useState } from "react";
import type { DialogueTurn } from "../../core/model";
import { AiBadge } from "../../compliance";
import { TypingDots } from "./ChatBubbles";
import { MAX_LOG_TURNS } from "./pacing";

interface ChatPanelProps {
  name: string;
  log: DialogueTurn[];
  pending: { user: string; shown: string[] } | null;
  typing: boolean;
  onClear(): void;
  onClose(): void;
}

function timeLabel(ts: number): string {
  const d = new Date(ts);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return d.toDateString() === new Date().toDateString()
    ? hm
    : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

/** Semi-transparent history panel inside the pet window. */
export function ChatPanel({ name, log, pending, typing, onClear, onClose }: ChatPanelProps) {
  const [confirming, setConfirming] = useState(false);
  const listRef = useRef<HTMLOListElement | null>(null);
  const rows: { role: DialogueTurn["role"]; text: string; ts?: number }[] = [
    ...log,
    ...(pending
      ? [
          { role: "user" as const, text: pending.user },
          ...pending.shown.map((text) => ({ role: "pet" as const, text })),
        ]
      : []),
  ];

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows.length, typing]);

  return (
    <section className="chat-panel" data-hit aria-label="聊天记录">
      <header className="chat-panel-head">
        <strong>和{name}的聊天</strong>
        <AiBadge />
        <span className="chat-panel-spacer" />
        {confirming ? (
          <>
            <button
              type="button"
              className="chat-link is-danger"
              onClick={() => {
                setConfirming(false);
                onClear();
              }}
            >
              确认清空
            </button>
            <button type="button" className="chat-link" onClick={() => setConfirming(false)}>
              取消
            </button>
          </>
        ) : (
          <button
            type="button"
            className="chat-link"
            onClick={() => setConfirming(true)}
            disabled={log.length === 0}
          >
            清空
          </button>
        )}
        <button type="button" className="mp-icon-btn" onClick={onClose} aria-label="收起">
          ×
        </button>
      </header>
      <ol className="chat-log" ref={listRef}>
        {rows.length === 0 && (
          <li className="chat-log-empty">还没有聊天记录，点一下角色说句话吧</li>
        )}
        {rows.map((r, i) => (
          <li key={i} className={`chat-row is-${r.role}`}>
            <span className="chat-row-text">{r.text}</span>
            {r.ts !== undefined && (i === 0 || r.ts - (rows[i - 1].ts ?? 0) > 5 * 60_000) && (
              <time className="chat-row-time">{timeLabel(r.ts)}</time>
            )}
          </li>
        ))}
        {typing && (
          <li className="chat-row is-pet">
            <span className="chat-row-text">
              <TypingDots />
            </span>
          </li>
        )}
      </ol>
      <footer className="chat-panel-foot">只保存在本机，最多保留最近 {MAX_LOG_TURNS} 条</footer>
    </section>
  );
}
