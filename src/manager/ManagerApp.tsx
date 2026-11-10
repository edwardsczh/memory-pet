import { useCallback, useEffect, useMemo, useState } from "react";
import { AiBadge } from "../compliance/AiBadge";
import { FirstRunConsent } from "../compliance/FirstRunConsent";
import { useFirstRunConsent } from "../compliance/useFirstRunConsent";
import { getLlmSettings } from "../core/llm/tauriClient";
import type { Character } from "../core/model";
import { CHARACTERS } from "../pet/avatar/characters";
import { createCharacterRepo } from "../core/storage/characters";
import { getVault } from "../core/storage/vault";
import { DataSubjectDeclaration } from "./DataSubjectDeclaration";
import { ImportWizard } from "./ImportWizard";
import { PersonaEditor } from "./PersonaEditor";
import { StyleReport } from "./StyleReport";
import {
  consentComplete,
  createCharacterDraft,
  defaultConsent,
  exportConsentRecord,
  saveCharacterWithStyle,
  type ImportPipelineResult,
} from "./pipeline";
import "./manager.css";

type ManagerTab = "home" | "create" | "import" | "report" | "persona";

const repo = createCharacterRepo(getVault());

function downloadText(fileName: string, text: string) {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ManagerApp() {
  const consent = useFirstRunConsent();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tab, setTab] = useState<ManagerTab>("home");
  const [providerName, setProviderName] = useState("在设置中选择的服务商");

  const [draftName, setDraftName] = useState("");
  const [draftAvatar, setDraftAvatar] = useState<string>(CHARACTERS[0].id);
  const [draftConsent, setDraftConsent] = useState(defaultConsent());
  const [editing, setEditing] = useState<Character | null>(null);
  const [pendingPipeline, setPendingPipeline] = useState<ImportPipelineResult | null>(null);
  const [importReport, setImportReport] = useState<ImportPipelineResult["report"] | null>(null);
  const [shareView, setShareView] = useState(false);

  const selected = useMemo(
    () => characters.find((c) => c.id === activeId) ?? null,
    [characters, activeId],
  );

  const reload = useCallback(async () => {
    const list = await repo.list();
    setCharacters(list);
    const active = await repo.getActiveId();
    setActiveId(active ?? list[list.length - 1]?.id ?? null);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const list = await repo.list();
      const active = await repo.getActiveId();
      if (!alive) return;
      setCharacters(list);
      setActiveId(active ?? list[list.length - 1]?.id ?? null);
    })();
    void getLlmSettings()
      .then((s) => {
        if (!alive) return;
        setProviderName(s.baseUrl.replace(/^https?:\/\//, "").split("/")[0] ?? s.model);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const firstRunAdult = consent.record?.ageAdult === true;

  const startCreate = () => {
    setEditing(null);
    setDraftName("");
    setDraftAvatar(CHARACTERS[0].id);
    setDraftConsent(defaultConsent({ ageAdult: firstRunAdult }));
    setPendingPipeline(null);
    setTab("create");
  };

  const openCharacter = (c: Character) => {
    setActiveId(c.id);
    setEditing(c);
    setTab("report");
    void repo.getAsset(c.id, "importReport").then(setImportReport);
  };

  const finishCreate = async () => {
    if (!consentComplete(draftConsent, firstRunAdult)) return;
    const draft = createCharacterDraft({
      name: draftName,
      avatar: draftAvatar,
      consent: draftConsent,
    });
    await repo.save(draft);
    if (pendingPipeline) {
      const saved = await saveCharacterWithStyle(repo, draft, pendingPipeline, true);
      setEditing(saved);
      setImportReport(pendingPipeline.report);
    } else {
      setEditing(draft);
    }
    await reload();
    setActiveId(draft.id);
    setTab(pendingPipeline ? "report" : "import");
  };

  const onImportDone = (result: ImportPipelineResult) => {
    setPendingPipeline(result);
    const target = editing ?? selected;
    if (target) {
      void (async () => {
        const saved = await saveCharacterWithStyle(repo, target, result, true);
        setEditing(saved);
        setImportReport(result.report);
        await reload();
        setTab("report");
      })();
    }
  };

  const exportConsent = () => {
    const c = editing ?? selected;
    if (!c) return;
    downloadText(`consent-${c.id}.json`, exportConsentRecord(c));
  };

  return (
    <div className="mgr-app">
      <header className="mgr-header">
        <div className="mgr-title-row">
          <h1>角色管理</h1>
          <AiBadge />
        </div>
        <p className="mgr-muted">导入聊天记录、查看风格报告、编辑人格卡。数据仅保存在本机。</p>
      </header>

      {consent.status === "required" && (
        <FirstRunConsent providerName={providerName} onAccept={(v) => void consent.accept(v)} />
      )}

      <nav className="mgr-nav" aria-label="管理导航">
        <button
          type="button"
          className={tab === "home" ? "mgr-nav-active" : ""}
          onClick={() => setTab("home")}
        >
          角色列表
        </button>
        <button
          type="button"
          className={tab === "create" ? "mgr-nav-active" : ""}
          onClick={startCreate}
        >
          新建角色
        </button>
        {selected && (
          <>
            <button
              type="button"
              className={tab === "import" ? "mgr-nav-active" : ""}
              onClick={() => setTab("import")}
            >
              导入
            </button>
            <button
              type="button"
              className={tab === "report" ? "mgr-nav-active" : ""}
              onClick={() => setTab("report")}
            >
              聊天报告
            </button>
            <button
              type="button"
              className={tab === "persona" ? "mgr-nav-active" : ""}
              onClick={() => setTab("persona")}
            >
              人格卡
            </button>
          </>
        )}
      </nav>

      <main className="mgr-main">
        {tab === "home" && (
          <section className="mgr-panel">
            <h2>已有角色</h2>
            {characters.length === 0 ? (
              <p className="mgr-muted">还没有角色，点击「新建角色」开始。</p>
            ) : (
              <ul className="mgr-char-list">
                {characters.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="mgr-char-card"
                      onClick={() => openCharacter(c)}
                    >
                      <strong>{c.name}</strong>
                      <span className="mgr-muted">{c.consent.relation || "未填写关系"}</span>
                      {activeId === c.id && <span className="mgr-tag">桌宠使用中</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === "create" && (
          <>
            <DataSubjectDeclaration
              value={draftConsent}
              firstRunAdult={firstRunAdult}
              onChange={setDraftConsent}
            />
            <section className="mgr-panel">
              <h2>角色信息</h2>
              <div className="mgr-form-grid">
                <label>
                  桌宠显示名
                  <input
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    placeholder="如：小鹿"
                  />
                </label>
                <label>
                  形象
                  <select value={draftAvatar} onChange={(e) => setDraftAvatar(e.target.value)}>
                    {CHARACTERS.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="mgr-row-actions">
                <button
                  type="button"
                  className="mgr-btn mgr-btn-primary"
                  disabled={!consentComplete(draftConsent, firstRunAdult)}
                  onClick={() => void finishCreate()}
                >
                  保存并继续
                </button>
              </div>
            </section>
            {pendingPipeline && <p className="mgr-ok">已附带导入数据，保存后将写入风格画像。</p>}
          </>
        )}

        {tab === "import" && selected && (
          <ImportWizard onComplete={onImportDone} onCancel={() => setTab("home")} />
        )}

        {tab === "report" && selected?.style && (
          <>
            <div className="mgr-row-actions">
              <button type="button" className="mgr-btn mgr-btn-ghost" onClick={exportConsent}>
                导出授权
              </button>
              <button
                type="button"
                className="mgr-btn mgr-btn-ghost"
                onClick={() => setShareView((v) => !v)}
              >
                {shareView ? "完整报告" : "分享视图（无原文）"}
              </button>
            </div>
            <StyleReport style={selected.style} report={importReport} shareMode={shareView} />
          </>
        )}

        {tab === "report" && selected && !selected.style && (
          <p className="mgr-muted">尚未导入聊天记录，请先到「导入」页完成向导。</p>
        )}

        {tab === "persona" && selected && (
          <PersonaEditor
            character={selected}
            repo={repo}
            onSaved={(c) => {
              setEditing(c);
              void reload();
            }}
          />
        )}
      </main>
    </div>
  );
}
