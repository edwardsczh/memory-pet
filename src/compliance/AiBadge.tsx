import "./compliance.css";

export const AI_NOTICE = "你正在与 AI 互动，内容由 AI 生成";

export interface AiBadgeProps {
  /** Where the tooltip opens relative to the badge. */
  tooltipPlacement?: "top" | "bottom";
  className?: string;
}

/** Always-visible "AI" mark required for AI-generated content. */
export function AiBadge({ tooltipPlacement = "bottom", className = "" }: AiBadgeProps) {
  return (
    <span
      className={`mp-ai-badge mp-tip-${tooltipPlacement} ${className}`}
      data-hit
      role="note"
      aria-label={AI_NOTICE}
      tabIndex={0}
    >
      AI
      <span className="mp-ai-tooltip" aria-hidden>
        {AI_NOTICE}
      </span>
    </span>
  );
}
