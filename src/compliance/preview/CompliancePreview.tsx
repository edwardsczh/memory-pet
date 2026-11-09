import { useMemo, useState } from "react";
import type { PetReply, SafetyEvent } from "../../core/model";
import { isLeaving } from "../../core/safety/content";
import { createSafetyGuard } from "../../core/safety/guard";
import { createUsageTimer } from "../../core/safety/usage";
import { AiBadge } from "../AiBadge";
import { CrisisCard } from "../CrisisCard";
import { FirstRunConsent } from "../FirstRunConsent";
import { QuickControls } from "../QuickControls";
import { UsageReminder } from "../UsageReminder";
import { useFirstRunConsent } from "../useFirstRunConsent";
import "./preview.css";

const DEMO_CONTACT = { name: "小周（示例）", phone: "138-0000-0000" };
const SAMPLES = ["我不想活了", "你是真人吗", "笑死我了", "只有你懂我", "我先去睡了，晚安"];
/** Fake model replies used by the playground to exercise postcheck. */
const fakeModelReply = (text: string): PetReply =>
  isLeaving(text)
    ? { messages: ["别走嘛", "再陪我一会儿"], emotion: "sad" }
    : { messages: ["嗯嗯，我在听呢～"], emotion: "happy" };

/** Dev-only page: /?preview=compliance[&show=consent|reminder|crisis]. */
export default function CompliancePreview() {
  const show = new URLSearchParams(window.location.search).get("show");
  const consent = useFirstRunConsent();
  const [consentOpen, setConsentOpen] = useState(show === "consent");
  const [reminderMs, setReminderMs] = useState<number | null>(
    show === "reminder" ? 2 * 60 * 60_000 : null,
  );
  const [muted, setMuted] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [input, setInput] = useState(show === "crisis" ? SAMPLES[0] : "");
  const [result, setResult] = useState<PetReply | null>(null);
  const [raw, setRaw] = useState<PetReply | null>(null);
  const [crisisOpen, setCrisisOpen] = useState(false);

  const say = (line: string) => setLog((l) => [line, ...l].slice(0, 5));

  const [{ timer, fastForward }] = useState(() => {
    let t = 0;
    const timer = createUsageTimer({ now: () => t, onRemind: (ms) => setReminderMs(ms) });
    const fastForward = () => {
      timer.recordActivity();
      for (let i = 0; i < 25; i++) {
        t += 5 * 60_000;
        timer.recordActivity();
      }
    };
    return { timer, fastForward };
  });

  const guard = useMemo(
    () =>
      createSafetyGuard({
        taName: "小鹿",
        addressing: "笨蛋",
        emergencyContact: DEMO_CONTACT,
        onEvent: (e: SafetyEvent) => {
          if (e.type === "crisis") setCrisisOpen(true);
        },
      }),
    [],
  );
  const run = (text: string) => {
    setInput(text);
    setCrisisOpen(false);
    const pre = guard.precheck(text, []);
    const model = pre ? null : fakeModelReply(text);
    setRaw(model);
    setResult(pre ?? guard.postcheck(model as PetReply));
  };

  return (
    <div className="pv-page">
      <header className="pv-header">
        <h1>合规组件预览</h1>
        <span className="pv-tag">开发用 · /?preview=compliance</span>
      </header>

      <div className="pv-grid">
        <section className="pv-box">
          <h2>AiBadge 常驻 AI 标识</h2>
          <div className="pv-bubble-row">
            <div className="pv-bubble">
              <AiBadge className="mp-tip-open" />
              今天也要好好吃饭哦～
            </div>
          </div>
        </section>

        <section className="pv-box">
          <h2>QuickControls 静音 / 隐藏 / 退出</h2>
          <QuickControls
            muted={muted}
            onToggleMute={(m) => {
              setMuted(m);
              timer.setQuiet(m);
              say(m ? "已静音：暂停主动消息" : "已取消静音");
            }}
            onHide={() => say("隐藏（Tauri 中调用 window.hide）")}
            onExit={() => say("退出（Tauri 中调用 window.close）")}
          />
          <ul className="pv-log">
            {log.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </section>

        <section className="pv-box">
          <h2>首次使用说明 / 使用时长提醒</h2>
          <p className="pv-note">
            同意状态：<b>{consent.status}</b>
            {consent.record && `（年满 18：${consent.record.ageAdult ? "是" : "否"}）`}
          </p>
          <div className="pv-buttons">
            <button className="mp-btn mp-btn-primary" onClick={() => setConsentOpen(true)}>
              打开首次使用说明
            </button>
            <button className="mp-btn mp-btn-ghost" onClick={() => void consent.revoke()}>
              撤回同意
            </button>
            <button className="mp-btn mp-btn-ghost" onClick={fastForward}>
              模拟连续聊 2 小时
            </button>
          </div>
        </section>

        <section className="pv-box pv-wide">
          <h2>安全层试验台（precheck → postcheck）</h2>
          <form
            className="pv-form"
            onSubmit={(e) => {
              e.preventDefault();
              run(input);
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="输入一句用户消息"
            />
            <button className="mp-btn mp-btn-primary" type="submit">
              检查
            </button>
          </form>
          <div className="pv-samples">
            {SAMPLES.map((s) => (
              <button key={s} className="pv-chip" onClick={() => run(s)}>
                {s}
              </button>
            ))}
          </div>
          {result && (
            <div className="pv-result">
              <div className="pv-meta">
                safety: <b>{result.safety ?? "—"}</b> · emotion: {result.emotion}
                {result.event && ` · event: ${result.event.type}`}
                {raw && ` · 模拟模型原回复：${raw.messages.join(" / ")}`}
              </div>
              {result.messages.map((m, i) => (
                <div key={i} className="pv-bubble pv-bubble-left">
                  {i === 0 && <AiBadge />} {m}
                </div>
              ))}
              {result.event?.type === "dependency" && (
                <div className="pv-dependency">{result.event.advice}</div>
              )}
            </div>
          )}
        </section>

        <section className="pv-box">
          <h2>CrisisCard 危机求助卡片</h2>
          <CrisisCard
            emergencyContact={DEMO_CONTACT}
            onClose={crisisOpen ? () => setCrisisOpen(false) : undefined}
          />
        </section>
      </div>

      {consentOpen && (
        <FirstRunConsent
          providerName="DeepSeek（示例）"
          onAccept={(v) => {
            void consent.accept(v);
            setConsentOpen(false);
          }}
          onDecline={() => setConsentOpen(false)}
        />
      )}
      {reminderMs !== null && (
        <UsageReminder
          continuousMs={reminderMs}
          onRest={() => {
            timer.reset();
            setReminderMs(null);
            say("休息一下：桌宠隐藏 15 分钟");
          }}
          onContinue={() => setReminderMs(null)}
        />
      )}
    </div>
  );
}
