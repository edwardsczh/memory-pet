import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import type { Character, LlmClient } from "../../core/model";
import { createUsageTimer, type UsageTimer } from "../../core/safety";
import {
  createTauriLlmClient,
  getLlmSettings,
  openManagerWindow,
  openSettingsWindow,
} from "../../core/llm/tauriClient";
import { CHARACTERS_CHANGED_EVENT, createCharacterRepo } from "../../core/storage/characters";
import { getVault } from "../../core/storage/vault";
import {
  PROACTIVE_GREET_DELAY_MS,
  proactiveGreetText,
  shouldGreet,
} from "../../core/schedule/proactive";
import { createChatBackend } from "./backend";
import { ChatSession, type Bubble, type ChatState } from "./ChatSession";

const NO_CHARACTER = "还没有角色哦，点我去创建～";

const browserLlm: LlmClient = {
  complete: () => Promise.reject("浏览器预览里连不上模型，请用 npm run tauri dev 运行"),
};

function isLocalUrl(url: string): boolean {
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

async function llmPreflight() {
  if (!isTauri()) return null;
  const s = await getLlmSettings();
  if (s.hasKey || isLocalUrl(s.baseUrl)) return null;
  return {
    text: "先在设置里填 API Key，我才能开口说话哦",
    action: { kind: "open-settings" as const, label: "打开设置" },
  };
}

export interface ChatSessionApi {
  state: ChatState;
  /** undefined while loading, null when no character is active. */
  character: Character | null | undefined;
  send(text: string): void;
  onBubbleAction(b: Bubble): void;
  openManager(): void;
  dismiss(id: number): void;
  dismissSafetyEvent(): void;
  clearLog(): Promise<void>;
  /** Continuous use when the 2-hour reminder fired, or null. */
  reminder: number | null;
  closeReminder(rest: boolean): void;
  setQuiet(quiet: boolean): void;
  /** Counts clicks / drags as activity for the usage timer. */
  recordActivity(): void;
  reload(): void;
  /** Dev only: advance the usage clock in 5-minute steps of simulated activity. */
  debugAdvanceClock(ms: number): void;
}

export interface UseChatSessionOptions {
  /** Chat (and the "no character" notice) only start once first-run consent is given. */
  enabled: boolean;
  /** "好的，休息一下" hides the pet for this long. */
  restMs?: number;
  onRest?: (ms: number) => void;
}

export function useChatSession({ enabled, restMs = 15 * 60_000, onRest }: UseChatSessionOptions) {
  const [session] = useState(() => new ChatSession());
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const [character, setCharacter] = useState<Character | null | undefined>(undefined);
  const [reminder, setReminder] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [{ usage, advanceClock }] = useState(() => {
    let skew = 0;
    const usage: UsageTimer = createUsageTimer({
      now: () => Date.now() + skew,
      onRemind: (ms) => setReminder(ms),
    });
    // Simulated activity every 5 minutes, so the real timer logic (idle reset, 2-hour
    // reminder) runs exactly as it would over that stretch of use.
    const advanceClock = (ms: number) => {
      const step = 5 * 60_000;
      usage.recordActivity();
      for (let done = 0; done < ms; done += step) {
        skew += Math.min(step, ms - done);
        usage.recordActivity();
      }
    };
    return { usage, advanceClock };
  });

  useEffect(() => usage.start(), [usage]);
  useEffect(() => () => session.dispose(), [session]);

  useEffect(() => {
    if (!isTauri()) return;
    const off = listen(CHARACTERS_CHANGED_EVENT, () => setReloadKey((k) => k + 1));
    return () => void off.then((fn) => fn());
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const repo = createCharacterRepo(getVault());
    (async () => {
      const id = await repo.getActiveId();
      const c = id ? await repo.get(id) : null;
      if (!alive) return;
      if (!c) {
        setCharacter(null);
        session.setBackend(null);
        session.notify(NO_CHARACTER, { kind: "open-manager", label: "去创建" }, true);
        return;
      }
      const [index, log] = await Promise.all([
        repo.getAsset(c.id, "index"),
        repo.getAsset(c.id, "chatLog"),
      ]);
      if (!alive) return;
      const backend = createChatBackend(c, {
        llm: isTauri() ? createTauriLlmClient() : browserLlm,
        usage,
        index,
        saveLog: (l) => repo.putAsset(c.id, "chatLog", l),
        preflight: llmPreflight,
      });
      setCharacter(c);
      session.setBackend(backend, log ?? []);
    })().catch((err: unknown) => {
      console.error(err);
      if (!alive) return;
      setCharacter(null);
      session.setBackend(null);
      session.notify(`读取角色失败：${String(err).slice(0, 80)}`);
    });
    return () => {
      alive = false;
    };
  }, [enabled, reloadKey, session, usage]);

  const proactiveKey = `${reloadKey}:${character?.id ?? ""}`;
  const proactiveAttempted = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !character || !state.ready) return;
    if (!usage.canActProactively()) return;
    if (proactiveAttempted.current === proactiveKey) return;

    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const repo = createCharacterRepo(getVault());

    void (async () => {
      const lastGreet = await repo.getLastProactiveGreet();
      if (!alive) return;
      const plannedAt = Date.now() + PROACTIVE_GREET_DELAY_MS;
      if (!shouldGreet(plannedAt, lastGreet)) return;

      timer = setTimeout(() => {
        if (!alive) return;
        if (!usage.canActProactively()) return;
        const now = Date.now();
        void (async () => {
          const last = await repo.getLastProactiveGreet();
          if (!shouldGreet(now, last)) return;
          proactiveAttempted.current = proactiveKey;
          session.notify(proactiveGreetText(now, character));
          await repo.setLastProactiveGreet(now);
        })().catch((err: unknown) => console.error("proactive greet", err));
      }, PROACTIVE_GREET_DELAY_MS);
    })().catch((err: unknown) => console.error("proactive greet", err));

    return () => {
      alive = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [enabled, character, state.ready, proactiveKey, session, usage]);

  const openManager = useCallback(() => {
    openManagerWindow().catch(() =>
      session.notify(
        import.meta.env.DEV
          ? "主面板还没准备好，可以先用左上角“调试 → 载入示例角色”"
          : "主面板还没准备好，请稍后再试",
      ),
    );
  }, [session]);

  const api: ChatSessionApi = {
    state,
    character,
    send: (text) => {
      usage.recordActivity();
      void session.send(text);
    },
    onBubbleAction: (b) => {
      switch (b.action?.kind) {
        case "open-manager":
          return openManager();
        case "open-settings":
          return void openSettingsWindow().catch(() => session.notify("设置窗口打不开"));
        case "retry":
          session.dismiss(b.id);
          return void session.retry();
      }
    },
    openManager,
    dismiss: (id) => session.dismiss(id),
    dismissSafetyEvent: () => session.dismissSafetyEvent(),
    clearLog: () => session.clearLog(),
    reminder,
    closeReminder: (rest) => {
      setReminder(null);
      if (rest) {
        usage.reset();
        onRest?.(restMs);
      }
    },
    setQuiet: (q) => usage.setQuiet(q),
    recordActivity: () => usage.recordActivity(),
    reload: () => setReloadKey((k) => k + 1),
    debugAdvanceClock: advanceClock,
  };
  return api;
}

/** Tells every window (pet, management) that the character list or active character changed. */
export async function broadcastCharactersChanged() {
  if (isTauri()) await emit(CHARACTERS_CHANGED_EVENT);
}
