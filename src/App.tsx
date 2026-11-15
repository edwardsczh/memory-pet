import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { Emotion } from "./core/model";
import {
  CrisisCard,
  FirstRunConsent,
  hideWindow,
  showWindow,
  UsageReminder,
  useFirstRunConsent,
} from "./compliance";
import { Avatar } from "./pet/avatar/Avatar";
import { CHARACTERS, DEFAULT_CHARACTER_ID } from "./pet/avatar/characters";
import { ChatBubbles } from "./pet/chat/ChatBubbles";
import { ChatInput } from "./pet/chat/ChatInput";
import { ChatPanel } from "./pet/chat/ChatPanel";
import { PetToolbar } from "./pet/chat/PetToolbar";
import { useChatSession } from "./pet/chat/useChatSession";
import { useHover } from "./pet/chat/useHover";
import { usePetPointer } from "./pet/chat/usePetPointer";
import { NO_API_KEY_EXPLANATION, apiKeyMissing } from "./pet/chat/apiKeyGate";
import { DebugPanel } from "./pet/DebugPanel";
import { useClickThrough } from "./pet/useClickThrough";
import SettingsApp from "./settings/SettingsApp";
import "./pet/chat/chat.css";
import "./settings/settings.css";
import "./App.css";

const ChatDebug = import.meta.env.DEV ? lazy(() => import("./pet/chat/ChatDebug")) : null;

const REST_MINUTES = 15;

function avatarSkin(id: string | undefined): string {
  return CHARACTERS.some((c) => c.id === id) ? (id as string) : DEFAULT_CHARACTER_ID;
}

export default function App() {
  const consent = useFirstRunConsent();
  const [showConsent, setShowConsent] = useState(false);
  const [inputOpen, setInputOpen] = useState(false);
  const [inputFocus, setInputFocus] = useState(0);
  const [keyGate, setKeyGate] = useState(false);
  const [keyHint, setKeyHint] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const [debug, setDebug] = useState<{ skin?: string; emotion?: Emotion; talking: boolean }>({
    talking: false,
  });
  const restTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(restTimer.current), []);

  const accepted = consent.status === "accepted";
  const onNeedKey = useCallback(() => setKeyGate(true), []);
  const chat = useChatSession({
    enabled: accepted,
    restMs: REST_MINUTES * 60_000,
    onRest: (ms) => {
      void hideWindow();
      window.clearTimeout(restTimer.current);
      restTimer.current = window.setTimeout(() => void showWindow(), ms);
    },
    onNeedKey,
  });
  const { state, character } = chat;

  useEffect(() => {
    if (!accepted || !character) return;
    let alive = true;
    void apiKeyMissing().then((missing) => {
      if (alive && missing) setKeyGate(true);
    });
    return () => {
      alive = false;
    };
  }, [accepted, character]);

  const recheckKey = () => {
    void apiKeyMissing().then((missing) => {
      if (missing) setKeyHint("还没有检测到已保存的 Key。请在下面填写并点「保存」。");
      else {
        setKeyHint(null);
        setKeyGate(false);
      }
    });
  };

  const pointer = usePetPointer({
    onClick: () => {
      chat.recordActivity();
      if (!accepted) setShowConsent(true);
      else if (character) {
        setInputOpen(true);
        setInputFocus((n) => n + 1);
      } else if (character === null) chat.openManager();
    },
    onDrag: chat.recordActivity,
  });
  const hit = useClickThrough(pointer.pressed);
  const hovered = useHover(".pet-zone");

  const crisis = state.safetyEvent?.type === "crisis";
  const skin = debug.skin ?? avatarSkin(character?.avatar);

  return (
    <main className="stage">
      {panelOpen && character ? (
        <ChatPanel
          name={character.name}
          log={state.log}
          pending={state.pending}
          typing={state.typing}
          onClear={() => void chat.clearLog()}
          onClose={() => setPanelOpen(false)}
        />
      ) : (
        <div className="chat-stack">
          {consent.status === "required" ? (
            <div className="chat-bubbles">
              <div className="chat-bubble is-notice" data-hit onClick={() => setShowConsent(true)}>
                <span className="chat-text">你好呀～开始聊天前，先看看使用说明吧</span>
                <button type="button" className="chat-action" data-hit>
                  查看说明
                </button>
              </div>
            </div>
          ) : (
            <ChatBubbles
              bubbles={state.bubbles}
              typing={state.typing}
              onAction={chat.onBubbleAction}
              onDismiss={chat.dismiss}
            />
          )}
        </div>
      )}

      {inputOpen && character && (
        <ChatInput
          focusSignal={inputFocus}
          busy={state.busy}
          placeholder={`和${character.name}说点什么…`}
          onSend={chat.send}
          onClose={() => setInputOpen(false)}
          onOpenLog={() => setPanelOpen((open) => !open)}
        />
      )}

      <div
        className="pet-zone"
        onContextMenu={(e) => {
          e.preventDefault();
          if (character) setPanelOpen((open) => !open);
        }}
      >
        <Avatar
          characterId={skin}
          emotion={debug.emotion ?? state.emotion}
          talking={state.talking || debug.talking}
          onPointerDown={pointer.onPointerDown}
        />
        <PetToolbar
          visible={hovered && !pointer.pressed}
          muted={muted}
          onToggleMute={(next) => {
            setMuted(next);
            chat.setQuiet(next);
          }}
          onHide={() => void hideWindow()}
          onOpenLog={character ? () => setPanelOpen((open) => !open) : undefined}
        />
      </div>

      {crisis && (
        <div className="pet-sheet" data-hit>
          <CrisisCard onClose={chat.dismissSafetyEvent} />
        </div>
      )}
      {chat.reminder !== null && (
        <UsageReminder
          continuousMs={chat.reminder}
          restMinutes={REST_MINUTES}
          onRest={() => chat.closeReminder(true)}
          onContinue={() => chat.closeReminder(false)}
        />
      )}
      {showConsent && consent.status === "required" && (
        <FirstRunConsent
          onAccept={(input) => {
            void consent.accept(input);
            setShowConsent(false);
          }}
        />
      )}
      {keyGate && character ? (
        <div className="pet-sheet key-gate" data-hit>
          <p className="key-gate-note">{NO_API_KEY_EXPLANATION}</p>
          {keyHint ? <p className="key-gate-hint">{keyHint}</p> : null}
          <div className="key-gate-actions">
            <button type="button" onClick={recheckKey}>
              填好了，继续
            </button>
            <button type="button" onClick={() => setKeyGate(false)}>
              先收起
            </button>
          </div>
          <SettingsApp />
        </div>
      ) : null}

      {import.meta.env.DEV && (
        <>
          <DebugPanel
            characterId={skin}
            emotion={debug.emotion ?? state.emotion}
            talking={debug.talking}
            onCharacter={(id) => setDebug((d) => ({ ...d, skin: id }))}
            onEmotion={(e) => setDebug((d) => ({ ...d, emotion: e }))}
            onTalking={(t) => setDebug((d) => ({ ...d, talking: t }))}
          >
            {ChatDebug && (
              <Suspense>
                <ChatDebug
                  chat={chat}
                  consent={consent}
                  onReset={() => setDebug({ talking: false })}
                />
              </Suspense>
            )}
          </DebugPanel>
          <div className={`debug-chip ${hit ? "on" : ""}`}>{hit ? "捕获鼠标" : "点击穿透"}</div>
        </>
      )}
    </main>
  );
}
