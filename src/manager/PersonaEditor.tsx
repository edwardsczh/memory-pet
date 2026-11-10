import { useState } from "react";
import type { Character, EvidenceRef, PersonaCard, PersonaTrait } from "../core/model";
import { estimatePersonaCost } from "../core/persona";
import type { CharacterRepo } from "../core/storage/characters";
import { createTauriLlmClient } from "../core/llm/tauriClient";
import { generateAndSavePersona } from "./pipeline";

export interface PersonaEditorProps {
  character: Character;
  repo: CharacterRepo;
  onSaved(character: Character): void;
}

export function PersonaEditor({ character, repo, onSaved }: PersonaEditorProps) {
  const card = character.persona;
  const [draft, setDraft] = useState<PersonaCard | null>(card ?? null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [evidence, setEvidence] = useState<EvidenceRef | null>(null);

  const sessionsReady = Boolean(character.style?.messageCount);

  const refreshCost = async () => {
    const sessions = await repo.getAsset(character.id, "sessions");
    if (!sessions?.length) return null;
    return estimatePersonaCost(sessions);
  };

  const [costHint, setCostHint] = useState<string | null>(null);

  const loadCost = () => {
    void refreshCost().then((c) => {
      if (!c) return;
      setCostHint(
        `约 ${c.batches} 批，输入约 ${c.approxTokens.toLocaleString()} token，输出约 ${c.approxOutputTokens.toLocaleString()} token（仅供参考）`,
      );
    });
  };

  const generate = async () => {
    setGenerating(true);
    setError(null);
    setProgress("准备中…");
    try {
      const llm = createTauriLlmClient();
      const persona = await generateAndSavePersona(repo, character, llm, (p) => {
        setProgress(`${p.stage === "merge" ? "合并" : "提取"} ${p.done}/${p.total}`);
      });
      setDraft(persona);
      const next = await repo.get(character.id);
      if (next) onSaved(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
    } finally {
      setGenerating(false);
      setProgress(null);
    }
  };

  const saveEdits = async () => {
    if (!draft) return;
    const next: Character = {
      ...character,
      persona: { ...draft, updatedAt: Date.now() },
    };
    await repo.save(next);
    onSaved(next);
  };

  const updateTrait = (index: number, text: string) => {
    if (!draft) return;
    const traits = draft.traits.map((t, i) => (i === index ? { ...t, text } : t));
    setDraft({ ...draft, traits });
  };

  const removeTrait = (index: number) => {
    if (!draft) return;
    setDraft({ ...draft, traits: draft.traits.filter((_, i) => i !== index) });
  };

  const addTrait = () => {
    if (!draft) return;
    const trait: PersonaTrait = { text: "", evidence: [] };
    setDraft({ ...draft, traits: [...draft.traits, trait] });
  };

  if (!draft) {
    return (
      <section className="mgr-panel">
        <header className="mgr-panel-head">
          <h2>人格卡</h2>
          <p className="mgr-muted">用大模型阅读聊天记录，提炼带证据引用的性格描述。</p>
        </header>
        {!sessionsReady && <p className="mgr-error">请先完成聊天记录导入。</p>}
        <div className="mgr-row-actions">
          <button
            type="button"
            className="mgr-btn mgr-btn-ghost"
            onClick={loadCost}
            disabled={!sessionsReady}
          >
            预估费用
          </button>
          <button
            type="button"
            className="mgr-btn mgr-btn-primary"
            disabled={!sessionsReady || generating}
            onClick={() => void generate()}
          >
            {generating ? (progress ?? "生成中…") : "生成人格卡"}
          </button>
        </div>
        {costHint && <p className="mgr-muted">{costHint}</p>}
        {error && <p className="mgr-error">{error}</p>}
      </section>
    );
  }

  return (
    <section className="mgr-panel mgr-persona">
      <header className="mgr-panel-head">
        <h2>人格卡</h2>
        <p className="mgr-muted">每条结论可查看证据摘录（不含整段原文导出）。</p>
      </header>

      <div className="mgr-form-grid">
        <label>
          名字
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <label>
          关系
          <input
            value={draft.relation}
            onChange={(e) => setDraft({ ...draft, relation: e.target.value })}
          />
        </label>
      </div>
      <label>
        摘要
        <textarea
          rows={3}
          value={draft.summary}
          onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
        />
      </label>
      <label>
        备注
        <textarea
          rows={2}
          value={draft.userNotes}
          onChange={(e) => setDraft({ ...draft, userNotes: e.target.value })}
        />
      </label>

      <h3>性格特点</h3>
      <ul className="mgr-trait-list">
        {draft.traits.map((t, i) => (
          <li key={i}>
            <input value={t.text} onChange={(e) => updateTrait(i, e.target.value)} />
            {t.evidence.length > 0 && (
              <button
                type="button"
                className="mgr-btn mgr-btn-ghost mgr-btn-small"
                onClick={() => setEvidence(t.evidence[0])}
              >
                证据
              </button>
            )}
            <button
              type="button"
              className="mgr-btn mgr-btn-ghost mgr-btn-small"
              onClick={() => removeTrait(i)}
            >
              删除
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="mgr-btn mgr-btn-ghost" onClick={addTrait}>
        添加特点
      </button>

      {evidence && (
        <div className="mgr-evidence-pop" role="dialog">
          <p>{new Date(evidence.ts).toLocaleString()}</p>
          <p>{evidence.excerpt}</p>
          <button
            type="button"
            className="mgr-btn mgr-btn-primary"
            onClick={() => setEvidence(null)}
          >
            关闭
          </button>
        </div>
      )}

      <div className="mgr-row-actions">
        <button
          type="button"
          className="mgr-btn mgr-btn-ghost"
          onClick={() => void generate()}
          disabled={generating}
        >
          重新生成
        </button>
        <button type="button" className="mgr-btn mgr-btn-primary" onClick={() => void saveEdits()}>
          保存编辑
        </button>
      </div>
      {error && <p className="mgr-error">{error}</p>}
    </section>
  );
}
