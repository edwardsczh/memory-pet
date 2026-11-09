import { useEffect, useRef, useState } from "react";
import type { EmergencyContact } from "../core/model";
import { EMERGENCY_NUMBERS, HOTLINES } from "../core/safety/hotlines";
import "./compliance.css";

export interface CrisisCardProps {
  emergencyContact?: EmergencyContact;
  onClose?: () => void;
  /** Injectable for tests / non-secure contexts. */
  copy?: (text: string) => Promise<void>;
}

async function defaultCopy(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
}

function NumberButton({
  number,
  copied,
  onCopy,
}: {
  number: string;
  copied: boolean;
  onCopy(n: string): void;
}) {
  return (
    <button
      type="button"
      className={`mp-number ${copied ? "copied" : ""}`}
      onClick={() => onCopy(number)}
      title="点击复制号码"
      data-hit
    >
      {number}
      <span className="mp-number-hint">{copied ? "已复制" : "复制"}</span>
    </button>
  );
}

/** Help card shown alongside a `safety: "crisis"` reply. */
export function CrisisCard({ emergencyContact, onClose, copy = defaultCopy }: CrisisCardProps) {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const onCopy = (n: string) => {
    void copy(n.replace(/-/g, "")).then(
      () => {
        setCopied(n);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(null), 2000);
      },
      () => setCopied(null),
    );
  };

  return (
    <section className="mp-card mp-crisis" data-hit aria-labelledby="mp-crisis-title">
      <header className="mp-crisis-head">
        <h3 id="mp-crisis-title">你不是一个人</h3>
        {onClose && (
          <button
            type="button"
            className="mp-icon-btn"
            onClick={onClose}
            aria-label="关闭"
            data-hit
          >
            ×
          </button>
        )}
      </header>
      <p className="mp-small">
        我是 AI，能做的有限。下面这些电话 24 小时有专业的人接听，打过去说说就好。
      </p>
      <ul className="mp-hotlines">
        {HOTLINES.map((h) => (
          <li key={h.number}>
            <div className="mp-hotline-name">
              {h.name}
              {h.note && <span className="mp-muted mp-small">{h.note}</span>}
            </div>
            <div className="mp-hotline-numbers">
              <NumberButton number={h.number} copied={copied === h.number} onCopy={onCopy} />
              {h.alt && (
                <span className="mp-alt">
                  {h.alt.label}
                  <NumberButton
                    number={h.alt.number}
                    copied={copied === h.alt.number}
                    onCopy={onCopy}
                  />
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="mp-emergency">
        <span>已经受伤或有危险时，请立即拨打</span>
        {EMERGENCY_NUMBERS.map((e) => (
          <NumberButton
            key={e.number}
            number={e.number}
            copied={copied === e.number}
            onCopy={onCopy}
          />
        ))}
      </div>
      {emergencyContact?.name && (
        <div className="mp-contact">
          也可以现在就联系 <strong>{emergencyContact.name}</strong>
          {emergencyContact.phone && (
            <NumberButton
              number={emergencyContact.phone}
              copied={copied === emergencyContact.phone}
              onCopy={onCopy}
            />
          )}
        </div>
      )}
    </section>
  );
}
