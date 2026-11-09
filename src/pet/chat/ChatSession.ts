import type { DialogueTurn, Emotion, PetReply, SafetyEvent, StyleProfile } from "../../core/model";
import type { ReplyOptions } from "../../core/dialogue";
import { isLeaving } from "../../core/safety";
import {
  bubbleDueAt,
  HISTORY_TURNS,
  MAX_VISIBLE_BUBBLES,
  remainingMessages,
  screenPartial,
  sniffEmotion,
  talkDurationMs,
  trimLog,
} from "./pacing";

export type NoticeAction = "open-manager" | "open-settings" | "retry" | "consent";

export interface Bubble {
  id: number;
  kind: "pet" | "user" | "notice";
  text: string;
  action?: { kind: NoticeAction; label: string };
  /** Fading out; removed shortly after. */
  leaving?: boolean;
}

export interface ChatBackend {
  reply(history: DialogueTurn[], userText: string, opts: ReplyOptions): Promise<PetReply>;
  style?: StyleProfile;
  saveLog(log: DialogueTurn[]): Promise<void>;
  /** A notice to show instead of sending, e.g. when no API key is configured. */
  preflight?(): Promise<Omit<Bubble, "id" | "kind"> | null>;
}

export interface ChatTimings {
  /** User message → first streamed text from the model (null without streaming / safety reply). */
  firstDeltaMs: number | null;
  /** User message → first pet bubble on screen. */
  firstBubbleMs: number;
  /** User message → last pet bubble on screen. */
  totalMs: number;
  streamed: boolean;
}

export interface ChatState {
  bubbles: Bubble[];
  /** "正在输入…" indicator. */
  typing: boolean;
  /** A turn is in flight (request running or bubbles still queued). */
  busy: boolean;
  emotion: Emotion;
  talking: boolean;
  log: DialogueTurn[];
  /** User text and pet bubbles of the turn in flight, not yet in `log`. */
  pending: { user: string; shown: string[] } | null;
  /** Crisis event of the latest reply; the UI shows the help card until dismissed. */
  safetyEvent: SafetyEvent | null;
  lastTimings: ChatTimings | null;
  ready: boolean;
}

export interface ChatSessionOptions {
  now?: () => number;
  /** Fade-out animation length. */
  fadeMs?: number;
  /** How long bubbles stay after the pet finished talking. */
  lingerMs?: number;
  /** How long the reply's emotion is held before returning to neutral. */
  emotionHoldMs?: number;
}

type Timer = ReturnType<typeof setTimeout>;

const INITIAL: ChatState = {
  bubbles: [],
  typing: false,
  busy: false,
  emotion: "neutral",
  talking: false,
  log: [],
  pending: null,
  safetyEvent: null,
  lastTimings: null,
  ready: false,
};

/** Friendly Chinese text for anything an LLM call can reject with. */
export function errorText(err: unknown): string {
  const raw = typeof err === "string" ? err : err instanceof Error ? err.message : "";
  const msg = raw.trim().slice(0, 120);
  return msg ? `哎呀，没能回复你：${msg}` : "哎呀，刚刚走神了，没能回复你，再说一次好吗？";
}

/**
 * Framework-free chat controller for the pet window: sends a message through the backend,
 * paces the reply burst bubble by bubble (streamed bubbles appear as soon as they are
 * complete), drives emotion / talking and persists the log. React subscribes via
 * `subscribe` / `getState` (useSyncExternalStore).
 */
export class ChatSession {
  private state: ChatState = INITIAL;
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;
  private readonly fadeMs: number;
  private readonly lingerMs: number;
  private readonly emotionHoldMs: number;

  private backend: ChatBackend | null = null;
  private nextId = 1;
  private turn = 0;
  private abort: AbortController | null = null;
  private queue: string[] = [];
  private replyDone = false;
  private sentAt = 0;
  private lastShownAt = 0;
  private shownCount = 0;
  private streamed = false;
  private finalReply: PetReply | null = null;
  private firstBubbleAt: number | null = null;
  private firstDeltaAt: number | null = null;
  private lastUserText = "";
  private streamEmotion: Emotion | null = null;
  private sending = false;

  private pumpTimer: Timer | undefined;
  private talkTimer: Timer | undefined;
  private emotionTimer: Timer | undefined;
  private lingerTimer: Timer | undefined;
  private readonly fadeTimers = new Set<Timer>();

  constructor(opts: ChatSessionOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.fadeMs = opts.fadeMs ?? 260;
    this.lingerMs = opts.lingerMs ?? 15_000;
    this.emotionHoldMs = opts.emotionHoldMs ?? 6_000;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): ChatState => this.state;

  private set(patch: Partial<ChatState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  /** Switches character (or clears it with null); cancels the turn in flight. */
  setBackend(backend: ChatBackend | null, log: DialogueTurn[] = []) {
    this.cancelTurn();
    this.backend = backend;
    this.set({
      bubbles: [],
      log: trimLog(log),
      emotion: "neutral",
      talking: false,
      safetyEvent: null,
      ready: backend !== null,
    });
  }

  /** Shows a system notice (not AI content). Sticky notices stay until dismissed. */
  notify(text: string, action?: Bubble["action"], sticky = false) {
    const id = this.push({ kind: "notice", text, action });
    if (!sticky && !this.state.busy) this.scheduleLinger();
    return id;
  }

  dismiss(id: number) {
    this.fade([id]);
  }

  dismissSafetyEvent() {
    this.set({ safetyEvent: null });
  }

  retry(): Promise<void> {
    return this.lastUserText ? this.send(this.lastUserText) : Promise.resolve();
  }

  async clearLog() {
    this.set({ log: [] });
    await this.backend?.saveLog([]);
  }

  async send(input: string): Promise<void> {
    const text = input.trim();
    const backend = this.backend;
    if (!text || !backend || this.state.busy || this.sending) return;
    this.lastUserText = text;
    this.clearNotices();

    this.sending = true;
    let notice: Awaited<ReturnType<NonNullable<ChatBackend["preflight"]>>>;
    try {
      notice = (await backend.preflight?.()) ?? null;
    } catch (err) {
      notice = { text: errorText(err) };
    } finally {
      this.sending = false;
    }
    if (backend !== this.backend) return;
    if (notice) {
      this.push({ kind: "notice", ...notice });
      return;
    }

    const turn = ++this.turn;
    this.streamEmotion = null;
    const abort = new AbortController();
    this.abort = abort;
    this.queue = [];
    this.replyDone = false;
    this.streamed = false;
    this.finalReply = null;
    this.firstBubbleAt = null;
    this.firstDeltaAt = null;
    this.shownCount = 0;
    this.sentAt = this.now();
    this.lastShownAt = this.sentAt;
    clearTimeout(this.lingerTimer);
    clearTimeout(this.emotionTimer);

    this.push({ kind: "user", text });
    this.set({
      busy: true,
      typing: true,
      emotion: "thinking",
      talking: false,
      pending: { user: text, shown: [] },
    });

    const history = this.state.log.slice(-HISTORY_TURNS);
    const userLeaving = isLeaving(text);
    let raw = "";
    let streamedEmotion: Emotion | null = null;
    let partialCount = 0;
    let holding = false;

    try {
      const reply = await backend.reply(history, text, {
        signal: abort.signal,
        onDelta: (d) => {
          if (turn !== this.turn) return;
          this.firstDeltaAt ??= this.now();
          raw += d;
          streamedEmotion ??= sniffEmotion(raw);
        },
        onPartial: (msgs) => {
          if (turn !== this.turn) return;
          this.streamed = true;
          for (; partialCount < msgs.length; partialCount++) {
            if (holding) continue;
            const screened = screenPartial(msgs[partialCount], backend.style, userLeaving);
            if (!screened) {
              holding = true;
              continue;
            }
            this.enqueue(screened, streamedEmotion);
          }
        },
      });
      if (turn !== this.turn) return;
      this.finalReply = reply;
      const already = [...(this.state.pending?.shown ?? []), ...this.queue];
      this.queue.push(...remainingMessages(already, reply.messages));
      this.replyDone = true;
      if (reply.event?.type === "crisis") this.set({ safetyEvent: reply.event });
      this.pump();
    } catch (err) {
      if (turn !== this.turn) return;
      this.abort = null;
      this.queue = [];
      this.set({ busy: false, typing: false, emotion: "sad", talking: false, pending: null });
      this.push({
        kind: "notice",
        text: errorText(err),
        action: { kind: "retry", label: "再试一次" },
      });
      this.holdEmotion();
    }
  }

  private enqueue(texts: string[], emotion: Emotion | null) {
    this.queue.push(...texts);
    this.streamEmotion = emotion;
    this.pump();
  }

  private pump() {
    if (this.pumpTimer !== undefined) return;
    const next = this.queue[0];
    if (next === undefined) {
      if (this.replyDone) this.finishTurn();
      return;
    }
    const due = bubbleDueAt(
      this.lastShownAt,
      next,
      this.shownCount === 0,
      this.backend?.style,
      this.finalReply?.safety,
    );
    const turn = this.turn;
    this.pumpTimer = setTimeout(
      () => {
        this.pumpTimer = undefined;
        if (turn !== this.turn) return;
        this.showNext();
        this.pump();
      },
      Math.max(0, due - this.now()),
    );
  }

  private showNext() {
    const text = this.queue.shift();
    if (text === undefined) return;
    const t = this.now();
    this.lastShownAt = t;
    this.shownCount++;
    this.firstBubbleAt ??= t;
    // The emotion usually streams in after the messages; until then talk with a neutral face.
    const emotion = this.finalReply?.emotion ?? this.streamEmotion ?? "neutral";
    this.push({ kind: "pet", text });
    this.set({
      emotion,
      talking: true,
      typing: this.queue.length > 0 || !this.replyDone,
      pending: this.state.pending && {
        ...this.state.pending,
        shown: [...this.state.pending.shown, text],
      },
    });
    clearTimeout(this.talkTimer);
    this.talkTimer = setTimeout(() => this.set({ talking: false }), talkDurationMs(text));
  }

  private finishTurn() {
    const pending = this.state.pending;
    const reply = this.finalReply;
    this.abort = null;
    if (!pending || !reply) return;
    const t = this.now();
    const shown = pending.shown;
    const log = trimLog([
      ...this.state.log,
      { role: "user", text: pending.user, ts: this.sentAt },
      ...shown.map((text) => ({ role: "pet" as const, text, ts: t })),
    ]);
    this.set({
      busy: false,
      typing: false,
      emotion: reply.emotion,
      pending: null,
      log,
      lastTimings: {
        firstDeltaMs: this.firstDeltaAt === null ? null : this.firstDeltaAt - this.sentAt,
        firstBubbleMs: (this.firstBubbleAt ?? t) - this.sentAt,
        totalMs: this.lastShownAt - this.sentAt,
        streamed: this.streamed,
      },
    });
    if (reply.event?.type === "dependency") this.push({ kind: "notice", text: reply.event.advice });
    this.holdEmotion();
    this.scheduleLinger();
    void this.backend?.saveLog(log).catch((err: unknown) => console.error(err));
  }

  private holdEmotion() {
    clearTimeout(this.emotionTimer);
    this.emotionTimer = setTimeout(() => this.set({ emotion: "neutral" }), this.emotionHoldMs);
  }

  private scheduleLinger() {
    clearTimeout(this.lingerTimer);
    this.lingerTimer = setTimeout(() => {
      this.fade(this.state.bubbles.filter((b) => !b.action).map((b) => b.id));
    }, this.lingerMs);
  }

  private push(b: Omit<Bubble, "id">): number {
    const id = this.nextId++;
    const bubbles = [...this.state.bubbles, { ...b, id }];
    const live = bubbles.filter((x) => !x.leaving);
    const excess = live.slice(0, Math.max(0, live.length - MAX_VISIBLE_BUBBLES)).map((x) => x.id);
    this.set({ bubbles });
    this.fade(excess);
    return id;
  }

  private fade(ids: number[]) {
    if (ids.length === 0) return;
    const set = new Set(ids);
    this.set({
      bubbles: this.state.bubbles.map((b) => (set.has(b.id) ? { ...b, leaving: true } : b)),
    });
    const timer = setTimeout(() => {
      this.fadeTimers.delete(timer);
      this.set({ bubbles: this.state.bubbles.filter((b) => !set.has(b.id)) });
    }, this.fadeMs);
    this.fadeTimers.add(timer);
  }

  private clearNotices() {
    this.fade(this.state.bubbles.filter((b) => b.kind === "notice").map((b) => b.id));
  }

  private cancelTurn() {
    this.turn++;
    this.abort?.abort();
    this.abort = null;
    this.queue = [];
    clearTimeout(this.pumpTimer);
    this.pumpTimer = undefined;
    if (this.state.busy) this.set({ busy: false, typing: false, pending: null });
  }

  /** Stops timers and the turn in flight; the session stays usable (StrictMode remounts). */
  dispose() {
    this.cancelTurn();
    for (const t of [this.talkTimer, this.emotionTimer, this.lingerTimer, ...this.fadeTimers])
      clearTimeout(t);
    this.fadeTimers.clear();
  }
}
