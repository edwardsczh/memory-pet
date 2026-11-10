import { useMemo, useState } from "react";
import type { ParsedImport, SpeakerMapping } from "../core/model";
import {
  ImportFormatError,
  decodeBytes,
  parseImport,
  SUPPORTED_FORMATS_HINT,
} from "../core/ingest";
import type { ImportPipelineResult } from "./pipeline";
import { runImportPipeline } from "./pipeline";

export type ImportWizardStep = "file" | "preview" | "mapping" | "done";

export interface ImportWizardProps {
  onComplete(result: ImportPipelineResult, fileName: string): void;
  onCancel(): void;
}

function initialMapping(parsed: ParsedImport): SpeakerMapping {
  const names = parsed.participants.map((p) => p.sender);
  const me = parsed.selfSender && names.includes(parsed.selfSender) ? [parsed.selfSender] : [];
  const ta = names.filter((n) => !me.includes(n)).slice(0, 1);
  return { me, ta };
}

export function ImportWizard({ onComplete, onCancel }: ImportWizardProps) {
  const [step, setStep] = useState<ImportWizardStep>("file");
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [mapping, setMapping] = useState<SpeakerMapping>({ me: [], ta: [] });
  const [running, setRunning] = useState(false);

  const previewText = useMemo(() => {
    if (!parsed) return "";
    const sample = parsed.messages.slice(0, 8);
    return sample
      .map((m) => `${new Date(m.ts).toLocaleString()} ${m.sender}: ${m.text.slice(0, 80)}`)
      .join("\n");
  }, [parsed]);

  const pickFile = async (file: File) => {
    setError(null);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const p = parseImport(file.name, decodeBytes(buf), { conversation: conversationId });
      setFileName(file.name);
      setBytes(buf);
      setParsed(p);
      setMapping(initialMapping(p));
      if (p.conversations?.length) setConversationId(p.conversations[0].id);
      setStep("preview");
    } catch (e) {
      setError(e instanceof ImportFormatError ? e.message : "无法读取文件");
    }
  };

  const reloadConversation = (id: string) => {
    if (!bytes) return;
    try {
      const p = parseImport(fileName, decodeBytes(bytes), { conversation: id });
      setParsed(p);
      setMapping(initialMapping(p));
      setConversationId(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "切换会话失败");
    }
  };

  const toggleSender = (role: "me" | "ta", sender: string) => {
    setMapping((m) => {
      const list = m[role];
      const has = list.includes(sender);
      return {
        ...m,
        [role]: has ? list.filter((x) => x !== sender) : [...list, sender],
      };
    });
  };

  const run = async () => {
    if (!bytes || !mapping.me.length || !mapping.ta.length) {
      setError("请分别选择至少一个“我”和“TA”的说话人");
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const result = runImportPipeline({ fileName, bytes, mapping, conversationId });
      onComplete(result, fileName);
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "导入失败");
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="mgr-panel mgr-import">
      <header className="mgr-panel-head">
        <h2>导入聊天记录</h2>
        <p className="mgr-muted">{SUPPORTED_FORMATS_HINT}</p>
      </header>

      {error && <p className="mgr-error">{error}</p>}

      {step === "file" && (
        <label className="mgr-file-drop">
          <input
            type="file"
            accept=".json,.txt,.csv,.md,.mht,.log"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void pickFile(f);
            }}
          />
          <span>点击选择导出文件，或把文件拖到这里</span>
        </label>
      )}

      {step === "preview" && parsed && (
        <>
          {parsed.conversations && parsed.conversations.length > 1 && (
            <label>
              选择会话
              <select value={conversationId} onChange={(e) => reloadConversation(e.target.value)}>
                {parsed.conversations.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}（{c.count} 条）
                  </option>
                ))}
              </select>
            </label>
          )}
          <dl className="mgr-dl">
            <div>
              <dt>格式</dt>
              <dd>{parsed.format}</dd>
            </div>
            <div>
              <dt>标题</dt>
              <dd>{parsed.title ?? "（无）"}</dd>
            </div>
            <div>
              <dt>消息数</dt>
              <dd>{parsed.messages.length}</dd>
            </div>
            <div>
              <dt>群聊</dt>
              <dd>{parsed.isGroup ? "是" : "否"}</dd>
            </div>
          </dl>
          {parsed.warnings.length > 0 && (
            <ul className="mgr-warn-list">
              {parsed.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <pre className="mgr-preview">{previewText}</pre>
          <div className="mgr-row-actions">
            <button type="button" className="mgr-btn mgr-btn-ghost" onClick={() => setStep("file")}>
              重选文件
            </button>
            <button
              type="button"
              className="mgr-btn mgr-btn-primary"
              onClick={() => setStep("mapping")}
            >
              下一步：确认说话人
            </button>
          </div>
        </>
      )}

      {step === "mapping" && parsed && (
        <>
          <p className="mgr-muted">点选哪些名字是你自己发的，哪些是 TA。</p>
          <div className="mgr-speaker-grid">
            {parsed.participants.map((p) => {
              const isMe = mapping.me.includes(p.sender);
              const isTa = mapping.ta.includes(p.sender);
              return (
                <SpeakerCard
                  key={p.sender}
                  sender={p.sender}
                  count={p.count}
                  isMe={isMe}
                  isTa={isTa}
                  onMe={() => toggleSender("me", p.sender)}
                  onTa={() => toggleSender("ta", p.sender)}
                />
              );
            })}
          </div>
          <div className="mgr-row-actions">
            <button
              type="button"
              className="mgr-btn mgr-btn-ghost"
              onClick={() => setStep("preview")}
            >
              上一步
            </button>
            <button
              type="button"
              className="mgr-btn mgr-btn-primary"
              disabled={running}
              onClick={() => void run()}
            >
              {running ? "处理中…" : "开始导入"}
            </button>
          </div>
        </>
      )}

      {step === "done" && <p className="mgr-ok">导入完成，可以继续查看聊天报告或生成人格卡。</p>}

      <div className="mgr-row-actions mgr-footer-actions">
        <button type="button" className="mgr-btn mgr-btn-ghost" onClick={onCancel}>
          关闭向导
        </button>
      </div>
    </section>
  );
}

function SpeakerCard(props: {
  sender: string;
  count: number;
  isMe: boolean;
  isTa: boolean;
  onMe(): void;
  onTa(): void;
}) {
  const { sender, count, isMe, isTa, onMe, onTa } = props;
  return (
    <div className="mgr-speaker-card">
      <strong>{sender}</strong>
      <span className="mgr-muted">{count} 条</span>
      <div className="mgr-speaker-btns">
        <button
          type="button"
          className={`mgr-btn mgr-btn-small ${isMe ? "mgr-btn-primary" : "mgr-btn-ghost"}`}
          onClick={onMe}
        >
          我
        </button>
        <button
          type="button"
          className={`mgr-btn mgr-btn-small ${isTa ? "mgr-btn-primary" : "mgr-btn-ghost"}`}
          onClick={onTa}
        >
          TA
        </button>
      </div>
    </div>
  );
}
