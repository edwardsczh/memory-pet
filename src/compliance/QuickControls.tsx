import { exitApp, hideWindow } from "./windowActions";
import "./compliance.css";

export interface QuickControlsProps {
  /** Do-not-disturb: pauses proactive messages. */
  muted: boolean;
  onToggleMute(next: boolean): void;
  /** Defaults to hiding the window (Tauri) — the tray brings it back. */
  onHide?: () => void;
  /** Defaults to closing the app; no confirmation, no retention. */
  onExit?: () => void;
}

export function QuickControls({
  muted,
  onToggleMute,
  onHide = () => void hideWindow(),
  onExit = () => void exitApp(),
}: QuickControlsProps) {
  return (
    <div className="mp-quick" role="toolbar" aria-label="桌宠快捷控制">
      <button
        type="button"
        className={`mp-quick-btn ${muted ? "on" : ""}`}
        onClick={() => onToggleMute(!muted)}
        aria-pressed={muted}
        title={muted ? "取消静音，恢复主动消息" : "静音：暂停主动消息"}
        data-hit
      >
        <span aria-hidden>{muted ? "🔕" : "🔔"}</span>
        {muted ? "已静音" : "静音"}
      </button>
      <button type="button" className="mp-quick-btn" onClick={onHide} title="隐藏桌宠" data-hit>
        <span aria-hidden>👁️</span>
        隐藏
      </button>
      <button
        type="button"
        className="mp-quick-btn mp-quick-exit"
        onClick={onExit}
        title="退出记忆桌宠"
        data-hit
      >
        <span aria-hidden>⏻</span>
        退出
      </button>
    </div>
  );
}
