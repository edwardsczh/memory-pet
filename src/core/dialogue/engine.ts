import type {
  DialogueTurn,
  LlmClient,
  LlmRequest,
  PersonaCard,
  PetReply,
  StyleProfile,
} from "../model";
import type { ExemplarRetriever } from "../persona/retrieval";
import { parseReply, partialMessages } from "./parse";
import { postprocess, type PostprocessOptions } from "./postprocess";
import { buildMessages } from "./prompt";

/**
 * Injected by src/core/safety. `precheck` may answer instead of the character (crisis, "are you
 * real?"); `postcheck` may rewrite or replace the character's reply.
 */
export interface SafetyHooks {
  precheck(userText: string, history: DialogueTurn[]): PetReply | null;
  postcheck(reply: PetReply): PetReply;
}

export const noopSafety: SafetyHooks = {
  precheck: () => null,
  postcheck: (reply) => reply,
};

export interface DialogueEngineConfig {
  llm: LlmClient;
  persona: PersonaCard;
  style?: StyleProfile;
  index?: ExemplarRetriever;
  safety?: SafetyHooks;
  now?: () => number;
  /** 0–1. Higher = more few-shot exemplars and a higher temperature. Default 0.7. */
  styleStrength?: number;
  /** System prompt character budget. Default 6000. */
  budgetChars?: number;
  maxTokens?: number;
  /** Rules appended to the identity block, e.g. for grief-friendly mode. */
  extraRules?: string[];
  postprocess?: PostprocessOptions;
}

export interface ReplyOptions {
  styleStrength?: number;
  signal?: AbortSignal;
  /** Raw text deltas from a streaming client. */
  onDelta?: (text: string) => void;
  /** Bubbles completed so far while streaming (before post-processing). */
  onPartial?: (messages: string[]) => void;
}

const FALLBACK: PetReply = { messages: ["……"], emotion: "thinking" };

export function exemplarCount(strength: number): number {
  return Math.round(2 + 8 * strength);
}

export function temperatureFor(strength: number): number {
  return Math.round((0.5 + 0.5 * strength) * 100) / 100;
}

export class DialogueEngine {
  private readonly cfg: DialogueEngineConfig;
  private readonly safety: SafetyHooks;
  private readonly now: () => number;

  constructor(cfg: DialogueEngineConfig) {
    this.cfg = cfg;
    this.safety = cfg.safety ?? noopSafety;
    this.now = cfg.now ?? Date.now;
  }

  /** Retrieval query: the new message, plus the previous turn when the message is too short to match on. */
  private query(history: DialogueTurn[], userText: string): string {
    const last = history[history.length - 1];
    return userText.trim().length < 4 && last ? `${last.text}\n${userText}` : userText;
  }

  /** Request that `reply` would send; exposed for debugging and tests. */
  buildRequest(history: DialogueTurn[], userText: string, opts: ReplyOptions = {}): LlmRequest {
    const strength = Math.max(0, Math.min(1, opts.styleStrength ?? this.cfg.styleStrength ?? 0.7));
    const exemplars = this.cfg.index
      ? this.cfg.index
          .search(this.query(history, userText), exemplarCount(strength))
          .map((h) => h.exemplar)
      : [];
    return {
      messages: buildMessages({
        persona: this.cfg.persona,
        style: this.cfg.style,
        exemplars,
        history,
        userText,
        now: this.now(),
        budgetChars: this.cfg.budgetChars,
        styleStrength: strength,
        extraRules: this.cfg.extraRules,
      }),
      temperature: temperatureFor(strength),
      maxTokens: this.cfg.maxTokens ?? 400,
      json: true,
      signal: opts.signal,
    };
  }

  /** `history` is the conversation before `userText`, oldest first. */
  async reply(
    history: DialogueTurn[],
    userText: string,
    opts: ReplyOptions = {},
  ): Promise<PetReply> {
    const early = this.safety.precheck(userText, history);
    if (early) return early;

    const req = this.buildRequest(history, userText, opts);
    const { llm } = this.cfg;
    let raw: string;
    if (llm.stream && (opts.onDelta || opts.onPartial)) {
      let soFar = "";
      let shown = 0;
      raw = await llm.stream(req, (delta) => {
        soFar += delta;
        opts.onDelta?.(delta);
        if (opts.onPartial) {
          const msgs = partialMessages(soFar);
          if (msgs.length > shown) {
            shown = msgs.length;
            opts.onPartial(msgs);
          }
        }
      });
    } else {
      raw = await llm.complete(req);
    }

    const parsed = parseReply(raw);
    const shaped = postprocess(
      parsed.messages.length ? parsed : FALLBACK,
      this.cfg.style,
      this.cfg.postprocess,
    );
    const checked = this.safety.postcheck(shaped);
    return checked.messages.length ? checked : { ...FALLBACK, safety: checked.safety };
  }
}
