import { describe, expect, it } from "vitest";
import type { RedactionKind } from "../model";
import { isValidIdCard, luhnValid, redact } from "./redact";

// Synthetic test values only: check digits are computed, prefixes and dates are made up.
function idCard(first17: string): string {
  const w = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += +first17[i] * w[i];
  return first17 + "10X98765432"[sum % 11];
}

function card(prefix: string, length: number): string {
  let body = prefix.padEnd(length - 1, "0");
  for (let d = 0; d <= 9; d++) if (luhnValid(body + d)) return body + d;
  body = "";
  return body;
}

const group4 = (s: string, sep = " ") => s.replace(/(\d{4})(?=\d)/g, `$1${sep}`);

interface Sample {
  text: string;
  secrets: [RedactionKind, string][];
}

const ID = [
  idCard("11010519491231002"),
  idCard("37010219980315123"),
  idCard("32010620010808456"),
  idCard("44030519990101789"),
  idCard("51010720000229001"),
  idCard("33010619951111222"),
  idCard("12010119880707333"),
  idCard("21010219920520444"),
];
const CARDS = [
  card("411111111111111", 16),
  card("622200000000000", 16),
  card("622848000000000000", 19),
  card("621700000000000", 16),
  card("552200000000000", 16),
  card("620000000000000000", 19),
  card("436742000000000", 16),
  card("625800000000000000", 19),
];

const SAMPLES: Sample[] = [
  // phone
  { text: "我电话13800138000", secrets: [["phone", "13800138000"]] },
  { text: "打我手机 139 0000 0000", secrets: [["phone", "139 0000 0000"]] },
  { text: "+86 13700001111 这个是我新号", secrets: [["phone", "13700001111"]] },
  { text: "号码是158-0000-1234", secrets: [["phone", "158-0000-1234"]] },
  { text: "有事call我18600000000", secrets: [["phone", "18600000000"]] },
  { text: "8613500001234", secrets: [["phone", "13500001234"]] },
  { text: "联系人 张三 15000000000 收", secrets: [["phone", "15000000000"]] },
  { text: "座机 010-12345678", secrets: [["phone", "010-12345678"]] },
  { text: "公司电话(021)55556666", secrets: [["phone", "55556666"]] },
  { text: "前台 0755-88889999 转 123", secrets: [["phone", "0755-88889999"]] },
  { text: "新号码:17700000000～", secrets: [["phone", "17700000000"]] },
  { text: "手机号是19900001111嘛", secrets: [["phone", "19900001111"]] },
  { text: "你打13600001234试试", secrets: [["phone", "13600001234"]] },
  { text: "13300009999是我妈的号", secrets: [["phone", "13300009999"]] },
  { text: "我换号了 147 0000 2222", secrets: [["phone", "147 0000 2222"]] },
  { text: "电话：16600003333", secrets: [["phone", "16600003333"]] },
  { text: "微信同号18200005555", secrets: [["phone", "18200005555"]] },
  { text: "快递员电话 13100006666 他说到楼下了", secrets: [["phone", "13100006666"]] },
  { text: "紧急联系人：15500007777", secrets: [["phone", "15500007777"]] },
  { text: "0086-138-0000-8888", secrets: [["phone", "138-0000-8888"]] },
  // email
  { text: "我邮箱 xiaolu.demo@example.com", secrets: [["email", "xiaolu.demo@example.com"]] },
  { text: "my mail is azhe_01@test.cn", secrets: [["email", "azhe_01@test.cn"]] },
  { text: "发到 demo+tag@mail.example.org", secrets: [["email", "demo+tag@mail.example.org"]] },
  { text: "邮箱：fake123@qq.com", secrets: [["email", "fake123@qq.com"]] },
  { text: "foo.bar@163.com 收一下", secrets: [["email", "foo.bar@163.com"]] },
  {
    text: "学校邮箱s2024001@stu.example.edu.cn",
    secrets: [["email", "s2024001@stu.example.edu.cn"]],
  },
  { text: "简历发我 hr-demo@example.net 谢谢", secrets: [["email", "hr-demo@example.net"]] },
  { text: "Aa.Bb@Example.COM", secrets: [["email", "Aa.Bb@Example.COM"]] },
  { text: "工作邮箱zhe.a@company.example.co", secrets: [["email", "zhe.a@company.example.co"]] },
  {
    text: "test@example.co.uk和another@example.jp",
    secrets: [
      ["email", "test@example.co.uk"],
      ["email", "another@example.jp"],
    ],
  },
  // ID card
  { text: `身份证 ${ID[0]}`, secrets: [["idcard", ID[0]]] },
  { text: `${ID[1]} 是我的身份证号`, secrets: [["idcard", ID[1]]] },
  { text: `身份证号：${ID[2]}`, secrets: [["idcard", ID[2]]] },
  { text: `帮我填一下${ID[3]}`, secrets: [["idcard", ID[3]]] },
  {
    text: `${ID[4].slice(0, 6)} ${ID[4].slice(6, 14)} ${ID[4].slice(14)}`,
    secrets: [["idcard", ID[4].slice(6, 14)]],
  },
  { text: `证件号${ID[5].toLowerCase()}`, secrets: [["idcard", ID[5].slice(0, 17)]] },
  { text: `订票要用 ${ID[6]} 记得`, secrets: [["idcard", ID[6]]] },
  { text: `身份证${ID[7]}，姓名小鹿`, secrets: [["idcard", ID[7]]] },
  // bank card
  { text: `卡号 ${CARDS[0]}`, secrets: [["bankcard", CARDS[0]]] },
  { text: `${group4(CARDS[1])} 这张卡`, secrets: [["bankcard", group4(CARDS[1])]] },
  { text: `工资卡${CARDS[2]}`, secrets: [["bankcard", CARDS[2]]] },
  { text: `转到 ${group4(CARDS[3], "-")}`, secrets: [["bankcard", group4(CARDS[3], "-")]] },
  { text: `信用卡${CARDS[4]}别告诉别人`, secrets: [["bankcard", CARDS[4]]] },
  { text: `银行卡：${group4(CARDS[5])}`, secrets: [["bankcard", CARDS[5].slice(4, 8)]] },
  { text: `${CARDS[6]}`, secrets: [["bankcard", CARDS[6]]] },
  { text: `我的卡是${CARDS[7]}～`, secrets: [["bankcard", CARDS[7]]] },
  // address
  { text: "寄到 北京市朝阳区建国路88号", secrets: [["address", "建国路88号"]] },
  {
    text: "青岛市市南区香港中路10号3栋2单元501",
    secrets: [
      ["address", "香港中路10号"],
      ["address", "501"],
    ],
  },
  { text: "我家在杭州市西湖区文三路100号", secrets: [["address", "文三路100号"]] },
  { text: "上海市浦东新区世纪大道1000号", secrets: [["address", "世纪大道1000号"]] },
  { text: "地址：南京市鼓楼区示例路5号", secrets: [["address", "示例路5号"]] },
  {
    text: "收货地址是 广州市天河区体育西路191号中石化大厦B座",
    secrets: [["address", "体育西路191号"]],
  },
  {
    text: "我住幸福小区5栋302",
    secrets: [
      ["address", "幸福小区5栋"],
      ["address", "302"],
    ],
  },
  {
    text: "阳光花园3栋2单元1201",
    secrets: [
      ["address", "阳光花园3栋"],
      ["address", "1201"],
    ],
  },
  { text: "济南市历下区示例路8号 寄东西寄这里", secrets: [["address", "示例路8号"]] },
  { text: "住址：浙江省杭州市余杭区仓前街道某某社区", secrets: [["address", "仓前街道某某社区"]] },
  { text: "成都市武侯区人民南路四段27号", secrets: [["address", "人民南路四段27号"]] },
  { text: "深圳市南山区科苑路15号", secrets: [["address", "科苑路15号"]] },
  { text: "我搬到长安街12号院3号楼了", secrets: [["address", "长安街12号院3号楼"]] },
  { text: "江苏省苏州市工业园区星湖街328号", secrets: [["address", "星湖街328号"]] },
  { text: "武汉市洪山区珞喻路1037号", secrets: [["address", "珞喻路1037号"]] },
  { text: "到西安市雁塔区小寨东路126号来接我", secrets: [["address", "小寨东路126号"]] },
  { text: "重庆市渝中区解放碑步行街8号", secrets: [["address", "步行街8号"]] },
  { text: "家庭住址：河北省石家庄市长安区中山东路xx号", secrets: [["address", "中山东路"]] },
  { text: "天津市和平区南京路219号", secrets: [["address", "南京路219号"]] },
  { text: "厦门市思明区演武路8号", secrets: [["address", "演武路8号"]] },
  { text: "快递放到翠苑小区12幢3单元", secrets: [["address", "翠苑小区12幢"]] },
  { text: "广东省深圳市福田区华强北路1002号赛格广场", secrets: [["address", "华强北路1002号"]] },
  // secrets
  { text: "密码是 abc12345", secrets: [["password", "abc12345"]] },
  { text: "wifi密码：88889999", secrets: [["password", "88889999"]] },
  { text: "验证码 123456", secrets: [["password", "123456"]] },
  { text: "验证码是4821", secrets: [["password", "4821"]] },
  { text: "【示例银行】您的验证码为556677，请勿泄露", secrets: [["password", "556677"]] },
  { text: "123456是你的验证码", secrets: [["password", "123456"]] },
  { text: "支付密码 135790", secrets: [["password", "135790"]] },
  { text: "密码 woaini520", secrets: [["password", "woaini520"]] },
  { text: "门禁密码是2580", secrets: [["password", "2580"]] },
  { text: "取件码 6-2-3003", secrets: [["password", "6-2-3003"]] },
  { text: "PIN码 0000", secrets: [["password", "0000"]] },
  { text: "password: Hello2024!", secrets: [["password", "Hello2024!"]] },
  { text: "pwd=qwer1234", secrets: [["password", "qwer1234"]] },
  { text: "开机密码是19990101", secrets: [["password", "19990101"]] },
  { text: "锁屏密码改成了 147258", secrets: [["password", "147258"]] },
  { text: "提取码：a1b2", secrets: [["password", "a1b2"]] },
  // mixed
  {
    text: `我换号了13900000000，邮箱xl@example.com，卡号${CARDS[0]}`,
    secrets: [
      ["phone", "13900000000"],
      ["email", "xl@example.com"],
      ["bankcard", CARDS[0]],
    ],
  },
];

const NEGATIVES = [
  "我们 2024 年 5 月 20 号见",
  "今天走了12000步",
  "等我10:30",
  "价格199元 好贵",
  "第3栋教学楼上课",
  "我在路上了",
  "@糖糖 你好呀",
  "这道题答案是42",
  "坐3号线过去",
  "考了98分hhh",
  "密码学这门课好难",
  "code review 好累",
  "房间号是302",
  "身高165",
  "去年8月去青岛看海",
  "我住在学校附近",
  "下午3点到5点有课",
  "这周走了 8 公里",
  "电量还剩 20%",
  "2024-05-20 是我们的纪念日",
  "订单 1234567890",
  "等我5分钟",
  "第二次看海还是好激动",
  "团子十二斤了",
  "一周年快乐～",
  "这里3号见",
  "生日是0326",
  "去年在路上捡到一只猫",
  "我家楼下新开了一家奶茶店",
  "QQ号123456789",
];

describe("redact", () => {
  it(`recall on the labelled set is ≥ 95% (${SAMPLES.length} samples)`, () => {
    let total = 0;
    let found = 0;
    const missed: string[] = [];
    const perKind: Partial<Record<RedactionKind, [number, number]>> = {};
    for (const s of SAMPLES) {
      const r = redact(s.text);
      for (const [kind, value] of s.secrets) {
        total++;
        const stat = (perKind[kind] ??= [0, 0]);
        stat[1]++;
        if (!r.text.includes(value) && (r.counts[kind] ?? 0) > 0) {
          found++;
          stat[0]++;
        } else missed.push(`${kind}: ${s.text} -> ${r.text}`);
      }
    }
    const recall = found / total;
    console.log(
      `redaction recall ${(recall * 100).toFixed(1)}% (${found}/${total})`,
      Object.fromEntries(Object.entries(perKind).map(([k, [f, t]]) => [k, `${f}/${t}`])),
      missed.length ? `missed: ${missed.join(" | ")}` : "",
    );
    expect(recall).toBeGreaterThanOrEqual(0.95);
  });

  it("leaves ordinary chat lines alone", () => {
    const changed = NEGATIVES.filter((t) => redact(t).text !== t).map(
      (t) => `${t} -> ${redact(t).text}`,
    );
    expect(changed).toEqual([]);
  });

  it("uses readable labels and keeps the keyword for secrets", () => {
    expect(redact("我电话13800138000").text).toBe("我电话[手机号]");
    expect(redact("验证码是4821").text).toBe("验证码是[密码]");
    expect(redact(`身份证 ${ID[0]}`).text).toBe("身份证 [身份证号]");
    expect(redact("我邮箱 a@example.com").text).toBe("我邮箱 [邮箱]");
    expect(redact("寄到 北京市朝阳区建国路88号").text).toBe("寄到 [地址]");
  });

  it("validates ID card check digits and Luhn", () => {
    expect(isValidIdCard("11010519491231002X")).toBe(true);
    expect(isValidIdCard("110105194912310021")).toBe(false);
    expect(isValidIdCard(idCard("11010520230230001"))).toBe(false);
    expect(luhnValid("4111111111111111")).toBe(true);
    expect(luhnValid("4111111111111112")).toBe(false);
    expect(redact("编号 4111111111111112").counts.bankcard).toBeUndefined();
  });
});
