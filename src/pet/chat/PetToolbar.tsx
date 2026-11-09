import { QuickControls } from "../../compliance";

interface PetToolbarProps {
  visible: boolean;
  muted: boolean;
  onToggleMute(next: boolean): void;
  onHide(): void;
  /** Omitted when there is no character (nothing to show). */
  onOpenLog?: () => void;
}

/** Appears while hovering the character: chat log + mute / hide / exit. */
export function PetToolbar({ visible, muted, onToggleMute, onHide, onOpenLog }: PetToolbarProps) {
  return (
    <div className={`pet-tools ${visible ? "is-visible" : ""}`} aria-hidden={!visible}>
      {onOpenLog && (
        <button type="button" className="mp-quick-btn pet-tools-log" onClick={onOpenLog} data-hit>
          <span aria-hidden>💬</span>
          记录
        </button>
      )}
      <QuickControls muted={muted} onToggleMute={onToggleMute} onHide={onHide} />
    </div>
  );
}
