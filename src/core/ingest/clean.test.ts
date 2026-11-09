import { describe, expect, it } from "vitest";
import type { ChatMessage, ParsedImport } from "../model";
import { cleanImport, parseImport } from "./index";
import keeperWechat from "../../../fixtures/formats/chatlog-keeper-wechat.json?raw";
import wxCliLegacyGroup from "../../../fixtures/formats/wx-cli-legacy-group.json?raw";
import wxCliJson from "../../../fixtures/formats/wx-cli.json?raw";

const mapping = { me: ["阿哲"], ta: ["小鹿"] };

function imported(messages: Partial<ChatMessage>[]): ParsedImport {
  const full = messages.map((m, i) => ({
    id: `m${i}`,
    ts: 0,
    sender: "小鹿",
    kind: "text" as const,
    text: "",
    ...m,
  }));
  return { format: "plain-text", isGroup: false, participants: [], messages: full, warnings: [] };
}

describe("cleanImport", () => {
  it("filters notices and money, keeps media as content-free placeholders", () => {
    const { messages, report } = cleanImport(parseImport("x.json", wxCliJson), mapping);
    expect(report).toMatchObject({
      total: 32,
      kept: 29,
      droppedByKind: { system: 1, transfer: 1, link: 1 },
      keptByKind: { image: 1, sticker: 1, voice: 1, file: 1 },
      sessions: 2,
    });
    const kinds = new Set(messages.map((m) => m.kind));
    expect(kinds.has("system") || kinds.has("transfer") || kinds.has("link")).toBe(false);
    expect(messages.find((m) => m.kind === "file")?.text).toBe("[文件]");
    expect(messages.every((m) => m.mediaRef === undefined)).toBe(true);
    expect(messages.every((m) => m.role === (m.sender === "阿哲" ? "me" : "ta"))).toBe(true);
  });

  it("redacts by default and can be turned off", () => {
    const parsed = parseImport("x.json", wxCliJson);
    const on = cleanImport(parsed, mapping);
    expect(on.report.redactions).toEqual({
      phone: 1,
      address: 1,
      email: 1,
      password: 1,
      bankcard: 1,
      idcard: 1,
    });
    const joined = on.messages.map((m) => m.text).join("\n");
    for (const secret of [
      "13800138000",
      "示例路1号",
      "azhe.demo@example.com",
      "2580",
      "4111 1111",
      "11010519491231002X",
    ]) {
      expect(joined).not.toContain(secret);
    }
    expect(joined).toContain("新号是 [手机号]");

    const off = cleanImport(parsed, mapping, { redact: false });
    expect(off.report.redactions).toEqual({});
    expect(off.messages.map((m) => m.text).join("\n")).toContain("13800138000");
  });

  it("drops media entirely with keepMedia: false", () => {
    const { report } = cleanImport(parseImport("x.json", wxCliJson), mapping, { keepMedia: false });
    expect(report.kept).toBe(25);
    expect(report.droppedByKind).toMatchObject({ image: 1, sticker: 1, voice: 1, file: 1 });
  });

  it("splits sessions on the idle gap and merges bursts into turns", () => {
    const { sessions } = cleanImport(parseImport("x.json", wxCliJson), mapping);
    expect(sessions).toHaveLength(2);
    const [first, second] = sessions;
    // Dropped red packet / recall / link card no longer split the bursts around them.
    expect(first.turns.map((t) => `${t.role}${t.messages.length}`).join(" ")).toBe(
      "me1 ta3 me1 ta5 me1 ta2 me1 ta3 me1 ta1 me1 ta2 me2 ta2",
    );
    expect(first.turns[1].messages.map((m) => m.text)).toEqual([
      "刚洗完澡～",
      "哲哲今天是什么日子嘛",
      "[表情]",
    ]);
    expect(second.start - first.end).toBeGreaterThan(30 * 60_000);
    expect(second.turns.map((t) => t.role)).toEqual(["ta", "me"]);

    const fine = cleanImport(parseImport("x.json", wxCliJson), mapping, { sessionGapMinutes: 1 });
    expect(fine.sessions.length).toBeGreaterThan(2);
    expect(new Set(fine.sessions.map((s) => s.id)).size).toBe(fine.sessions.length);
  });

  it("sorts by time and removes exact duplicates", () => {
    const t = Date.UTC(2024, 0, 1, 12, 0, 5);
    const parsed = imported([
      { ts: t + 2000, text: "第三" },
      { ts: t, text: "第一" },
      { ts: t + 1000, sender: "阿哲", text: "第二" },
      { ts: t, text: "第一" },
    ]);
    const { messages, report } = cleanImport(parsed, mapping);
    expect(messages.map((m) => m.text)).toEqual(["第一", "第二", "第三"]);
    expect(report.duplicates).toBe(1);
  });

  it("keeps identical messages in minute-precision sources", () => {
    const t = Date.UTC(2024, 0, 1, 12, 0);
    const { messages } = cleanImport(
      imported([
        { ts: t, kind: "image", text: "[图片]" },
        { ts: t, kind: "image", text: "[图片]" },
      ]),
      mapping,
    );
    expect(messages).toHaveLength(2);
  });
});

describe("group chats", () => {
  const parsed = parseImport("x.json", wxCliLegacyGroup);

  it("anonymizes other members and their @mentions", () => {
    const { messages } = cleanImport(parsed, mapping);
    const senders = new Set(messages.map((m) => m.sender));
    expect([...senders].sort()).toEqual(["小鹿", "群友A", "群友B", "阿哲"].sort());
    const texts = messages.map((m) => m.text);
    expect(texts).toContain("@群友A\u2005带上我和哲哲～");
    expect(texts).toContain("@小鹿\u2005你上次欠我一杯奶茶hhh");
    expect(texts).toContain("记着呢嘛 @群友B\u2005这次请你");
    expect(texts).toContain("@群友C\u2005你来不来");
    expect(texts.join()).not.toMatch(/大熊|糖糖|阿May/);
    expect(
      messages.filter((m) => m.role === "other").every((m) => m.sender.startsWith("群友")),
    ).toBe(true);
  });

  it("can drop other members instead", () => {
    const { messages, report } = cleanImport(parsed, mapping, { others: "drop" });
    expect(new Set(messages.map((m) => m.role))).toEqual(new Set(["me", "ta"]));
    expect(report.droppedOthers).toBe(4);
    expect(messages.map((m) => m.text).join()).not.toMatch(/大熊|糖糖|阿May/);
  });

  it("works on a group picked out of a multi-conversation export", () => {
    const g = parseImport("wechat_messages.json", keeperWechat, { conversation: "周末桌游群" });
    const { report } = cleanImport(g, mapping);
    expect(report.droppedByKind).toMatchObject({ system: 1, transfer: 1 });
  });

  it("leaves emails alone when redaction is off", () => {
    const { messages } = cleanImport(imported([{ ts: 1, text: "发到 a.b@example.com" }]), mapping, {
      redact: false,
    });
    expect(messages[0].text).toBe("发到 a.b@example.com");
  });
});
