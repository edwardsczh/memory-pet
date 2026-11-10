import type { CleanReport, StyleProfile } from "../core/model";

export interface StyleReportProps {
  style: StyleProfile;
  report?: CleanReport | null;
  title?: string;
  /** When set, renders a shareable card without raw chat text. */
  shareMode?: boolean;
}

function hourLabel(i: number): string {
  return `${i.toString().padStart(2, "0")}:00`;
}

function pct(r: number): string {
  return `${Math.round(r * 100)}%`;
}

export function StyleReport({
  style,
  report,
  title = "你们的聊天报告",
  shareMode,
}: StyleReportProps) {
  const peakHour = style.activeHours.reduce(
    (best, v, i) => (v > style.activeHours[best] ? i : best),
    0,
  );
  const spanDays =
    style.lastTs > style.firstTs
      ? Math.max(1, Math.round((style.lastTs - style.firstTs) / 86_400_000))
      : 0;

  return (
    <section
      className={`mgr-panel mgr-report ${shareMode ? "mgr-report-share" : ""}`}
      id="style-report"
    >
      <header className="mgr-panel-head">
        <h2>{title}</h2>
        <p className="mgr-muted">统计来自 TA 的文本消息，不含原文，可放心截图分享。</p>
      </header>

      <div className="mgr-stat-grid">
        <Stat label="TA 消息数" value={String(style.messageCount)} />
        <Stat label="平均字数" value={String(Math.round(style.avgLength))} />
        <Stat label="连发条数" value={style.avgBurst.toFixed(1)} />
        <Stat label="句号使用率" value={pct(style.periodRate)} />
        <Stat label="表情使用率" value={pct(style.emojiRate)} />
        <Stat label="聊天天数跨度" value={spanDays ? `约 ${spanDays} 天` : "—"} />
        <Stat label="最活跃时段" value={hourLabel(peakHour)} />
      </div>

      {style.catchphrases.length > 0 && (
        <div className="mgr-chip-block">
          <h3>口头禅</h3>
          <div className="mgr-chips">
            {style.catchphrases.slice(0, 12).map((c) => (
              <span key={c.phrase} className="mgr-chip">
                {c.phrase} ×{c.count}
              </span>
            ))}
          </div>
        </div>
      )}

      {style.topEmojis.length > 0 && (
        <div className="mgr-chip-block">
          <h3>常用表情</h3>
          <div className="mgr-chips mgr-emoji">
            {style.topEmojis.map((e) => (
              <span key={e}>{e}</span>
            ))}
          </div>
        </div>
      )}

      {style.nicknamesForMe.length > 0 && (
        <p>
          <strong>TA 对你的称呼：</strong>
          {style.nicknamesForMe.join("、")}
        </p>
      )}

      <div className="mgr-hour-chart" aria-label="24 小时活跃分布">
        {style.activeHours.map((v, i) => (
          <div
            key={i}
            className="mgr-hour-bar"
            title={`${hourLabel(i)} ${pct(v)}`}
            style={{ height: `${Math.max(4, Math.round(v * 100))}%` }}
          />
        ))}
      </div>

      {report && !shareMode && (
        <details className="mgr-clean-report">
          <summary>清洗报告</summary>
          <dl className="mgr-dl">
            <div>
              <dt>原始条数</dt>
              <dd>{report.total}</dd>
            </div>
            <div>
              <dt>保留</dt>
              <dd>{report.kept}</dd>
            </div>
            <div>
              <dt>会话数</dt>
              <dd>{report.sessions}</dd>
            </div>
          </dl>
        </details>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="mgr-stat">
      <span className="mgr-stat-label">{label}</span>
      <span className="mgr-stat-value">{value}</span>
    </div>
  );
}
