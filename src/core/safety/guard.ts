import type {
  DialogueTurn,
  DependencySignal,
  EmergencyContact,
  PetReply,
  SafetyEvent,
  SubjectStatus,
} from "../model";
import { filterReply, isLeaving, type ContentViolation } from "./content";
import { buildCrisisReply, detectCrisis } from "./crisis";
import {
  assessDependency,
  DEFAULT_DEPENDENCY_THRESHOLDS,
  type DependencyThresholds,
} from "./dependency";
import { buildIdentityReply, isIdentityQuestion } from "./identity";

export interface SafetyGuardOptions {
  /** Character name, e.g. "小鹿". */
  taName?: string;
  /** Other names for TA (relation such as "妈妈"). */
  aliases?: string[];
  /** How TA addresses the user. */
  addressing?: string;
  subject?: SubjectStatus;
  /** Static contact or a getter, so settings changes apply without rebuilding the guard. */
  emergencyContact?: EmergencyContact | (() => EmergencyContact | undefined);
  now?: () => number;
  /** Usage source for dependency checks, e.g. a UsageTimer. */
  usage?: { snapshot(): { continuousMs: number; dailyMs: number } };
  dependencyThresholds?: Partial<DependencyThresholds>;
  /** Minimum gap between two dependency notes with the same signal. Default 1 h. */
  dependencyCooldownMs?: number;
  /** Every safety event (crisis, dependency) is also reported here. */
  onEvent?: (event: SafetyEvent) => void;
  /** Content-filter hits, for local diagnostics. */
  onViolation?: (violations: ContentViolation[], original: PetReply) => void;
}

export interface SafetyGuard {
  /** Returns an out-of-character reply that must be shown instead of calling the LLM, or null. */
  precheck(userText: string, history: DialogueTurn[]): PetReply | null;
  /** Filters the model reply; attaches a pending dependency note as `event`. */
  postcheck(reply: PetReply): PetReply;
}

export function createSafetyGuard(options: SafetyGuardOptions = {}): SafetyGuard {
  const now = options.now ?? Date.now;
  const thresholds = { ...DEFAULT_DEPENDENCY_THRESHOLDS, ...options.dependencyThresholds };
  const cooldownMs = options.dependencyCooldownMs ?? 60 * 60_000;
  const lastNoted = new Map<DependencySignal, number>();
  let userLeaving = false;
  let pending: SafetyEvent | null = null;

  const identity = {
    taName: options.taName,
    aliases: options.aliases,
    addressing: options.addressing,
    subject: options.subject,
  };

  const emit = (event: SafetyEvent) => options.onEvent?.(event);

  const contact = () =>
    typeof options.emergencyContact === "function"
      ? options.emergencyContact()
      : options.emergencyContact;

  const checkDependency = (userText: string) => {
    const usage = options.usage?.snapshot() ?? { continuousMs: 0, dailyMs: 0 };
    const t = now();
    const advice = assessDependency({ now: t, userText, ...usage }, thresholds);
    if (!advice) return;
    const fresh = advice.signals.filter((s) => {
      const last = lastNoted.get(s);
      return last === undefined || t - last >= cooldownMs;
    });
    if (fresh.length === 0) return;
    for (const s of advice.signals) lastNoted.set(s, t);
    pending = { type: "dependency", signals: advice.signals, advice: advice.advice };
    emit(pending);
  };

  return {
    precheck(userText) {
      userLeaving = isLeaving(userText);
      pending = null;

      const crisis = detectCrisis(userText);
      if (crisis) {
        const reply = buildCrisisReply(crisis, {
          taName: options.subject === "self" ? undefined : options.taName,
          emergencyContact: contact(),
        });
        if (reply.event) emit(reply.event);
        return reply;
      }

      if (isIdentityQuestion(userText, identity)) return buildIdentityReply(identity);

      checkDependency(userText);
      return null;
    },

    postcheck(reply) {
      if (reply.safety === "crisis" || reply.safety === "ai-identity") return reply;
      const { reply: filtered, violations } = filterReply(reply, { userLeaving });
      if (violations.length > 0) options.onViolation?.(violations, reply);
      if (pending && !filtered.event) {
        const out = { ...filtered, event: pending };
        pending = null;
        return out;
      }
      return filtered;
    },
  };
}
