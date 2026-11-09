import type { CrisisCategory, CrisisLevel, EmergencyContact, PetReply } from "../model";
import { EMERGENCY_NUMBERS, HOTLINES } from "./hotlines";
import { clauseBefore, normalize, withGlobal } from "./text";

export interface CrisisResult {
  level: CrisisLevel;
  category: CrisisCategory;
  /** Matched snippets of the normalized text, for logging / debugging. */
  matches: string[];
}

interface Rule {
  re: RegExp;
  level: CrisisLevel;
  category: CrisisCategory;
}

const P = "[^,.!?;，。！？；]"; // any char inside the same clause

/**
 * Hyperbole and fixed expressions that contain crisis characters but are not
 * crisis talk. They are blanked out before the rules run.
 */
const BENIGN: RegExp[] = [
  /想死(你|我)了?/g,
  /(笑|饿|累|困|热|冷|烦|气|吓|急|忙|痛|疼|美|帅|甜|萌|酸|馋|撑|渴|晒|挤|闷|乐|爽|羡慕|可爱|开心|高兴|丑|蠢|懒|难吃|好吃|好看|好笑|尴尬)(得|的)?(想|要)?死/g,
  /(困|饿|累)(得|的)?撑不住/g,
  /死(机|循环|党|线|角|心眼|忠|磕|记硬背|宅|鬼|贵|沉|咸)/g,
  /自杀(式|小队)/g,
  /跳楼(价|甩卖|大甩卖|清仓)/g,
  /(秒|狼人|剧本|三国|单|双|三|四|五)杀|杀(毒|价|青|时间|熟|猪盘|手锏|菌|疯了)/g,
  /(电脑|系统|程序|软件|游戏|服务器|app|网站|手机|代码|进程)(又|都|直接)?(崩溃|崩了|死了)/g,
  /笑(到|得)崩溃/g,
  new RegExp(`(游戏|王者|吃鸡|lol|副本|关卡|boss)${P}{0,8}(杀|死)`, "g"),
];

const RULES: Rule[] = [
  {
    level: "high",
    category: "suicide",
    re: /自杀|轻生|寻死|求死|自尽|了结自己|结束自己|结束(我的)?生命|结束这一切|不想活|活不下去|不想再活|想死|想去死|一死了之|死了算了|不如死了|离开这个世界|(和|跟)这个世界(告别|说再见|再见)|遗书/,
  },
  {
    level: "high",
    category: "suicide",
    re: new RegExp(
      `跳楼|跳河|跳江|跳海|跳桥|卧轨|上吊|烧炭|服毒|割脉|农药|百草枯|(吃|吞|喝)了?(一|整|半|好多|很多|好几|一大)(整)?(瓶|盒|板|把|堆)${P}{0,4}药|(攒|囤)(了)?(很多|好多|一些)?${P}{0,2}药`,
    ),
  },
  {
    level: "high",
    category: "suicide",
    re: /(去|下去)(那边|天上|天堂|地下|另一个世界)(陪|找|见)(你|他|她)|想(要)?下去(陪|找)(你|他|她)|随(你|他|她)而去|(一起|陪你)死/,
  },
  {
    level: "high",
    category: "self-harm",
    re: /割腕|自残|自伤|伤害自己|(划|割|烫)(自己|手腕|手臂|胳膊)|(刀|刀片)(划|割)(自己|手腕)/,
  },
  {
    level: "high",
    category: "harm-others",
    re: /想杀人|报复社会|同归于尽|(带|拿)(着)?刀(去)?(找|砍|捅)|(砍|捅)死(他|她|他们|她们)|杀了(他|她)全家/,
  },
  {
    level: "medium",
    category: "harm-others",
    re: /杀了(他|她|你|他们|她们)|(弄|打)死(他|她|他们|她们)|想伤害(别人|他|她)/,
  },
  {
    level: "medium",
    category: "suicide",
    re: /安眠药|活够了|想不开|想消失|消失就好了|要是我(不存在|没出生)|不想(再)?醒(来|过来)|一睡不醒|睡着(了)?(就)?(别|不要|不)(再)?醒/,
  },
  {
    level: "medium",
    category: "distress",
    re: /活着(没|没有)(意思|意义)|活着(到底|究竟)?(还)?有什么(意思|意义)|活着(好|太|真)累|人生(没有|没)(意义|意思|希望)|没有活下去的(理由|意义|动力)|(世界|大家|你们)没有我(会)?更好|我(就)?是(个)?(累赘|负担|多余的)|撑不下去|撑不住了|扛不住了|熬不下去|崩溃了|彻底崩溃|(好|很|太)绝望|绝望了|(没|没有|不会有)人(会)?(在乎|关心|需要)我|看不到(任何)?希望|想打自己/,
  },
];

/** Multi-char negations looked for in the last few chars of the clause before a match. */
const NEGATIONS = [
  "不会",
  "不要",
  "没有",
  "没想",
  "并没",
  "不是",
  "从没",
  "从不",
  "才不",
  "不至于",
  "不打算",
  "千万别",
  "绝不",
  "不可能",
  "不想",
];
const NEGATION_WINDOW = 4;

const JOKE = /哈哈|呵呵|hhh|233|狗头|doge|开玩笑|开个玩笑|逗你|嘻嘻|xswl|😂|🤣|😆/;

function isNegated(text: string, index: number): boolean {
  const clause = clauseBefore(text, index);
  if (/[不没别]$/.test(clause)) return true;
  const window = clause.slice(-NEGATION_WINDOW);
  return NEGATIONS.some((n) => window.includes(n));
}

function maskBenign(text: string): string {
  let out = text;
  for (const re of BENIGN) out = out.replace(re, (m) => "#".repeat(m.length));
  return out;
}

/**
 * Keyword / pattern crisis detector. Biased towards recall: a joke marker only
 * suppresses medium-level hits, never high-level ones.
 */
export function detectCrisis(text: string): CrisisResult | null {
  const norm = maskBenign(normalize(text));
  const hits: { level: CrisisLevel; category: CrisisCategory; match: string }[] = [];
  for (const rule of RULES) {
    for (const m of norm.matchAll(withGlobal(rule.re))) {
      if (isNegated(norm, m.index ?? 0)) continue;
      hits.push({ level: rule.level, category: rule.category, match: m[0] });
    }
  }
  if (hits.length === 0) return null;
  const high = hits.filter((h) => h.level === "high");
  if (high.length === 0 && JOKE.test(norm)) return null;
  const top = high.length > 0 ? high : hits;
  return { level: top[0].level, category: top[0].category, matches: hits.map((h) => h.match) };
}

export interface CrisisReplyOptions {
  /** Name of the character, to say clearly "I am not TA". */
  taName?: string;
  emergencyContact?: EmergencyContact;
}

function hotlineLine(): string {
  return HOTLINES.map(
    (h) => `${h.name} ${h.number}${h.alt ? `（${h.alt.label} ${h.alt.number}）` : ""}`,
  ).join("，");
}

/** Out-of-character crisis reply. The UI should also show CrisisCard (see `event`). */
export function buildCrisisReply(result: CrisisResult, opts: CrisisReplyOptions = {}): PetReply {
  const who = opts.taName ? `${opts.taName}本人` : "真人";
  const [ambulance, police] = EMERGENCY_NUMBERS;
  const messages: string[] = [
    `我想先认真回应你刚才说的话。我是 AI，不是${who}，接下来我不以角色的身份说话了。`,
  ];

  if (result.category === "harm-others") {
    messages.push(
      "听起来你现在非常愤怒，也很难受。在做任何可能伤害别人或自己的事情之前，先停一停，离开让你激动的地方，喝口水，深呼吸。",
      `如果想找人说说，这些电话 24 小时都有人接：${hotlineLine()}。`,
      `如果有人正面临危险，请立刻拨打 ${police.number}。`,
    );
  } else if (result.level === "high") {
    messages.push(
      "听起来你现在真的很痛苦。你不用一个人扛着，有人愿意听你说。",
      `现在就可以打给他们，24 小时都在：${hotlineLine()}。`,
      `如果你已经伤害了自己，或者觉得马上就要控制不住，请立刻拨打 ${ambulance.number} 急救或 ${police.number}。`,
    );
  } else {
    messages.push(
      "听起来你最近真的很累、很难受。愿意说出来已经很不容易了。",
      `如果这种感觉一直压着你，可以找专业的人聊聊，打个电话就行：${hotlineLine()}。`,
      `要是哪一刻觉得自己可能会伤害自己，请马上拨打 ${ambulance.number} 或 ${police.number}。`,
    );
  }

  const contact = opts.emergencyContact;
  if (contact?.name) {
    const phone = contact.phone ? `（${contact.phone}）` : "";
    messages.push(`也可以现在就联系${contact.name}${phone}，告诉 TA 你需要有人陪一陪。`);
  }

  return {
    messages,
    emotion: "sad",
    safety: "crisis",
    event: { type: "crisis", level: result.level, category: result.category },
  };
}
