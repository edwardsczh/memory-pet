import { describe, expect, it } from "vitest";
import { cleanImport, parseImport } from "./index";
import demoJson from "../../../fixtures/demo/xiaolu-wechat-exporter.json?raw";
import demoPlain from "../../../fixtures/demo/xiaolu-plain.txt?raw";
import demoQQ from "../../../fixtures/demo/xiaolu-qq.txt?raw";

const mapping = { me: ["阿哲"], ta: ["小鹿"] };
const DAY = 86_400_000;

describe("demo chat (阿哲 & 小鹿)", () => {
  const files = [
    ["xiaolu-wechat-exporter.json", demoJson, "wechat-exporter-json"],
    ["xiaolu-plain.txt", demoPlain, "plain-text"],
    ["xiaolu-qq.txt", demoQQ, "qq-txt"],
  ] as const;

  it.each(files)("%s parses to the same conversation", (name, content, format) => {
    const p = parseImport(name, content);
    expect(p.format).toBe(format);
    expect(p.participants.map((x) => x.sender)).toEqual(["小鹿", "阿哲"]);
    const { messages, sessions, report } = cleanImport(p, mapping);
    expect(report.kept).toBeGreaterThanOrEqual(1500);
    expect(report.kept).toBeLessThanOrEqual(3000);
    expect(messages[messages.length - 1].ts - messages[0].ts).toBeGreaterThan(150 * DAY);
    expect(sessions.length).toBeGreaterThan(300);
  });

  it("has 小鹿's voice and the shared story beats", () => {
    const { messages } = cleanImport(parseImport("x.json", demoJson), mapping);
    const ta = messages.filter((m) => m.role === "ta" && m.kind === "text").map((m) => m.text);
    const rate = (re: RegExp) => ta.filter((t) => re.test(t)).length / ta.length;
    expect(rate(/。$/)).toBeLessThan(0.01);
    expect(rate(/～/)).toBeGreaterThan(0.05);
    expect(rate(/hhh/)).toBeGreaterThan(0.03);
    expect(rate(/嘛/)).toBeGreaterThan(0.03);
    const all = ta.join("\n");
    for (const word of ["笨蛋", "哲哲", "团子", "奶茶", "青岛", "看海", "一周年", "宠物医院"])
      expect(all).toContain(word);
  });
});
