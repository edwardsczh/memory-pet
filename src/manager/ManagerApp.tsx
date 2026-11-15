import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  Character,
  ConsentRecord,
  ParsedImport,
  PersonaCard,
  SpeakerMapping,
  SubjectStatus,
} from "../core/model";
import { parseImportBytes } from "../core/ingest";
import {
  buildCharacterRecord,
  buildPromptCharacter,
  type BuiltCharacterAssets,
} from "./buildCharacter";
import { createTauriLlmClient } from "../core/llm/tauriClient";
import { CHARACTERS } from "../pet/avatar/characters";
import { createCharacterRepo, type CharacterRepo } from "../core/storage/characters";
import { getVault } from "../core/storage/vault";
import {
  buildConsentExport,
  consentExportFilename,
  serializeConsentExport,
} from "../core/export/consentExport";
import { notifyCharactersChanged } from "./notify";
import { acceptScreenshotDrop, isImageFile, isScreenshotFile } from "./screenshotDrop";
import { prepareScreenshotFile } from "./screenshotPrepare";
import {
  DISCARD_NOTE,
  WHO_LABEL,
  deleteReviewLine,
  deleteReviewPicture,
  discardReview,
  mappingForScreenshot,
  nextPictureId,
  readingPicture,
  reviewToImport,
  settlePicture,
  unreadablePicture,
  type ReviewPicture,
} from "./screenshotReview";
import { BlindEvalSection } from "./BlindEvalSection";
import "./manager.css";

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

type Step = "home" | "consent" | "import" | "report" | "persona";

const repo: CharacterRepo = createCharacterRepo(getVault());

function emptyConsent(): ConsentRecord {
  return {
    subject: "living",
    subjectName: "",
    relation: "",
    subjectConsented: false,
    personalUseOnly: true,
    voiceConsent: false,
    declaredAt: Date.now(),
    ageAdult: false,
  };
}

function formatTs(ts: number) {
  return new Date(ts).toLocaleDateString("zh-CN");
}

export default function ManagerApp() {
  const [chars, setChars] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("home");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [consent, setConsent] = useState<ConsentRecord>(emptyConsent);
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [fileName, setFileName] = useState("");
  const [mapping, setMapping] = useState<SpeakerMapping>({ me: [], ta: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [persona, setPersona] = useState<PersonaCard | null>(null);
  const [useLlm, setUseLlm] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [pictures, setPictures] = useState<ReviewPicture[]>([]);
  const [discardNote, setDiscardNote] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const [list, active] = await Promise.all([repo.list(), repo.getActiveId()]);
    setChars(list);
    setActiveId(active);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [list, active] = await Promise.all([repo.list(), repo.getActiveId()]);
      if (cancelled) return;
      setChars(list);
      setActiveId(active);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const resetWizard = () => {
    setDraftId(null);
    setConsent(emptyConsent());
    setParsed(null);
    setFileName("");
    setMapping({ me: [], ta: [] });
    setPersona(null);
    setError(null);
    setUseLlm(false);
    setPrompt("");
    setPictures([]);
    setDiscardNote(null);
    setStep("consent");
  };

  const onScreenshots = (list: FileList | File[]) => {
    const files = [...list];
    const drop = acceptScreenshotDrop(files.map((file) => ({ name: file.name, type: file.type })));
    if (drop.ignored.length > 0) {
      setError(`截图区只接收 png、jpg、webp：${drop.ignored.join("、")}`);
    } else {
      setError(null);
    }
    setDiscardNote(null);
    const accepted = files.filter((file) => isScreenshotFile({ name: file.name, type: file.type }));
    if (accepted.length === 0) return;
    const pending = accepted.map((file) => ({ file, id: nextPictureId() }));
    setPictures((prev) => [
      ...prev,
      ...pending.map(({ file, id }) => readingPicture(id, file.name)),
    ]);
    void (async () => {
      const { recognizeScreenshot } = await import("./screenshotOcr");
      for (const { file, id } of pending) {
        try {
          const prepared = await prepareScreenshotFile(file);
          const lines = await recognizeScreenshot(prepared.bytes, prepared.width);
          setPictures((prev) =>
            prev.map((picture) => (picture.id === id ? settlePicture(picture, lines) : picture)),
          );
        } catch {
          setPictures((prev) =>
            prev.map((picture) => (picture.id === id ? unreadablePicture(picture) : picture)),
          );
        }
      }
    })();
  };

  const screenshotsReading = pictures.some((picture) => picture.status === "reading");
  const screenshotLineCount = pictures.reduce((count, picture) => count + picture.lines.length, 0);

  const discardScreenshots = () => {
    setPictures(discardReview().pictures);
    setDiscardNote(DISCARD_NOTE);
  };

  const confirmScreenshots = async () => {
    const imported = reviewToImport(pictures);
    if (!imported) {
      setError("没有可保存的句子。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { character, assets } = await buildCharacterRecord(
        consent,
        imported,
        mappingForScreenshot(imported),
        { avatar: consent.subject === "self" ? "kai" : "momo" },
      );
      await saveBuilt(character, assets);
      setPictures([]);
      setDiscardNote(null);
      setStep("report");
    } catch (e) {
      setError(e instanceof Error ? e.message : "构建角色失败");
    } finally {
      setBusy(false);
    }
  };

  const activeChar = useMemo(
    () => (activeId ? (chars.find((c) => c.id === activeId) ?? null) : null),
    [activeId, chars],
  );

  const canConsent = useMemo(() => {
    if (!consent.subjectName.trim() || !consent.relation.trim()) return false;
    if (!consent.ageAdult) return false;
    if (!consent.personalUseOnly) return false;
    if (consent.subject === "living" && !consent.subjectConsented) return false;
    if (consent.subject === "deceased" && !consent.subjectConsented) return false;
    return true;
  }, [consent]);

  const onFile = async (file: File) => {
    if (isImageFile(file)) {
      onScreenshots([file]);
      return;
    }
    setError(null);
    try {
      const p = parseImportBytes(file.name, new Uint8Array(await file.arrayBuffer()));
      setParsed(p);
      setFileName(file.name);
      const me = p.selfSender ? [p.selfSender] : [];
      const ta =
        p.participants
          .map((x) => x.sender)
          .filter((s) => !me.includes(s))
          .slice(0, 1) ?? [];
      setMapping({ me, ta });
      setStep("import");
    } catch (e) {
      setError(e instanceof Error ? e.message : "无法解析文件");
    }
  };

  const saveBuilt = async (character: Character, assets: BuiltCharacterAssets) => {
    await repo.save(character);
    await repo.putAsset(character.id, "sessions", assets.sessions);
    await repo.putAsset(character.id, "index", assets.index.toJSON());
    await repo.putAsset(character.id, "holdout", assets.holdout.holdout);
    await repo.putAsset(character.id, "importReport", assets.report);
    await repo.setActiveId(character.id);
    setDraftId(character.id);
    setPersona(character.persona ?? null);
    await notifyCharactersChanged();
    void reload();
  };

  const runPrompt = async () => {
    if (!prompt.trim()) {
      setError("请先写一段提示");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { character, assets } = buildPromptCharacter(consent, prompt, {
        avatar: consent.subject === "self" ? "kai" : "momo",
      });
      await saveBuilt(character, assets);
      setStep("persona");
    } catch (e) {
      setError(e instanceof Error ? e.message : "构建角色失败");
    } finally {
      setBusy(false);
    }
  };

  const runBuild = async () => {
    if (!parsed || mapping.me.length === 0 || mapping.ta.length === 0) {
      setError("请选择“我”和 TA 对应的昵称");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const llm = useLlm ? createTauriLlmClient() : undefined;
      const { character, assets } = await buildCharacterRecord(consent, parsed, mapping, {
        useLlmPersona: useLlm,
        llm,
        avatar: consent.subject === "self" ? "kai" : "momo",
      });
      await saveBuilt(character, assets);
      setStep("report");
    } catch (e) {
      setError(e instanceof Error ? e.message : "构建角色失败");
    } finally {
      setBusy(false);
    }
  };

  const savePersona = async () => {
    if (!draftId || !persona) return;
    const c = await repo.get(draftId);
    if (!c) return;
    const next = { ...c, persona: { ...persona, updatedAt: Date.now() } };
    await repo.save(next);
    await notifyCharactersChanged();
    setStep("home");
    void reload();
  };

  const activate = async (id: string) => {
    await repo.setActiveId(id);
    await notifyCharactersChanged();
    void reload();
  };

  const removeChar = async (id: string) => {
    if (!window.confirm("确定删除该角色及全部本地聊天数据？")) return;
    await repo.remove(id);
    await notifyCharactersChanged();
    void reload();
  };

  const exportConsent = async (id: string) => {
    const c = await repo.get(id);
    if (!c) {
      setError("找不到该角色");
      return;
    }
    const doc = buildConsentExport(c);
    downloadTextFile(consentExportFilename(c, doc.exportedAt), serializeConsentExport(doc));
  };

  const loadDemo = async () => {
    setBusy(true);
    try {
      const { installDemoCharacter } = await import("../pet/chat/demoCharacter");
      await installDemoCharacter(repo);
      await notifyCharactersChanged();
      void reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="manager">
      <header className="manager-header">
        <h1>记忆桌宠 · 角色管理</h1>
        <p className="manager-sub">写一段提示就能创建角色，也可以再导入聊天导出文件</p>
      </header>

      {error ? <p className="manager-error">{error}</p> : null}

      {step === "home" ? (
        <>
          {activeChar ? (
            <BlindEvalSection key={activeChar.id} repo={repo} active={activeChar} />
          ) : null}
          <section className="manager-panel">
            <div className="manager-actions">
              <button type="button" onClick={resetWizard}>
                新建角色
              </button>
              {import.meta.env.DEV ? (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => void loadDemo()}
                  disabled={busy}
                >
                  载入演示角色（小鹿）
                </button>
              ) : null}
            </div>
            {loading ? (
              <p>加载中…</p>
            ) : chars.length === 0 ? (
              <p className="manager-empty">还没有角色。点「新建角色」，写一段提示就能开始。</p>
            ) : (
              <ul className="char-list">
                {chars.map((c) => (
                  <li key={c.id} className={c.id === activeId ? "is-active" : ""}>
                    <div>
                      <strong>{c.name}</strong>
                      <span className="meta">
                        {c.consent.relation} · {formatTs(c.createdAt)}
                        {c.id === activeId ? " · 当前使用" : ""}
                      </span>
                    </div>
                    <div className="char-actions">
                      {c.id !== activeId ? (
                        <button type="button" onClick={() => void activate(c.id)}>
                          使用
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => void exportConsent(c.id)}
                      >
                        导出授权记录
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={async () => {
                          const p = await repo.get(c.id);
                          if (!p?.persona) return;
                          setDraftId(c.id);
                          setPersona(p.persona);
                          setStep("persona");
                        }}
                      >
                        编辑人格卡
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => void removeChar(c.id)}
                      >
                        删除
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}

      {step === "consent" ? (
        <section className="manager-panel">
          <h2>数据主体声明</h2>
          <label>
            角色类型
            <select
              value={consent.subject}
              onChange={(e) =>
                setConsent({
                  ...consent,
                  subject: e.target.value as SubjectStatus,
                })
              }
            >
              <option value="self">我自己（数字分身）</option>
              <option value="living">在世的人</option>
              <option value="deceased">已故亲人（个人纪念）</option>
            </select>
          </label>
          <label>
            TA 的称呼
            <input
              value={consent.subjectName}
              onChange={(e) => setConsent({ ...consent, subjectName: e.target.value })}
              placeholder="如：小鹿"
            />
          </label>
          <label>
            与你的关系
            <input
              value={consent.relation}
              onChange={(e) => setConsent({ ...consent, relation: e.target.value })}
              placeholder="如：女朋友"
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={consent.ageAdult}
              onChange={(e) => setConsent({ ...consent, ageAdult: e.target.checked })}
            />
            我已年满 18 周岁
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={consent.personalUseOnly}
              onChange={(e) => setConsent({ ...consent, personalUseOnly: e.target.checked })}
            />
            仅用于个人使用，不对外传播或商用
          </label>
          {consent.subject === "living" ? (
            <label className="check">
              <input
                type="checkbox"
                checked={consent.subjectConsented}
                onChange={(e) => setConsent({ ...consent, subjectConsented: e.target.checked })}
              />
              TA 已知情并同意我使用聊天记录创建 AI 角色（文字）
            </label>
          ) : null}
          {consent.subject === "deceased" ? (
            <label className="check">
              <input
                type="checkbox"
                checked={consent.subjectConsented}
                onChange={(e) => setConsent({ ...consent, subjectConsented: e.target.checked })}
              />
              我是 TA 的近亲属，仅为个人纪念用途创建角色
            </label>
          ) : null}
          <div className="manager-actions">
            <button type="button" className="secondary" onClick={() => setStep("home")}>
              返回
            </button>
            <button type="button" disabled={!canConsent} onClick={() => setStep("import")}>
              下一步：写提示
            </button>
          </div>
        </section>
      ) : null}

      {step === "import" ? (
        <section className="manager-panel">
          <h2>写一段提示</h2>
          <p className="hint">不用先选文件。写下这个宠物怎么说话，就可以创建。</p>
          <label>
            提示
            <textarea
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="例如：说话很短，喜欢用「嘛」，会叫我宝"
            />
          </label>
          <label
            className="drop-zone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer.files.length > 0) onScreenshots(e.dataTransfer.files);
            }}
          >
            把微信聊天截图拖到这里，或点此选择图片
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
              multiple
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) onScreenshots(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          <p className="hint">
            文字在这台电脑上读取，不会上传。保存前可以看每句是谁说的，也可以删掉。
          </p>
          {discardNote ? (
            <p className="screenshot-note" role="status">
              {discardNote}
            </p>
          ) : null}
          {pictures.length > 0 ? (
            <div className="screenshot-review">
              {pictures.map((picture) => (
                <section key={picture.id} className="screenshot-shot">
                  <header>
                    <strong>{picture.name}</strong>
                    <button
                      type="button"
                      onClick={() =>
                        setPictures((prev) => deleteReviewPicture(prev, picture.id).pictures)
                      }
                    >
                      删除这张图片
                    </button>
                  </header>
                  {picture.status === "reading" ? (
                    <p className="hint">正在读取这张图片里的文字…</p>
                  ) : null}
                  {picture.notice ? (
                    <p className="screenshot-note" role="status">
                      {picture.notice}
                    </p>
                  ) : null}
                  {picture.lines.length > 0 ? (
                    <ul className="screenshot-lines">
                      {picture.lines.map((line) => (
                        <li key={line.id}>
                          <span className="who">{WHO_LABEL[line.who]}</span>
                          <span className="text">{line.text}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setPictures(
                                (prev) => deleteReviewLine(prev, picture.id, line.id).pictures,
                              )
                            }
                          >
                            删除这句
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </section>
              ))}
              <div className="manager-actions">
                <button type="button" className="secondary" onClick={discardScreenshots}>
                  全部删除，不保存
                </button>
                <button
                  type="button"
                  disabled={screenshotsReading || screenshotLineCount === 0 || busy}
                  onClick={() => void confirmScreenshots()}
                >
                  {screenshotsReading ? "正在读取…" : "确认这些句子"}
                </button>
              </div>
            </div>
          ) : null}
          <h3>或者导入导出文件</h3>
          <p className="hint">
            支持微信/QQ 导出 JSON、TXT 等，详见 docs/import-guide.md。不读取微信数据库。
          </p>
          <label className="file">
            <input
              type="file"
              accept=".json,.txt,.csv,.md,.mht,image/*"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
            />
            {fileName || "选择文件…"}
          </label>
          {parsed ? (
            <>
              <p>
                已识别 {parsed.messages.length} 条消息，{parsed.participants.length} 位发送者
                {parsed.isGroup ? "（群聊）" : ""}
              </p>
              <div className="mapping">
                <fieldset>
                  <legend>我是</legend>
                  {parsed.participants.map((p) => (
                    <label key={`me-${p.sender}`} className="check">
                      <input
                        type="checkbox"
                        checked={mapping.me.includes(p.sender)}
                        onChange={(e) => {
                          setMapping((m) => ({
                            ...m,
                            me: e.target.checked
                              ? [...m.me, p.sender]
                              : m.me.filter((x) => x !== p.sender),
                          }));
                        }}
                      />
                      {p.sender}（{p.count}）
                    </label>
                  ))}
                </fieldset>
                <fieldset>
                  <legend>TA 是</legend>
                  {parsed.participants.map((p) => (
                    <label key={`ta-${p.sender}`} className="check">
                      <input
                        type="checkbox"
                        checked={mapping.ta.includes(p.sender)}
                        onChange={(e) => {
                          setMapping((m) => ({
                            ...m,
                            ta: e.target.checked
                              ? [...m.ta, p.sender]
                              : m.ta.filter((x) => x !== p.sender),
                          }));
                        }}
                      />
                      {p.sender}（{p.count}）
                    </label>
                  ))}
                </fieldset>
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={useLlm}
                  onChange={(e) => setUseLlm(e.target.checked)}
                />
                用已配置的 LLM 生成人格卡（会消耗 API 额度）
              </label>
              <label>
                立绘
                <select
                  value={consent.subject === "self" ? "kai" : "momo"}
                  onChange={() => {}}
                  disabled
                >
                  {CHARACTERS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
          <div className="manager-actions">
            <button type="button" className="secondary" onClick={() => setStep("consent")}>
              上一步
            </button>
            <button
              type="button"
              disabled={!prompt.trim() || busy}
              onClick={() => void runPrompt()}
            >
              {busy ? "处理中…" : "用这段提示创建"}
            </button>
            <button type="button" disabled={!parsed || busy} onClick={() => void runBuild()}>
              {busy ? "处理中…" : "从文件生成"}
            </button>
          </div>
        </section>
      ) : null}

      {step === "report" && draftId ? (
        <ReportView
          charId={draftId}
          onNext={() => setStep("persona")}
          onHome={() => setStep("home")}
        />
      ) : null}

      {step === "persona" && persona ? (
        <section className="manager-panel">
          <h2>人格卡</h2>
          <label>
            摘要
            <textarea
              rows={3}
              value={persona.summary}
              onChange={(e) => setPersona({ ...persona, summary: e.target.value })}
            />
          </label>
          <label>
            对你的称呼（逗号分隔）
            <input
              value={persona.addressing.join("，")}
              onChange={(e) =>
                setPersona({
                  ...persona,
                  addressing: e.target.value
                    .split(/[,，]/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
          <label>
            备注
            <textarea
              rows={2}
              value={persona.userNotes}
              onChange={(e) => setPersona({ ...persona, userNotes: e.target.value })}
            />
          </label>
          <div className="manager-actions">
            <button type="button" className="secondary" onClick={() => setStep("home")}>
              跳过
            </button>
            <button type="button" onClick={() => void savePersona()}>
              保存并完成
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ReportView({
  charId,
  onNext,
  onHome,
}: {
  charId: string;
  onNext: () => void;
  onHome: () => void;
}) {
  const [report, setReport] = useState<Awaited<ReturnType<CharacterRepo["getAsset"]>> | null>(null);
  const [style, setStyle] = useState<Character["style"] | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await repo.getAsset(charId, "importReport");
      const c = await repo.get(charId);
      setReport(r);
      setStyle(c?.style ?? null);
    })();
  }, [charId]);

  const rep = report as import("../core/model").CleanReport | null;

  return (
    <section className="manager-panel">
      <h2>你们的聊天报告</h2>
      {rep && style ? (
        <dl className="report">
          <dt>保留消息</dt>
          <dd>
            {rep.kept} / {rep.total}（{rep.sessions} 个会话）
          </dd>
          <dt>时间跨度</dt>
          <dd>
            {formatTs(style.firstTs)} — {formatTs(style.lastTs)}
          </dd>
          <dt>TA 平均字数</dt>
          <dd>
            {style.avgLength.toFixed(1)}（连发 {style.avgBurst.toFixed(1)} 条/轮）
          </dd>
          <dt>高频词</dt>
          <dd>
            {style.catchphrases
              .slice(0, 5)
              .map((c) => c.phrase)
              .join(" · ") || "—"}
          </dd>
          <dt>称呼你</dt>
          <dd>{style.nicknamesForMe.join(" · ") || "—"}</dd>
        </dl>
      ) : (
        <p>加载报告…</p>
      )}
      <div className="manager-actions">
        <button type="button" className="secondary" onClick={onHome}>
          返回列表
        </button>
        <button type="button" onClick={onNext}>
          编辑人格卡
        </button>
      </div>
    </section>
  );
}
