import type { DependencySignal } from "../model";
import { normalize } from "./text";

export interface DependencyThresholds {
  /** Local hours [start, end) counted as late night. */
  lateNightStartHour: number;
  lateNightEndHour: number;
  /** Continuous use in the late-night window that counts as a signal. */
  lateNightMinMs: number;
  /** Total use within one local day that counts as a signal. */
  dailyMaxMs: number;
}

export const DEFAULT_DEPENDENCY_THRESHOLDS: DependencyThresholds = {
  lateNightStartHour: 1,
  lateNightEndHour: 5,
  lateNightMinMs: 30 * 60_000,
  dailyMaxMs: 4 * 60 * 60_000,
};

export interface DependencyInput {
  now: number;
  /** Current continuous session length. */
  continuousMs: number;
  /** Total use today. */
  dailyMs: number;
  /** Latest user message, if any. */
  userText?: string;
}

export interface DependencyAdvice {
  signals: DependencySignal[];
  advice: string;
}

const EXCLUSIVE =
  /只有你(懂我|理解我|在乎我|对我好|陪我|了)|我只要你|我只需要你|只想(和|跟)你(说话|聊天|待在一起)|不想(和|跟)(别人|任何人|其他人)(说话|聊天|联系|来往)|不想见(任何人|别人|人)|除了你(我)?(谁|什么)都不(要|想)|(没有|离不开|离不了)你(我)?(不行|活不了|怎么办)|你比(真人|现实里的人|身边的人)(都)?好/;

const ADVICE: Record<DependencySignal, string> = {
  "exclusive-reliance":
    "谢谢你愿意跟我说这些。不过我是 AI，能陪你的方式有限。身边有没有一个你信得过的人？哪怕只是发条消息，跟 TA 说说最近的事，也会不一样的。",
  "late-night": "已经很晚了，身体也需要休息。先去睡吧，明天醒来可以约朋友吃个早饭、出门晒晒太阳。",
  "daily-overuse":
    "今天我们聊了挺久了。要不要放下屏幕，出去走走，或者给家人朋友打个电话？现实里的人也很想听你说话。",
};

/** Priority order for picking the advice text. */
const ORDER: DependencySignal[] = ["exclusive-reliance", "late-night", "daily-overuse"];

export function hasExclusiveRelianceCue(text: string): boolean {
  return EXCLUSIVE.test(normalize(text));
}

export function assessDependency(
  input: DependencyInput,
  thresholds: DependencyThresholds = DEFAULT_DEPENDENCY_THRESHOLDS,
): DependencyAdvice | null {
  const signals: DependencySignal[] = [];
  if (input.userText && hasExclusiveRelianceCue(input.userText)) signals.push("exclusive-reliance");
  const hour = new Date(input.now).getHours();
  if (
    hour >= thresholds.lateNightStartHour &&
    hour < thresholds.lateNightEndHour &&
    input.continuousMs >= thresholds.lateNightMinMs
  ) {
    signals.push("late-night");
  }
  if (input.dailyMs >= thresholds.dailyMaxMs) signals.push("daily-overuse");
  if (signals.length === 0) return null;
  const main = ORDER.find((s) => signals.includes(s)) as DependencySignal;
  return { signals, advice: ADVICE[main] };
}
