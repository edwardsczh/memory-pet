/**
 * Shared domain model. Every module (ingest, persona, dialogue, safety, storage,
 * UI) codes against these types; change them only in a dedicated PR.
 */

// ---------- Imported chat history ----------

export type MessageKind =
  | "text"
  | "image"
  | "voice"
  | "video"
  | "sticker"
  | "file"
  | "link"
  | "transfer" // 红包 / 转账
  | "system" // 系统提示、撤回提示、入群等
  | "other";

/** One message after parsing, before or after cleaning. */
export interface ChatMessage {
  /** Stable id unique within one import (parser-generated if the source has none). */
  id: string;
  /** Unix epoch milliseconds. */
  ts: number;
  /** Display name / id of the sender exactly as it appears in the source. */
  sender: string;
  kind: MessageKind;
  /** Plain text. For non-text kinds a short placeholder such as "[图片]". */
  text: string;
  /** Path or id of the media inside the export, if any. */
  mediaRef?: string;
  /** id of the message this one replies to / quotes, if known. */
  replyTo?: string;
}

/** Formats the importer can detect. */
export type SourceFormat =
  | "wechat-chatlog-keeper-json"
  | "wechat-exporter-json"
  | "wechat-exporter-txt"
  | "wx-cli-json"
  | "wx-cli-markdown"
  | "qq-ntqq-json"
  | "qq-txt"
  | "qq-mht"
  | "generic-csv"
  | "generic-json"
  | "plain-text";

export interface ParsedImport {
  format: SourceFormat;
  /** Conversation title from the export (contact or group name), if present. */
  title?: string;
  isGroup: boolean;
  /** Distinct senders with message counts, for the "who is me / who is TA" step. */
  participants: { sender: string; count: number }[];
  messages: ChatMessage[];
  warnings: string[];
}

/** User's answer to "which sender is me, which is TA". */
export interface SpeakerMapping {
  me: string[];
  ta: string[];
}

export type Role = "me" | "ta" | "other";

export interface CleanMessage extends ChatMessage {
  role: Role;
}

/** Consecutive messages from one role, keeping the burst structure. */
export interface Turn {
  role: Role;
  messages: CleanMessage[];
}

/** A conversation segment split by idle gaps (default 30 min). */
export interface Session {
  id: string;
  start: number;
  end: number;
  turns: Turn[];
}

export interface CleanReport {
  total: number;
  kept: number;
  droppedByKind: Partial<Record<MessageKind, number>>;
  redactions: Partial<Record<RedactionKind, number>>;
  sessions: number;
}

export type RedactionKind = "phone" | "idcard" | "bankcard" | "email" | "address" | "password";

// ---------- Persona assets ----------

/** "User said -> TA replied" pair used as few-shot exemplar. */
export interface Exemplar {
  id: string;
  sessionId: string;
  ts: number;
  /** User's turn text (bursts joined by "\n"). May include 1–2 preceding turns for context. */
  context: string;
  /** TA's reply burst, one entry per original message. */
  reply: string[];
  tags?: string[];
}

export interface StyleProfile {
  messageCount: number;
  /** Mean / median characters per TA message. */
  avgLength: number;
  medianLength: number;
  /** Mean number of messages TA sends per turn. */
  avgBurst: number;
  /** Share of TA messages ending with "。". */
  periodRate: number;
  /** Frequent sentence-final punctuation / particles, e.g. "～", "。。。", "哈哈". */
  punctuation: { token: string; rate: number }[];
  catchphrases: { phrase: string; count: number }[];
  emojiRate: number;
  topEmojis: string[];
  /** 24 buckets, share of TA messages per hour of day. */
  activeHours: number[];
  /** Names TA uses for the user, e.g. "宝", "笨蛋". */
  nicknamesForMe: string[];
  firstTs: number;
  lastTs: number;
}

export interface EvidenceRef {
  messageId: string;
  ts: number;
  excerpt: string;
}

export interface PersonaTrait {
  text: string;
  evidence: EvidenceRef[];
}

export interface PersonaCard {
  name: string;
  /** Relationship to the user, e.g. "女朋友", "妈妈", "我自己". */
  relation: string;
  summary: string;
  traits: PersonaTrait[];
  /** How TA addresses the user. */
  addressing: string[];
  taboos: string[];
  /** Free-form notes the user edited in. */
  userNotes: string;
  updatedAt: number;
}

// ---------- Character & consent ----------

export type SubjectStatus = "self" | "living" | "deceased";

export interface ConsentRecord {
  subject: SubjectStatus;
  /** Who TA is, as declared by the user. */
  subjectName: string;
  relation: string;
  /** Living: whether TA has agreed. Deceased: declarant is next of kin. */
  subjectConsented: boolean;
  personalUseOnly: boolean;
  /** Separate consent for voice (biometric) data, P3. */
  voiceConsent: boolean;
  declaredAt: number;
  /** User's age declaration; under 18 blocks companion / family roles. */
  ageAdult: boolean;
}

export interface Character {
  id: string;
  name: string;
  consent: ConsentRecord;
  persona?: PersonaCard;
  style?: StyleProfile;
  /** Avatar skin id under public/avatar/. */
  avatar: string;
  createdAt: number;
  /** Grief-friendly mode, defaulted on for deceased subjects. */
  gentleMode: boolean;
  archived: boolean;
}

// ---------- Dialogue ----------

export type Emotion = "neutral" | "happy" | "sad" | "angry" | "surprised" | "shy" | "thinking";

/** Structured reply the dialogue engine returns to the UI. */
export interface PetReply {
  /** Burst of messages, shown one bubble at a time. */
  messages: string[];
  emotion: Emotion;
  /** Set when the safety layer replaced the in-character reply. */
  safety?: "crisis" | "ai-identity" | "blocked";
}

export interface DialogueTurn {
  role: "user" | "pet";
  text: string;
  ts: number;
}

// ---------- LLM ----------

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmRequest {
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Ask the provider for a JSON object response. */
  json?: boolean;
}

/**
 * Transport to an OpenAI-compatible chat API. The real implementation lives in
 * Rust (API key never reaches the webview); tests inject a fake.
 */
export interface LlmClient {
  complete(req: LlmRequest): Promise<string>;
  stream?(req: LlmRequest, onDelta: (text: string) => void): Promise<string>;
}

export interface LlmSettings {
  /** e.g. https://api.deepseek.com/v1 */
  baseUrl: string;
  model: string;
  /** True once a key is stored in the vault; the key itself is never exposed to TS. */
  hasKey: boolean;
}
