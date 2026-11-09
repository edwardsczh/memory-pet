import { useState } from "react";
import type { FirstRunConsentState } from "../../compliance";
import { createCharacterRepo } from "../../core/storage/characters";
import { getVault } from "../../core/storage/vault";
import { installDemoCharacter } from "./demoCharacter";
import { broadcastCharactersChanged, type ChatSessionApi } from "./useChatSession";

interface ChatDebugProps {
  chat: ChatSessionApi;
  consent: FirstRunConsentState;
  /** Drop the debug skin / emotion overrides so the chat drives the avatar again. */
  onReset(): void;
}

/** Dev-only chat controls; loaded lazily so the demo fixture never ships in release builds. */
export default function ChatDebug({ chat, consent, onReset }: ChatDebugProps) {
  const [status, setStatus] = useState("");
  const t = chat.state.lastTimings;

  const loadDemo = async () => {
    setStatus("载入中…");
    try {
      const started = performance.now();
      const r = await installDemoCharacter(createCharacterRepo(getVault()));
      setStatus(
        `已载入小鹿：${r.sessions} 段会话、${r.exemplars} 条示例，${Math.round(performance.now() - started)}ms`,
      );
      onReset();
      chat.reload();
      await broadcastCharactersChanged();
    } catch (err) {
      setStatus(`失败：${String(err)}`);
    }
  };

  return (
    <>
      <div className="debug-row">
        <button onClick={() => void loadDemo()}>载入示例角色</button>
        <button onClick={() => chat.debugAdvanceClock(2 * 60 * 60_000)}>快进 2 小时</button>
        <button onClick={() => void consent.revoke()}>重看同意说明</button>
        <button onClick={onReset}>表情跟随对话</button>
      </div>
      {(status || t) && (
        <div className="debug-row debug-note">
          {status}
          {t &&
            ` 上一轮：首字 ${t.firstDeltaMs ?? "-"}ms，首条气泡 ${t.firstBubbleMs}ms，最后一条 ${t.totalMs}ms${t.streamed ? "（流式）" : ""}`}
        </div>
      )}
    </>
  );
}
