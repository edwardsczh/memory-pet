import "./compliance.css";

export interface UsageReminderProps {
  /** Continuous use when the reminder fired. */
  continuousMs: number;
  /** "好的，休息一下" — the host hides the pet for `restMinutes`. */
  onRest(): void;
  onContinue(): void;
  restMinutes?: number;
}

function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} 分钟`;
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分钟`;
}

/** 2-hour continuous-use reminder. Wording must stay free of retention / upsell. */
export function UsageReminder({
  continuousMs,
  onRest,
  onContinue,
  restMinutes = 15,
}: UsageReminderProps) {
  return (
    <div className="mp-overlay" role="alertdialog" aria-labelledby="mp-usage-title">
      <div className="mp-card mp-reminder" data-hit>
        <div className="mp-reminder-icon" aria-hidden>
          ☕
        </div>
        <h3 id="mp-usage-title">该休息一下啦</h3>
        <p>你已经连续聊了 {formatDuration(continuousMs)}，起来走走、喝口水吧。</p>
        <p className="mp-muted mp-small">选择休息后，桌宠会先隐藏 {restMinutes} 分钟。</p>
        <footer className="mp-actions mp-actions-center">
          <button type="button" className="mp-btn mp-btn-ghost" onClick={onContinue} data-hit>
            继续
          </button>
          <button type="button" className="mp-btn mp-btn-primary" onClick={onRest} data-hit>
            好的，休息一下
          </button>
        </footer>
      </div>
    </div>
  );
}
