/**
 * Writes the small per-format parser fixtures under fixtures/formats/.
 * Everything is fictional: 阿哲 / 小鹿 / 群友 are made-up people, phone
 * numbers, ID and card numbers are well-known test values.
 *
 * Run: node scripts/gen-format-fixtures.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Conversation,
  type DemoKind,
  type DemoMessage,
  cst,
  writeChatlogKeeperQQ,
  writeChatlogKeeperWechat,
  writeGenericCsv,
  writeGenericJson,
  writePlainBracket,
  writePlainInline,
  writePlainSenderTime,
  writeQQMht,
  writeQQTxt,
  writeWechatExporterJson,
  writeWechatExporterTxt,
  writeWxCliJson,
  writeWxCliLegacyJson,
  writeWxCliMarkdown,
  writeWxCliTxt,
} from "./fixture-writers.ts";

const ME = "阿哲";
const TA = "小鹿";

type Line = [minuteOffset: number, sender: string, kind: DemoKind, text: string];

function build(day: [number, number, number, number, number], lines: Line[]): DemoMessage[] {
  const [y, m, d, h, min] = day;
  const base = cst(y, m, d, h, min);
  let prevOff = -1;
  let n = 0;
  return lines.map(([off, sender, kind, text]) => {
    n = off === prevOff ? n + 1 : 0;
    prevOff = off;
    return { ts: base + off * 60_000 + n * 9_000, sender, kind, text };
  });
}

// 2024-05-20 evening, then a short follow-up the next morning after a 10h gap.
const PRIVATE: Line[] = [
  [0, ME, "text", "在干嘛呢"],
  [1, TA, "text", "刚洗完澡～"],
  [1, TA, "text", "哲哲今天是什么日子嘛"],
  [1, TA, "sticker", ""],
  [2, ME, "text", "520呀 我记得的"],
  [3, ME, "transfer", "红包 5.20"],
  [3, TA, "text", "hhh算你有良心"],
  [4, TA, "text", "我也有东西给你"],
  [4, TA, "image", ""],
  [5, TA, "text", "是团子！给你拍的"],
  [5, TA, "text", "它今天又把我的奶茶打翻了"],
  [6, ME, "text", "哈哈哈 团子真是个小祖宗"],
  [7, TA, "text", "不许笑嘛"],
  [7, TA, "recall", ""],
  [8, TA, "text", "没什么 发错了"],
  [9, ME, "voice", ""],
  [10, TA, "text", "听到啦 笨蛋"],
  [11, TA, "text", "对了我换手机号了 新号是 13800138000 你存一下"],
  [11, TA, "text", "快递地址也改成 青岛市市南区示例路1号 吧"],
  [12, ME, "text", "好 我邮箱 azhe.demo@example.com 你也记一下"],
  [13, TA, "text", "门禁密码是 2580 别忘了"],
  [14, ME, "text", "我的卡号 4111 1111 1111 1111 你帮我填一下"],
  [15, TA, "text", "身份证号也发我 11010519491231002X 是这个吧"],
  [16, TA, "link", "猫咪生病的十个信号"],
  [17, TA, "text", "这个你看看～"],
  [18, ME, "file", "团子疫苗记录.pdf"],
  [19, ME, "text", "晚安鹿鹿"],
  [19, TA, "text", "晚安哲哲～"],
  [19, TA, "text", "梦里见"],
  [620, TA, "text", "早呀～"],
  [621, TA, "text", "今天要去图书馆嘛"],
  [625, ME, "text", "早 我在地铁上"],
];

const GROUP: Line[] = [
  [0, "大熊", "system", '"大熊"邀请"糖糖"加入了群聊'],
  [1, "大熊", "text", "周六谁来玩桌游"],
  [2, "糖糖", "text", "我我我"],
  [3, TA, "text", "@大熊\u2005带上我和哲哲～"],
  [4, ME, "text", "我可以 几点"],
  [5, "大熊", "text", "下午两点 老地方"],
  [6, "糖糖", "text", "@小鹿\u2005你上次欠我一杯奶茶hhh"],
  [7, TA, "text", "记着呢嘛 @糖糖\u2005这次请你"],
  [8, ME, "text", "@阿May\u2005你来不来"],
  [9, "大熊", "transfer", "红包 0.88"],
  [10, TA, "text", "谢谢老板～"],
];

const ids: Record<string, string> = {
  [ME]: "wxid_azhe_demo",
  [TA]: "wxid_xiaolu_demo",
  大熊: "wxid_daxiong_demo",
  糖糖: "wxid_tangtang_demo",
};

const privateChat: Conversation = {
  title: TA,
  self: ME,
  isGroup: false,
  ids,
  messages: build([2024, 5, 20, 21, 3], PRIVATE),
};

const groupChat: Conversation = {
  title: "周末桌游群",
  self: ME,
  isGroup: true,
  ids: { ...ids, 周末桌游群: "10000000001@chatroom" },
  messages: build([2024, 5, 22, 19, 30], GROUP),
};

const qqChat: Conversation = { ...privateChat, ids: { [ME]: "1000001", [TA]: "1000002" } };

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "formats");
mkdirSync(root, { recursive: true });
const files: Record<string, string> = {
  "chatlog-keeper-wechat.json": writeChatlogKeeperWechat(
    [privateChat, groupChat],
    "wxid_azhe_demo",
  ),
  "chatlog-keeper-qq.json": writeChatlogKeeperQQ(qqChat, "1000001"),
  "wechat-exporter.json": writeWechatExporterJson(privateChat),
  "wechat-exporter.txt": writeWechatExporterTxt(privateChat),
  "wx-cli.json": writeWxCliJson(privateChat),
  "wx-cli.txt": writeWxCliTxt(privateChat),
  "wx-cli-legacy.json": writeWxCliLegacyJson(privateChat),
  "wx-cli-legacy-group.json": writeWxCliLegacyJson(groupChat),
  "wx-cli-legacy.md": writeWxCliMarkdown(privateChat),
  "qq-legacy.txt": writeQQTxt(qqChat),
  "qq-legacy.mht": writeQQMht(qqChat),
  "generic.csv": writeGenericCsv(privateChat),
  "generic.json": writeGenericJson(privateChat),
  "plain-inline.txt": writePlainInline(privateChat),
  "plain-bracket.txt": writePlainBracket(privateChat),
  "plain-sender-time.txt": writePlainSenderTime(privateChat),
};
for (const [name, content] of Object.entries(files)) writeFileSync(join(root, name), content);
console.log(`wrote ${Object.keys(files).length} fixtures to ${root}`);
