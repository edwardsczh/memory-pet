import { useCallback, useEffect, useState } from "react";
import type { Character, Exemplar } from "../core/model";
import { buildBlindTurn, gradeBlindPick, type BlindTurnQuestion } from "../eval/blindTurn";
import type { CharacterRepo } from "../core/storage/characters";

type Phase = "idle" | "question" | "result";

interface Props {
  repo: CharacterRepo;
  active: Character;
}

export function BlindEvalSection({ repo, active }: Props) {
  const [holdout, setHoldout] = useState<Exemplar[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [question, setQuestion] = useState<BlindTurnQuestion | null>(null);
  const [lastCorrect, setLastCorrect] = useState<boolean | null>(null);
  const [rounds, setRounds] = useState({ played: 0, correct: 0 });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const data = await repo.getAsset(active.id, "holdout");
      if (cancelled) return;
      setHoldout(data && data.length > 0 ? data : null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [active.id, repo]);

  const startRound = useCallback(() => {
    if (!holdout?.length || !active) return;
    const q = buildBlindTurn(holdout, active.style);
    if (!q) return;
    setQuestion(q);
    setLastCorrect(null);
    setPhase("question");
  }, [holdout, active]);

  const pick = useCallback(
    (side: "left" | "right") => {
      if (!question) return;
      const ok = gradeBlindPick(question, side);
      setLastCorrect(ok);
      setRounds((r) => ({ played: r.played + 1, correct: r.correct + (ok ? 1 : 0) }));
      setPhase("result");
    },
    [question],
  );

  if (loading) return null;
  if (!holdout || holdout.length === 0) return null;

  return (
    <section className="manager-panel blind-panel">
      <h2>像不像盲测</h2>
      <p className="hint">
        从留出集里随机一题：哪条是 TA 在聊天记录里的原话？（当前角色「{active.name}」，
        {holdout.length} 题）
      </p>
      {rounds.played > 0 ? (
        <p className="blind-stats">
          本轮统计：{rounds.correct}/{rounds.played} 猜对
        </p>
      ) : null}

      {phase === "idle" || phase === "result" ? (
        <div className="manager-actions">
          <button type="button" onClick={startRound}>
            {phase === "result" ? "下一题" : "开始一题"}
          </button>
        </div>
      ) : null}

      {phase === "result" && lastCorrect !== null ? (
        <p className={lastCorrect ? "blind-ok" : "blind-miss"}>
          {lastCorrect ? "猜对了，这条是 TA 的原回复。" : "猜错了，另一条才是 TA 的原话。"}
        </p>
      ) : null}

      {phase === "question" && question ? (
        <div className="blind-question">
          <div className="blind-context">
            <span className="blind-label">你说</span>
            <p>{question.context}</p>
            {question.prior?.length ? (
              <ul className="blind-prior">
                {question.prior.map((t, i) => (
                  <li key={i}>
                    <span>{t.role === "me" ? "你" : "TA"}</span> {t.text}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <p className="blind-prompt">哪条更像 TA 会回的？</p>
          <div className="blind-choices">
            <button type="button" className="blind-choice" onClick={() => pick("left")}>
              {question.leftText.split("\n").map((line, i) => (
                <span key={i}>
                  {line}
                  {i < question.leftText.split("\n").length - 1 ? <br /> : null}
                </span>
              ))}
            </button>
            <button type="button" className="blind-choice" onClick={() => pick("right")}>
              {question.rightText.split("\n").map((line, i) => (
                <span key={i}>
                  {line}
                  {i < question.rightText.split("\n").length - 1 ? <br /> : null}
                </span>
              ))}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
