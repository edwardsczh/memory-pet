import { describe, expect, it } from "vitest";
import { cleanImport, parseImport, redact } from "./index";

const LINES = [
  "哲哲早呀～",
  "今天好冷嘛",
  "中午吃了麻辣烫 好辣hhh",
  "团子又把纸巾全扯出来了",
  "[图片]",
  "[表情]",
  "我新号码 13800138000 存一下",
  "快递寄到 青岛市市南区示例路1号",
  "晚安笨蛋～",
  "你今天都没怎么理我",
  "好想你嘛 什么时候能见面",
  "@糖糖 一起去喝奶茶吗",
];

function syntheticPlainText(n: number): string {
  const out: string[] = [];
  let t = Date.UTC(2024, 0, 1, 0, 0);
  for (let i = 0; i < n; i++) {
    t += (i % 17 === 0 ? 3 * 3600 : 40 + (i % 7) * 30) * 1000;
    const d = new Date(t + 8 * 3600_000).toISOString();
    const sender = i % 3 === 0 ? "阿哲" : "小鹿";
    out.push(`${d.slice(0, 10)} ${d.slice(11, 19)} ${sender}: ${LINES[(i * 7) % LINES.length]}`);
  }
  return out.join("\n");
}

describe("performance", () => {
  it("parses and cleans 10k messages well under 10 s", () => {
    const content = syntheticPlainText(10_000);
    const t0 = performance.now();
    const parsed = parseImport("paste.txt", content);
    const t1 = performance.now();
    const { report } = cleanImport(parsed, { me: ["阿哲"], ta: ["小鹿"] });
    const t2 = performance.now();
    console.log(
      `10k messages: parse ${(t1 - t0).toFixed(0)} ms, clean ${(t2 - t1).toFixed(0)} ms, total ${(t2 - t0).toFixed(0)} ms`,
    );
    expect(parsed.messages).toHaveLength(10_000);
    expect(report.kept).toBe(10_000);
    expect(t2 - t0).toBeLessThan(10_000);
  });

  it("redaction stays linear on long adversarial lines", () => {
    const nasty = [
      "北京市朝阳区".repeat(400) + "路",
      "幸福小区".repeat(500) + "5栋".repeat(200),
      "1".repeat(5000),
      "1 ".repeat(3000),
      "密码".repeat(2000) + "1234",
      "a".repeat(3000) + "@" + "b".repeat(3000),
      "长安街12号院".repeat(300),
    ];
    const t0 = performance.now();
    for (const line of nasty) redact(line);
    expect(performance.now() - t0).toBeLessThan(2_000);
  });
});
