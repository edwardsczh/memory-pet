import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AiBadge } from "./AiBadge";
import {
  CONSENT_VERSION,
  createLocalConsentStore,
  isConsentCurrent,
  type FirstRunConsentRecord,
} from "./consentStore";
import { CrisisCard } from "./CrisisCard";
import { FirstRunConsent } from "./FirstRunConsent";
import { QuickControls } from "./QuickControls";
import { UsageReminder } from "./UsageReminder";

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  };
}

const noop = () => {};

describe("consent store", () => {
  it("round-trips and clears", async () => {
    const store = createLocalConsentStore(memoryStorage());
    expect(await store.load()).toBeNull();
    const r: FirstRunConsentRecord = { version: CONSENT_VERSION, acceptedAt: 1, ageAdult: true };
    await store.save(r);
    expect(await store.load()).toEqual(r);
    await store.clear();
    expect(await store.load()).toBeNull();
  });

  it("ignores corrupt data and stale versions", async () => {
    const storage = memoryStorage();
    storage.setItem("memory-pet.first-run-consent", "{not json");
    expect(await createLocalConsentStore(storage).load()).toBeNull();
    expect(isConsentCurrent({ version: CONSENT_VERSION - 1, acceptedAt: 1, ageAdult: true })).toBe(
      false,
    );
  });
});

describe("compliance components", () => {
  it("AiBadge shows AI and the notice", () => {
    const html = renderToStaticMarkup(<AiBadge />);
    expect(html).toContain(">AI<");
    expect(html).toContain("你正在与 AI 互动，内容由 AI 生成");
    expect(html).toContain("data-hit");
  });

  it("FirstRunConsent covers every required notice", () => {
    const html = renderToStaticMarkup(<FirstRunConsent onAccept={noop} providerName="X" />);
    for (const s of [
      "AI 生成",
      "保存在本机",
      "模型服务商（X）",
      "2 小时",
      "我已年满 18 周岁",
      "我已阅读并同意",
      "不同意并退出",
    ]) {
      expect(html).toContain(s);
    }
  });

  it("UsageReminder has rest / continue and no retention wording", () => {
    const html = renderToStaticMarkup(
      <UsageReminder continuousMs={2 * 3600_000} onRest={noop} onContinue={noop} />,
    );
    expect(html).toContain("你已经连续聊了 2 小时，起来走走、喝口水吧");
    expect(html).toContain("好的，休息一下");
    expect(html).toContain("继续");
    expect(html).not.toMatch(/别走|舍不得|会员|充值/);
  });

  it("CrisisCard lists hotlines and the emergency contact", () => {
    const html = renderToStaticMarkup(
      <CrisisCard emergencyContact={{ name: "阿明", phone: "123" }} />,
    );
    for (const n of [
      "12356",
      "010-82951332",
      "800-810-1117",
      "400-161-9995",
      "120",
      "110",
      "阿明",
    ]) {
      expect(html).toContain(n);
    }
  });

  it("QuickControls renders three hit-testable buttons", () => {
    const html = renderToStaticMarkup(<QuickControls muted onToggleMute={noop} />);
    expect(html.match(/data-hit/g)).toHaveLength(3);
    expect(html).toContain("已静音");
    expect(html).toContain("退出");
  });
});
