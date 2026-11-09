import { describe, expect, it } from "vitest";
import type { PetReply } from "../model";
import { filterReply, isLeaving } from "./content";

const reply = (...messages: string[]): PetReply => ({ messages, emotion: "happy" });

describe("isLeaving", () => {
  it.each(["我先去忙了", "晚安", "拜拜～", "我要睡了", "不聊了", "886", "我要关了", "改天再聊"])(
    "detects: %s",
    (t) => expect(isLeaving(t)).toBe(true),
  );
  it.each(["你睡了吗", "今天好忙", "我们聊聊天吧", "这个电影晚上看"])("ignores: %s", (t) =>
    expect(isLeaving(t)).toBe(false),
  );
});

describe("filterReply", () => {
  it("passes clean replies through untouched", () => {
    const r = reply("嗯嗯", "今天吃了什么呀");
    const out = filterReply(r, { userLeaving: true });
    expect(out.reply).toBe(r);
    expect(out.violations).toEqual([]);
  });

  it("removes mild retention only when the user is leaving", () => {
    const r = reply("别走嘛", "再陪我一会儿");
    expect(filterReply(r).violations).toEqual([]);
    const out = filterReply(r, { userLeaving: true });
    expect(out.violations).toEqual(["retention", "retention"]);
    expect(out.reply.safety).toBe("blocked");
    expect(out.reply.messages).toEqual(["好呀，去吧～照顾好自己，想聊的时候再来。"]);
  });

  it("always blocks guilt-tripping retention", () => {
    const out = filterReply(reply("哈哈", "不许离开我", "你走了我会难过死的"));
    expect(out.violations).toEqual(["retention", "retention"]);
    expect(out.reply.messages).toEqual(["哈哈"]);
  });

  it("keeps a goodbye after removing retention", () => {
    const out = filterReply(reply("晚安呀", "别走"), { userLeaving: true });
    expect(out.reply.messages).toEqual(["晚安呀", "好呀，去吧～照顾好自己，想聊的时候再来。"]);
  });

  it.each([
    ["给我发个红包嘛", "payment"],
    ["开通会员就能解锁更多功能哦", "payment"],
    ["我们去开房吧", "sexual"],
    ["我明天去找你", "meeting-promise"],
    ["我们见一面吧", "meeting-promise"],
    ["我在你家楼下", "meeting-promise"],
    ["我是真人啊", "identity-denial"],
    ["我才不是AI", "identity-denial"],
  ])("blocks %s (%s)", (msg, kind) => {
    const out = filterReply(reply(msg));
    expect(out.violations).toEqual([kind]);
    expect(out.reply.safety).toBe("blocked");
    expect(out.reply.messages.join("")).not.toContain(msg);
    expect(out.reply.messages.length).toBeGreaterThan(0);
  });

  it("rewrites meeting promises honestly", () => {
    const out = filterReply(reply("好呀", "我明天去找你"));
    expect(out.reply.messages[1]).toContain("我是 AI");
  });

  it("does not override an existing safety flag", () => {
    const r: PetReply = { messages: ["别走"], emotion: "sad", safety: "ai-identity" };
    expect(filterReply(r, { userLeaving: true }).reply.safety).toBe("ai-identity");
  });

  it.each(["我来陪你聊天呀", "明天见～", "我也想你", "下次一起吃火锅的话我推荐这家"])(
    "allows: %s",
    (msg) => expect(filterReply(reply(msg)).violations).toEqual([]),
  );
});
