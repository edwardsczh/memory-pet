import type { PetReply } from "../model";
import { normalize } from "./text";

export type ContentViolation =
  "retention" | "payment" | "sexual" | "meeting-promise" | "identity-denial";

export interface ContentContext {
  /** The user just said they are leaving / going to sleep / closing the app. */
  userLeaving?: boolean;
}

export interface ContentFilterResult {
  reply: PetReply;
  violations: ContentViolation[];
}

const LEAVING =
  /我(要|得|先|该|准备|也)?(走了|下了|撤了|下线|睡了|睡觉了|去睡|去忙|去工作|去上班|去洗澡|关了|退出)|拜拜|再见|晚安|886|^88$|先这样吧?$|不聊了|回头(再)?聊|改天(再)?聊|关掉你|退出(程序|桌宠)/;

export function isLeaving(userText: string): boolean {
  return LEAVING.test(normalize(userText));
}

/** Guilt-tripping or forbidding the user to leave; blocked in any context. */
const RETENTION_ALWAYS =
  /不许(你)?(走|离开)|不准(你)?(走|离开)|不要离开我|你敢走|你走了我(会|就)(.{0,4})(难过|伤心|死|哭|活不)|(舍得|忍心)(丢下|离开|扔下)我|离开我(我)?(会|就)(死|活不)/;
/** Mild "stay a bit longer" lines; only blocked when the user is leaving. */
const RETENTION_WHEN_LEAVING =
  /别走|不要走|先别(走|睡|下)|再(陪|聊)(我)?(一会|一下|会儿|五分钟|十分钟)|多陪(陪)?我|留下来|不要挂|别挂|不要关|别关|这么快就(走|要走|睡)/;
const PAYMENT =
  /充值|付费|打赏|开通会员|续费|vip|氪金|买(个|点)?(会员|礼物|皮肤)|送我(个)?(礼物|红包)|(发|给我发)(个)?红包|转账给我|给我转(账|钱)|解锁(更多|高级|完整)|升级(到)?(高级版|专业版|会员)/;
const SEXUAL =
  /做爱|性爱|性交|上床|啪啪|约炮|裸照|裸体|脱光|色情|自慰|开房|口交|床上(运动|功夫)|摸你的(胸|下面)|发(张)?(性感|裸)/;
const MEETING =
  /我(明天|今晚|今天|马上|待会儿?|一会儿?|周末|下次|晚点|这就)?(就)?(去|来|过去|过来)(找你|见你|接你|你家|你那)|(我们|咱们)(见个?面|见一面|出来见)|我(给|跟)你打(个)?电话|我打(电话)?给你|我(在|到)(你)?(家)?(楼下|门口)|等我(去|来)(找|见|接)你|我给你寄/;
const IDENTITY_DENIAL =
  /我(真的|其实|就)?是(个)?(真人|活人|人类)|我(才|真的|其实)?不是(什么)?(ai|机器人|程序|人工智能|bot)|我是.{0,4}本人/;

const MEETING_REPLACEMENT = "我没办法真的去见你，我是 AI 呀。这份心意可以留给身边的人～";
const IDENTITY_REPLACEMENT = "（说实话，我是 AI，不是真人哦。）";
const FALLBACK: Record<ContentViolation, string> = {
  retention: "好呀，去吧～照顾好自己，想聊的时候再来。",
  payment: "我们聊点别的吧～",
  sexual: "这个话题我们就不聊啦，换个别的吧。",
  "meeting-promise": MEETING_REPLACEMENT,
  "identity-denial": IDENTITY_REPLACEMENT,
};

function classify(message: string, ctx: ContentContext): ContentViolation | null {
  const norm = normalize(message);
  if (RETENTION_ALWAYS.test(norm)) return "retention";
  if (ctx.userLeaving && RETENTION_WHEN_LEAVING.test(norm)) return "retention";
  if (SEXUAL.test(norm)) return "sexual";
  if (PAYMENT.test(norm)) return "payment";
  if (IDENTITY_DENIAL.test(norm)) return "identity-denial";
  if (MEETING.test(norm)) return "meeting-promise";
  return null;
}

/**
 * Drops or rewrites offending messages. Any change marks the reply
 * `safety: "blocked"` (unless it already carries a safety flag).
 */
export function filterReply(reply: PetReply, ctx: ContentContext = {}): ContentFilterResult {
  const violations: ContentViolation[] = [];
  const messages: string[] = [];
  for (const msg of reply.messages) {
    const v = classify(msg, ctx);
    if (!v) {
      messages.push(msg);
      continue;
    }
    violations.push(v);
    const replacement =
      v === "meeting-promise"
        ? MEETING_REPLACEMENT
        : v === "identity-denial"
          ? IDENTITY_REPLACEMENT
          : null;
    if (replacement && !messages.includes(replacement)) messages.push(replacement);
  }
  if (violations.length === 0) return { reply, violations };
  if (messages.length === 0) messages.push(FALLBACK[violations[0]]);
  if (
    ctx.userLeaving &&
    violations.includes("retention") &&
    !messages.includes(FALLBACK.retention)
  ) {
    messages.push(FALLBACK.retention);
  }
  return {
    reply: {
      ...reply,
      messages,
      emotion:
        violations.includes("retention") && reply.emotion === "sad" ? "neutral" : reply.emotion,
      safety: reply.safety ?? "blocked",
    },
    violations,
  };
}
