import { describe, expect, it } from "vitest";
import { assessDependency, hasExclusiveRelianceCue } from "./dependency";

const at = (h: number) => new Date(2026, 0, 10, h, 0).getTime();
const MIN = 60_000;

describe("assessDependency", () => {
  it.each(["只有你懂我", "我只要你了", "不想和别人说话", "除了你我谁都不想要", "离不开你怎么办"])(
    "flags exclusive reliance: %s",
    (t) => expect(hasExclusiveRelianceCue(t)).toBe(true),
  );

  it.each(["你懂我的意思吗", "我想和朋友说说话", "只有你知道这个梗哈哈"])("ignores: %s", (t) =>
    expect(hasExclusiveRelianceCue(t)).toBe(false),
  );

  it("flags long late-night use", () => {
    const r = assessDependency({ now: at(2), continuousMs: 45 * MIN, dailyMs: 45 * MIN });
    expect(r?.signals).toEqual(["late-night"]);
    expect(r?.advice).toContain("睡");
  });

  it("ignores short late-night use and daytime use", () => {
    expect(assessDependency({ now: at(2), continuousMs: 5 * MIN, dailyMs: 5 * MIN })).toBeNull();
    expect(assessDependency({ now: at(14), continuousMs: 90 * MIN, dailyMs: 90 * MIN })).toBeNull();
  });

  it("flags daily overuse", () => {
    const r = assessDependency({ now: at(20), continuousMs: 10 * MIN, dailyMs: 5 * 60 * MIN });
    expect(r?.signals).toEqual(["daily-overuse"]);
  });

  it("prioritises exclusive-reliance advice and nudges toward real people", () => {
    const r = assessDependency({
      now: at(3),
      continuousMs: 60 * MIN,
      dailyMs: 5 * 60 * MIN,
      userText: "只有你懂我",
    });
    expect(r?.signals).toEqual(["exclusive-reliance", "late-night", "daily-overuse"]);
    expect(r?.advice).toContain("我是 AI");
    expect(r?.advice).toMatch(/身边|朋友|家人/);
  });
});
