export interface UsageTimerOptions {
  /** Injectable clock (ms), for tests. */
  now?: () => number;
  /** Idle gap that ends a continuous session. Default 10 min. */
  idleResetMs?: number;
  /** Reminder interval. Default 2 h. */
  remindEveryMs?: number;
  /** Fired each time continuous use passes another `remindEveryMs`. */
  onRemind?: (continuousMs: number) => void;
  /** Local calendar day of a timestamp; daily totals reset when it changes. */
  dayKey?: (ts: number) => string;
}

export interface UsageSnapshot {
  active: boolean;
  continuousMs: number;
  dailyMs: number;
  quiet: boolean;
  remindersFired: number;
}

export interface UsageTimer {
  /** Call on every user interaction (message, click, drag). */
  recordActivity(): void;
  /** Periodic check; ends idle sessions and fires due reminders. */
  tick(): void;
  /**
   * Do-not-disturb. While quiet, `tick()` does not fire reminders and
   * `canActProactively()` is false; a due reminder fires on the next user
   * activity or when quiet ends.
   */
  setQuiet(quiet: boolean): void;
  canActProactively(): boolean;
  /** Start a fresh session, e.g. after the user chose to take a break. */
  reset(): void;
  snapshot(): UsageSnapshot;
  /** Runs `tick()` on an interval; returns a stop function. */
  start(intervalMs?: number): () => void;
}

export const IDLE_RESET_MS = 10 * 60_000;
export const REMIND_EVERY_MS = 2 * 60 * 60_000;

function localDayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function createUsageTimer(options: UsageTimerOptions = {}): UsageTimer {
  const now = options.now ?? Date.now;
  const idleResetMs = options.idleResetMs ?? IDLE_RESET_MS;
  const remindEveryMs = options.remindEveryMs ?? REMIND_EVERY_MS;
  const dayKey = options.dayKey ?? localDayKey;

  let sessionStart: number | null = null;
  let lastActive: number | null = null;
  let remindersFired = 0;
  let dailyMs = 0;
  let day = dayKey(now());
  let quiet = false;

  const rollDay = (t: number) => {
    const k = dayKey(t);
    if (k !== day) {
      day = k;
      dailyMs = 0;
    }
  };

  const isIdle = (t: number) => lastActive === null || t - lastActive > idleResetMs;

  const endSession = () => {
    sessionStart = null;
    lastActive = null;
    remindersFired = 0;
  };

  const checkReminder = (t: number, userInitiated: boolean) => {
    if (sessionStart === null) return;
    if (quiet && !userInitiated) return;
    const continuous = t - sessionStart;
    const due = Math.floor(continuous / remindEveryMs);
    if (due > remindersFired) {
      remindersFired = due;
      options.onRemind?.(continuous);
    }
  };

  const timer: UsageTimer = {
    recordActivity() {
      const t = now();
      rollDay(t);
      if (isIdle(t)) {
        sessionStart = t;
        remindersFired = 0;
      } else {
        dailyMs += t - (lastActive as number);
      }
      lastActive = t;
      checkReminder(t, true);
    },
    tick() {
      const t = now();
      rollDay(t);
      if (sessionStart !== null && isIdle(t)) {
        endSession();
        return;
      }
      checkReminder(t, false);
    },
    setQuiet(q) {
      quiet = q;
      if (!q) checkReminder(now(), false);
    },
    canActProactively: () => !quiet,
    reset: endSession,
    snapshot() {
      const t = now();
      const active = sessionStart !== null && !isIdle(t);
      return {
        active,
        continuousMs: active ? t - (sessionStart as number) : 0,
        dailyMs: dayKey(t) === day ? dailyMs : 0,
        quiet,
        remindersFired,
      };
    },
    start(intervalMs = 30_000) {
      const id = setInterval(() => timer.tick(), intervalMs);
      return () => clearInterval(id);
    },
  };
  return timer;
}
