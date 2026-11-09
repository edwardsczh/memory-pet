import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import type { LlmSettings } from "../core/model";
import { CUSTOM_PRESET_ID, LLM_PRESETS, matchPreset, presetById } from "../core/llm/presets";
import {
  clearLlmKey,
  createTauriLlmClient,
  getLlmSettings,
  saveLlmSettings,
  setLlmKey,
  testLlm,
  type LlmTestResult,
} from "../core/llm/tauriClient";
import { getVault } from "../core/storage/vault";
import "./settings.css";

interface SettingsApi {
  getSettings(): Promise<LlmSettings>;
  saveSettings(baseUrl: string, model: string): Promise<void>;
  setKey(key: string): Promise<void>;
  clearKey(): Promise<void>;
  test(): Promise<LlmTestResult>;
  keyProtected(): Promise<boolean>;
}

const tauriApi: SettingsApi = {
  getSettings: getLlmSettings,
  saveSettings: saveLlmSettings,
  setKey: setLlmKey,
  clearKey: clearLlmKey,
  test: testLlm,
  keyProtected: async () => (await getVault().status()).protected,
};

/** Browser preview (`npm run dev`, `?view=settings`): nothing leaves the page. */
function createPreviewApi(): SettingsApi {
  const preset = LLM_PRESETS[0];
  let settings: LlmSettings = { baseUrl: preset.baseUrl, model: preset.model, hasKey: false };
  return {
    getSettings: async () => settings,
    saveSettings: async (baseUrl, model) => void (settings = { ...settings, baseUrl, model }),
    setKey: async () => void (settings = { ...settings, hasKey: true }),
    clearKey: async () => void (settings = { ...settings, hasKey: false }),
    test: async () => ({
      ok: false,
      latencyMs: 0,
      error: "浏览器预览模式无法测试连接，请在桌面应用中使用",
    }),
    keyProtected: async () => false,
  };
}

const api = isTauri() ? tauriApi : createPreviewApi();
const llmClient = createTauriLlmClient();

type Notice = { kind: "ok" | "error"; text: string } | null;

function errorText(err: unknown): string {
  return typeof err === "string" ? err : err instanceof Error ? err.message : "操作失败";
}

export default function SettingsApp() {
  const [saved, setSaved] = useState<LlmSettings | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [presetId, setPresetId] = useState(CUSTOM_PRESET_ID);
  const [keyProtected, setKeyProtected] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<"save" | "test" | "clear" | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [testResult, setTestResult] = useState<LlmTestResult | null>(null);

  const applySaved = (s: LlmSettings) => {
    setSaved(s);
    setBaseUrl(s.baseUrl);
    setModel(s.model);
    setPresetId(matchPreset(s.baseUrl)?.id ?? CUSTOM_PRESET_ID);
  };

  useEffect(() => {
    api.getSettings().then(applySaved, (err) => setNotice({ kind: "error", text: errorText(err) }));
    api.keyProtected().then(setKeyProtected, () => setKeyProtected(null));
  }, []);

  const preset = presetById(presetId);
  const needsKey = preset?.needsKey ?? true;
  const modelOptions = preset?.models ?? [];
  const dirty =
    !!saved &&
    (saved.baseUrl !== baseUrl.trim() || saved.model !== model.trim() || keyInput.trim() !== "");

  const onPresetChange = (id: string) => {
    setPresetId(id);
    const next = presetById(id);
    if (next) {
      setBaseUrl(next.baseUrl);
      setModel(next.model);
    }
    setTestResult(null);
  };

  const onBaseUrlChange = (value: string) => {
    setBaseUrl(value);
    setPresetId(matchPreset(value)?.id ?? CUSTOM_PRESET_ID);
  };

  const save = async () => {
    await api.saveSettings(baseUrl, model);
    if (keyInput.trim()) {
      await api.setKey(keyInput);
      setKeyInput("");
    }
    applySaved(await api.getSettings());
  };

  const run = async (kind: "save" | "test" | "clear", action: () => Promise<void>) => {
    setBusy(kind);
    setNotice(null);
    try {
      await action();
    } catch (err) {
      setNotice({ kind: "error", text: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  const onSave = () =>
    run("save", async () => {
      await save();
      setNotice({ kind: "ok", text: "设置已保存" });
    });

  const onTest = () =>
    run("test", async () => {
      setTestResult(null);
      if (dirty) await save();
      setTestResult(await api.test());
    });

  const onClearKey = () =>
    run("clear", async () => {
      await api.clearKey();
      applySaved(await api.getSettings());
      setTestResult(null);
      setNotice({ kind: "ok", text: "API Key 已清除" });
    });

  return (
    <div className="settings">
      <header className="settings-header">
        <h1>设置</h1>
        <p>选择为桌宠提供对话能力的模型服务</p>
      </header>

      {keyProtected === false && (
        <div className="banner warn" role="alert">
          <strong>密钥未受系统保护</strong>
          <span>
            系统凭据库不可用，本地数据的主密钥保存在仅当前用户可读的文件中。Linux 上可启用 GNOME
            Keyring 或 KWallet 后重启应用。
          </span>
        </div>
      )}

      <section className="card">
        <h2>模型服务</h2>

        <label className="field">
          <span>服务商</span>
          <select value={presetId} onChange={(e) => onPresetChange(e.target.value)}>
            {LLM_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            <option value={CUSTOM_PRESET_ID}>自定义（OpenAI 兼容）</option>
          </select>
        </label>

        <label className="field">
          <span>Base URL</span>
          <input
            value={baseUrl}
            onChange={(e) => onBaseUrlChange(e.target.value)}
            placeholder="https://api.example.com/v1"
            spellCheck={false}
          />
        </label>

        <label className="field">
          <span>模型</span>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            list="model-options"
            placeholder="例如 deepseek-chat"
            spellCheck={false}
          />
          <datalist id="model-options">
            {modelOptions.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>

        <div className="field">
          <span>API Key</span>
          {saved?.hasKey ? (
            <div className="key-saved">
              <span className="pill ok">已保存</span>
              <span className="muted">密钥已加密保存在本机，不会再显示</span>
              <button className="btn ghost" onClick={onClearKey} disabled={busy !== null}>
                清除
              </button>
            </div>
          ) : (
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder={needsKey ? "sk-…" : "本地模型无需填写，可留空"}
              autoComplete="off"
              spellCheck={false}
            />
          )}
        </div>

        <div className="actions">
          <button className="btn" onClick={onTest} disabled={busy !== null || !saved}>
            {busy === "test" ? "测试中…" : "测试连接"}
          </button>
          <button className="btn primary" onClick={onSave} disabled={busy !== null || !dirty}>
            {busy === "save" ? "保存中…" : "保存"}
          </button>
        </div>

        {notice && <p className={`notice ${notice.kind}`}>{notice.text}</p>}
        {testResult && <TestResultView result={testResult} />}
      </section>

      {import.meta.env.DEV && isTauri() && <DebugChat />}

      <section className="card subtle">
        <h2>隐私与安全</h2>
        <p>
          <strong>隐私说明：</strong>
          聊天时只把当前请求所需的少量上下文发送给你选择的模型服务商。导入的聊天记录、人格卡等数据只加密保存在本机。
        </p>
        {keyProtected && <p className="muted">本地数据的主密钥已保存在系统凭据库中。</p>}
      </section>
    </div>
  );
}

function TestResultView({ result }: { result: LlmTestResult }) {
  if (!result.ok) {
    return (
      <div className="result error">
        <strong>连接失败</strong>
        <span>{result.error}</span>
      </div>
    );
  }
  return (
    <div className="result ok">
      <strong>
        连接成功 <span className="latency">{result.latencyMs} ms</span>
      </strong>
      {result.sample && (
        <span>
          <span className="ai-tag">AI</span>
          {result.sample}
        </span>
      )}
    </div>
  );
}

/** Dev-only end-to-end check of `llm_complete` / `llm_stream` against the saved settings. */
function DebugChat() {
  const [prompt, setPrompt] = useState("用一句话介绍你自己");
  const [output, setOutput] = useState("");
  const [failed, setFailed] = useState(false);
  const [mode, setMode] = useState<string | null>(null);

  const go = async (kind: "complete" | "stream" | "json") => {
    setMode(kind);
    setOutput("");
    setFailed(false);
    const req = {
      messages: [{ role: "user" as const, content: prompt }],
      json: kind === "json",
    };
    try {
      if (kind === "stream") {
        await llmClient.stream!(req, (delta) => setOutput((prev) => prev + delta));
      } else {
        setOutput(await llmClient.complete(req));
      }
    } catch (err) {
      setFailed(true);
      setOutput(`出错：${errorText(err)}`);
    } finally {
      setMode(null);
    }
  };

  return (
    <section className="card dev">
      <h2>
        调试：试聊 <span className="pill">仅开发模式</span>
      </h2>
      <input value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      <div className="actions left">
        {(["complete", "stream", "json"] as const).map((k) => (
          <button key={k} className="btn" disabled={mode !== null} onClick={() => go(k)}>
            {{ complete: "非流式", stream: "流式", json: "JSON 模式" }[k]}
          </button>
        ))}
      </div>
      {output && (
        <pre className={`dev-output ${failed ? "error" : ""}`}>
          {!failed && <span className="ai-tag">AI</span>}
          {output}
        </pre>
      )}
    </section>
  );
}
