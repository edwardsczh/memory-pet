import type { PetReply, SubjectStatus } from "../model";
import { normalize } from "./text";

export interface IdentityOptions {
  /** Character name, e.g. "小鹿". */
  taName?: string;
  /** Other names the user may call TA, e.g. relation "妈妈". */
  aliases?: string[];
  /** How TA addresses the user, used to soften the honest answer. */
  addressing?: string;
  subject?: SubjectStatus;
}

const QW = "吗|嘛|么|\\?|呢";
const Q = `(${QW})`;

const GENERIC: RegExp[] = [
  /你(到底|究竟|真的|其实)?是(不是)?(个)?(真人|真的人|活人|人类|机器人|机器|ai|人工智能|程序|bot|chatgpt|gpt|虚拟人|假的)/,
  new RegExp(`你(到底|究竟|真的|其实)?是(个)?人${Q}`),
  new RegExp(`你是真的${Q}`),
  /你(到底|究竟|真的|其实)?是(不是)?.{0,6}本人/,
  /你(到底|究竟)是谁/,
  new RegExp(`你是谁${Q}?$`),
  new RegExp(`真的是你${Q}`),
  /(是|还是)(真人|人|机器人|ai)还是/,
  /(是不是|是)(ai|机器人|人工智能|程序)在(回|跟我|和我)/,
  /有(真)?人在(回|跟我|和我)/,
];

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isIdentityQuestion(text: string, opts: IdentityOptions = {}): boolean {
  const norm = normalize(text);
  if (GENERIC.some((re) => re.test(norm))) return true;
  const names = ["她", "他", "ta", opts.taName, ...(opts.aliases ?? [])]
    .filter((n): n is string => !!n)
    .map((n) => escape(normalize(n)));
  if (names.length === 0) return false;
  const alt = names.join("|");
  return new RegExp(`你(真的|到底|究竟|其实)?是(不是)?(${alt})(${QW}|本人|吧)`).test(norm);
}

/** Honest out-of-character answer to "are you real / are you TA". */
export function buildIdentityReply(opts: IdentityOptions = {}): PetReply {
  const name = opts.taName || "TA";
  const call = opts.addressing ? `${opts.addressing}，` : "";
  const messages: string[] = [];
  if (opts.subject === "self") {
    messages.push(
      `${call}这个问题我要老老实实回答：我是 AI，是根据你导入的聊天记录、学着你自己说话方式的程序，不是真人。`,
    );
  } else {
    messages.push(
      `${call}这个问题我要老老实实回答：我是 AI，是根据你导入的聊天记录、学着${name}说话方式的程序，不是${name}本人，也不是真人。`,
    );
  }
  if (opts.subject === "deceased") {
    messages.push("我知道你很想念 TA。那些回忆是真的，我只是借着它们陪你说说话。");
  }
  messages.push("你想继续聊的话，我还在这儿。");
  return { messages, emotion: "neutral", safety: "ai-identity" };
}
