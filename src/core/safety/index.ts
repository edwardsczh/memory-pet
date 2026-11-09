export { createSafetyGuard, type SafetyGuard, type SafetyGuardOptions } from "./guard";
export { buildCrisisReply, detectCrisis, type CrisisResult } from "./crisis";
export { buildIdentityReply, isIdentityQuestion, type IdentityOptions } from "./identity";
export { filterReply, isLeaving, type ContentViolation } from "./content";
export {
  assessDependency,
  DEFAULT_DEPENDENCY_THRESHOLDS,
  type DependencyAdvice,
  type DependencyThresholds,
} from "./dependency";
export {
  createUsageTimer,
  IDLE_RESET_MS,
  REMIND_EVERY_MS,
  type UsageSnapshot,
  type UsageTimer,
} from "./usage";
export { EMERGENCY_NUMBERS, HOTLINES, HOTLINES_VERIFIED_AT, type Hotline } from "./hotlines";
