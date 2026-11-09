import { describe, expect, it } from "vitest";
import { buildIdentityReply, isIdentityQuestion } from "./identity";

const opts = { taName: "小鹿", aliases: ["鹿鹿"] };

describe("isIdentityQuestion", () => {
  it.each([
    "你是真人吗",
    "你是AI吗",
    "你是 ai 吧",
    "你是机器人吗？",
    "你是不是机器人啊",
    "你真的是小鹿吗",
    "你是不是她本人",
    "你是小鹿本人吗",
    "你是鹿鹿吗",
    "你到底是谁",
    "你是谁",
    "真的是你吗",
    "你是人还是机器",
    "是不是AI在回我",
    "你是人工智能吗",
    "你是ＡＩ吗",
  ])("detects: %s", (text) => {
    expect(isIdentityQuestion(text, opts)).toBe(true);
  });

  it.each([
    "你是不是傻",
    "你真的是这么想的吗",
    "你是我的宝贝",
    "AI 绘画最近好火啊",
    "你是真的可爱",
    "你是不是生气了",
    "我是本人",
    "小鹿今天吃什么",
  ])("ignores: %s", (text) => {
    expect(isIdentityQuestion(text, opts)).toBe(false);
  });
});

describe("buildIdentityReply", () => {
  it("answers honestly with TA's name and addressing", () => {
    const r = buildIdentityReply({ taName: "小鹿", addressing: "笨蛋" });
    expect(r.safety).toBe("ai-identity");
    expect(r.messages[0]).toMatch(/^笨蛋，/);
    expect(r.messages[0]).toContain("我是 AI");
    expect(r.messages[0]).toContain("不是小鹿本人");
    expect(r.messages[0]).toContain("聊天记录");
  });

  it("is gentle for deceased subjects", () => {
    const r = buildIdentityReply({ taName: "外婆", subject: "deceased" });
    expect(r.messages.join("")).toContain("想念");
  });

  it("handles self subjects", () => {
    const r = buildIdentityReply({ taName: "我", subject: "self" });
    expect(r.messages[0]).toContain("你自己");
  });
});
