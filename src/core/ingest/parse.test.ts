import { describe, expect, it } from "vitest";
import type { MessageKind, ParsedImport, SourceFormat } from "../model";
import { ImportFormatError, decodeBytes, detectFormat, parseImport } from "./index";
import { parseDateTime } from "./time";
import keeperQQ from "../../../fixtures/formats/chatlog-keeper-qq.json?raw";
import keeperWechat from "../../../fixtures/formats/chatlog-keeper-wechat.json?raw";
import genericCsv from "../../../fixtures/formats/generic.csv?raw";
import genericJson from "../../../fixtures/formats/generic.json?raw";
import plainBracket from "../../../fixtures/formats/plain-bracket.txt?raw";
import plainInline from "../../../fixtures/formats/plain-inline.txt?raw";
import plainSenderTime from "../../../fixtures/formats/plain-sender-time.txt?raw";
import qqMht from "../../../fixtures/formats/qq-legacy.mht?raw";
import qqTxt from "../../../fixtures/formats/qq-legacy.txt?raw";
import weJson from "../../../fixtures/formats/wechat-exporter.json?raw";
import weTxt from "../../../fixtures/formats/wechat-exporter.txt?raw";
import wxCliLegacyGroup from "../../../fixtures/formats/wx-cli-legacy-group.json?raw";
import wxCliLegacy from "../../../fixtures/formats/wx-cli-legacy.json?raw";
import wxCliMd from "../../../fixtures/formats/wx-cli-legacy.md?raw";
import wxCliJson from "../../../fixtures/formats/wx-cli.json?raw";
import wxCliTxt from "../../../fixtures/formats/wx-cli.txt?raw";

const FIRST_TS = Date.UTC(2024, 4, 20, 13, 3); // 2024-05-20 21:03 UTC+8

function kinds(p: ParsedImport): Partial<Record<MessageKind, number>> {
  const out: Partial<Record<MessageKind, number>> = {};
  for (const m of p.messages) out[m.kind] = (out[m.kind] ?? 0) + 1;
  return out;
}

interface Case {
  file: string;
  content: string;
  format: SourceFormat;
  title?: string;
  self?: string;
  /** Exporters that keep the recall notice report one system message. */
  system: number;
  /** wx-cli Markdown shows red packets as "[链接/文件]", indistinguishable from link cards. */
  transfer?: boolean;
}

const CASES: Case[] = [
  {
    file: "wechat_messages.json",
    content: keeperWechat,
    format: "wechat-chatlog-keeper-json",
    title: "小鹿",
    self: "阿哲",
    system: 1,
  },
  {
    file: "qq_messages.json",
    content: keeperQQ,
    format: "qq-ntqq-json",
    title: "小鹿",
    self: "阿哲",
    system: 1,
  },
  { file: "chat.json", content: weJson, format: "wechat-exporter-json", system: 1 },
  { file: "chat.txt", content: weTxt, format: "wechat-exporter-txt", title: "小鹿", system: 1 },
  {
    file: "小鹿_2026-11-09.json",
    content: wxCliJson,
    format: "wx-cli-json",
    title: "小鹿",
    self: "阿哲",
    system: 1,
  },
  {
    file: "小鹿_2026-11-09.txt",
    content: wxCliTxt,
    format: "wx-cli-txt",
    title: "小鹿",
    self: "阿哲",
    system: 1,
  },
  {
    file: "export.json",
    content: wxCliLegacy,
    format: "wx-cli-json",
    title: "小鹿",
    self: "阿哲",
    system: 1,
  },
  {
    file: "export.md",
    content: wxCliMd,
    format: "wx-cli-markdown",
    title: "小鹿",
    system: 1,
    transfer: false,
  },
  { file: "小鹿.txt", content: qqTxt, format: "qq-txt", title: "小鹿", self: "阿哲", system: 0 },
  { file: "小鹿.mht", content: qqMht, format: "qq-mht", title: "小鹿", self: "阿哲", system: 0 },
  { file: "chat.csv", content: genericCsv, format: "generic-csv", system: 0 },
  { file: "chat.json", content: genericJson, format: "generic-json", system: 0 },
  { file: "paste.txt", content: plainInline, format: "plain-text", system: 0 },
  { file: "paste.txt", content: plainBracket, format: "plain-text", system: 0 },
  { file: "paste.txt", content: plainSenderTime, format: "plain-text", system: 0 },
];

describe("parseImport fixtures", () => {
  it.each(CASES.map((c) => [`${c.format} (${c.file})`, c] as const))("%s", (_name, c) => {
    expect(detectFormat(c.file, c.content)).toBe(c.format);
    const p = parseImport(c.file, c.content);
    expect(p.format).toBe(c.format);
    expect(p.title).toBe(c.title);
    expect(p.selfSender).toBe(c.self);
    expect(p.isGroup).toBe(false);
    expect(p.participants).toEqual([
      { sender: "小鹿", count: 21 },
      { sender: "阿哲", count: 10 },
    ]);
    expect(p.messages).toHaveLength(31 + c.system);

    const k = kinds(p);
    expect(k.text).toBe(25);
    expect(k.sticker).toBe(1);
    expect(k.voice).toBe(1);
    expect(k.file).toBe(1);
    expect(k.image).toBe(1);
    expect(k.system ?? 0).toBe(c.system);
    if (c.transfer === false) {
      expect(k.link).toBe(2);
    } else {
      expect(k.transfer).toBe(1);
      expect(k.link).toBe(1);
    }

    const first = p.messages[0];
    expect(first).toMatchObject({ sender: "阿哲", kind: "text", text: "在干嘛呢" });
    expect(first.ts).toBe(FIRST_TS);
    expect(p.messages.find((m) => m.text.includes("13800138000"))?.sender).toBe("小鹿");
    expect(new Set(p.messages.map((m) => m.id)).size).toBe(p.messages.length);
    const last = p.messages[p.messages.length - 1];
    expect(last.text).toBe("早 我在地铁上");
  });

  it("non-text messages carry a placeholder, not raw XML", () => {
    for (const c of CASES) {
      const p = parseImport(c.file, c.content);
      for (const m of p.messages) {
        if (m.kind !== "text") expect(m.text).not.toMatch(/<msg|<appmsg|<sysmsg/);
      }
    }
  });
});

describe("format specifics", () => {
  it("chatlog-keeper: lists every conversation and picks the requested one", () => {
    const p = parseImport("wechat_messages.json", keeperWechat);
    expect(p.conversations?.map((c) => c.title)).toEqual(["小鹿", "周末桌游群"]);
    expect(p.warnings.join()).toMatch(/2 个会话/);

    const g = parseImport("wechat_messages.json", keeperWechat, {
      conversation: "10000000001@chatroom",
    });
    expect(g.title).toBe("周末桌游群");
    expect(g.isGroup).toBe(true);
    expect(g.participants.map((x) => x.sender).sort()).toEqual(
      ["大熊", "小鹿", "糖糖", "阿哲"].sort(),
    );
    expect(g.messages.filter((m) => m.kind === "system")).toHaveLength(1);
  });

  it("wx-cli: strips the wxid suffix from display names", () => {
    const p = parseImport("x.json", wxCliJson);
    expect(p.messages.every((m) => !m.sender.includes("wxid_"))).toBe(true);
  });

  it("wx-cli legacy: empty sender in a private chat is the contact", () => {
    const p = parseImport("x.json", wxCliLegacy);
    expect(p.messages[1]).toMatchObject({ sender: "小鹿", text: "刚洗完澡～" });
  });

  it("wx-cli legacy group", () => {
    const p = parseImport("x.json", wxCliLegacyGroup);
    expect(p).toMatchObject({ format: "wx-cli-json", title: "周末桌游群", isGroup: true });
    expect(p.participants).toHaveLength(4);
  });

  it("WeChatExporter quote replies keep only the reply text", () => {
    const xml =
      "<msg><appmsg><title>好呀～</title><type>57</type><refermsg><content>周末去看海吗</content></refermsg></appmsg></msg>";
    const p = parseImport(
      "chat.json",
      JSON.stringify([
        {
          content: xml,
          sender: "小鹿",
          time: "2024-01-02 21:03:05",
          timestamp: 1704200585,
          type: 49,
          typeName: "链接/文件/小程序",
        },
      ]),
    );
    expect(p.messages[0]).toMatchObject({ kind: "text", text: "好呀～" });
  });

  it("WeChatExporter TXT keeps multi-line XML content in one message", () => {
    const p = parseImport("chat.txt", weTxt);
    const link = p.messages.find((m) => m.kind === "link")!;
    expect(link.text).toBe("[链接]");
  });

  it("reports unknown formats and encrypted databases clearly", () => {
    expect(detectFormat("a.txt", "随便写点什么\n没有时间也没有发送者")).toBeNull();
    expect(() => parseImport("a.txt", "随便写点什么")).toThrow(ImportFormatError);
    expect(() => parseImport("MSG0.db", "SQLite format 3\u0000garbage")).toThrow(/不解密/);
    expect(() => parseImport("a.json", '{"foo": 1}')).toThrow(/无法识别/);
    expect(() => parseImport("a.txt", "   ")).toThrow(/空/);
  });
});

describe("plain text variants", () => {
  const parse = (s: string) => parseImport("paste.txt", s);

  it("inline with Chinese colon and multi-line continuation", () => {
    const p = parse("2024-01-02 21:03 小鹿：第一行\n第二行\n2024-01-02 21:04 阿哲: 嗯\n");
    expect(p.messages.map((m) => [m.sender, m.text])).toEqual([
      ["小鹿", "第一行\n第二行"],
      ["阿哲", "嗯"],
    ]);
  });

  it("bracketed date-time with seconds", () => {
    const p = parse("[2024/1/2 21:03:05] 小鹿：内容\n[2024/1/2 21:03:09] 阿哲：好");
    expect(p.messages[0]).toMatchObject({
      sender: "小鹿",
      text: "内容",
      ts: Date.UTC(2024, 0, 2, 13, 3, 5),
    });
  });

  it("sender + time header lines under date separators", () => {
    const p = parse(
      "2024-01-02\n\n小鹿 21:03\n在吗\n\n阿哲 21:05\n在\n\n2024-01-03\n小鹿 08:00\n早",
    );
    expect(p.messages.map((m) => m.text)).toEqual(["在吗", "在", "早"]);
    expect(p.messages[2].ts).toBe(Date.UTC(2024, 0, 3, 0, 0));
  });

  it("sender + time without any date infers day rollover", () => {
    const p = parse("小鹿 23:50\n晚安\n阿哲 23:55\n晚安\n小鹿 08:01\n早");
    expect(p.warnings.join()).toMatch(/没有日期/);
    expect(p.messages[2].ts - p.messages[1].ts).toBe((8 * 60 + 6) * 60_000);
  });

  it("Chinese dates and 上午/下午", () => {
    const p = parse("2024年1月2日 下午9:03 小鹿：嗯呢\n2024年1月2日 下午9:04 阿哲：好");
    expect(p.messages[0].ts).toBe(Date.UTC(2024, 0, 2, 13, 3));
  });

  it("WeChat PC copy: sender then date-time", () => {
    const p = parse("小鹿 2024/1/2 21:03:05\n你好呀\n阿哲 2024/1/2 21:03:30\n你好");
    expect(p.messages.map((m) => m.sender)).toEqual(["小鹿", "阿哲"]);
  });

  it("maps placeholders and notices to kinds", () => {
    const p = parse(
      [
        "2024-01-02 21:03 小鹿: [图片]",
        "2024-01-02 21:03 小鹿: [动画表情]",
        "2024-01-02 21:04 阿哲: [转账] ¥52.00",
        '2024-01-02 21:04 阿哲: [语音] 3"',
        "2024-01-02 21:05 小鹿: 小鹿撤回了一条消息",
        "2024-01-02 21:05 小鹿: [链接] 一篇文章",
        "2024-01-02 21:06 小鹿: [引用 阿哲: 在吗] 在的～",
      ].join("\n"),
    );
    expect(p.messages.map((m) => m.kind)).toEqual([
      "image",
      "sticker",
      "transfer",
      "voice",
      "system",
      "link",
      "text",
    ]);
    expect(p.messages[6].text).toBe("在的～");
  });
});

describe("generic CSV / JSON", () => {
  it("English headers, quoted newline, epoch seconds", () => {
    const csv =
      'time,sender,content\n1704200580,小鹿,"第一行\n第二行"\n1704200640,阿哲,"他说""好"""\n';
    const p = parseImport("a.csv", csv);
    expect(p.format).toBe("generic-csv");
    expect(p.messages.map((m) => m.text)).toEqual(["第一行\n第二行", '他说"好"']);
    expect(p.messages[0].ts).toBe(1704200580_000);
  });

  it("WeChatMsg / 留痕 style columns with IsSender", () => {
    const csv = [
      "localId,TalkerId,Type,SubType,IsSender,CreateTime,Status,StrContent,StrTime,Remark,NickName,Sender",
      "1,1,1,0,0,1704200580,2,在吗,2024-01-02 21:03:00,,小鹿,wxid_x",
      "2,1,1,0,1,1704200600,2,在,2024-01-02 21:03:20,,阿哲,wxid_y",
      "3,1,3,0,0,1704200700,2,<msg><img /></msg>,2024-01-02 21:05:00,,小鹿,wxid_x",
    ].join("\n");
    const p = parseImport("messages.csv", csv);
    expect(p.selfSender).toBe("阿哲");
    expect(p.messages.map((m) => m.kind)).toEqual(["text", "text", "image"]);
  });

  it("tab-separated with Chinese headers and a type column", () => {
    const p = parseImport(
      "a.tsv",
      "时间\t发送者\t类型\t内容\n2024-01-02 21:03\t小鹿\t图片\t\n2024-01-02 21:04\t阿哲\t文本\t好看",
    );
    expect(p.messages.map((m) => m.kind)).toEqual(["image", "text"]);
  });

  it("JSON template wrapped in an object, epoch ms", () => {
    const p = parseImport(
      "a.json",
      JSON.stringify({
        title: "小鹿",
        messages: [{ time: 1704200580000, sender: "小鹿", text: "嗨" }],
      }),
    );
    expect(p).toMatchObject({ format: "generic-json", title: "小鹿" });
    expect(p.messages[0].ts).toBe(1704200580000);
  });
});

describe("helpers", () => {
  it("parseDateTime variants", () => {
    const t = Date.UTC(2024, 0, 2, 13, 3, 5);
    expect(parseDateTime("2024-01-02 21:03:05")).toBe(t);
    expect(parseDateTime("2024/1/2 21:03:05")).toBe(t);
    expect(parseDateTime("2024.01.02 21:03:05")).toBe(t);
    expect(parseDateTime("2024-01-02T13:03:05Z")).toBe(t);
    expect(parseDateTime("2024-01-02T21:03:05+08:00")).toBe(t);
    expect(parseDateTime("2024-01-02 13:03:05", 0)).toBe(t);
    expect(parseDateTime("2024-02-30 10:00")).toBeNull();
  });

  it("decodeBytes handles UTF-8 BOM, UTF-16LE and GB18030", () => {
    const utf8 = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("小鹿")]);
    expect(decodeBytes(utf8)).toBe("小鹿");
    const utf16 = new Uint8Array([0xff, 0xfe, 0x0f, 0x5c, 0x7f, 0x9e]);
    expect(decodeBytes(utf16)).toBe("小鹿");
    const gbk = new Uint8Array([0xd0, 0xa1, 0xc2, 0xb9, 0xc4, 0xe3, 0xba, 0xc3]);
    expect(decodeBytes(gbk)).toBe("小鹿你好");
  });
});
