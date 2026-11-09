import { describe, expect, it, vi } from "vitest";
import { createUsageTimer } from "./usage";

const MIN = 60_000;

function setup(start = new Date(2026, 0, 10, 9, 0).getTime()) {
  let t = start;
  const onRemind = vi.fn();
  const timer = createUsageTimer({ now: () => t, onRemind });
  /** Simulates the user interacting every `stepMin` minutes for `totalMin`. */
  const chat = (totalMin: number, stepMin = 5) => {
    for (let m = 0; m < totalMin; m += stepMin) {
      t += stepMin * MIN;
      timer.recordActivity();
      timer.tick();
    }
  };
  const advance = (min: number) => {
    t += min * MIN;
  };
  return { timer, onRemind, chat, advance };
}

describe("createUsageTimer", () => {
  it("fires a reminder each time continuous use passes 2 hours", () => {
    const { timer, onRemind, chat } = setup();
    timer.recordActivity();
    chat(115);
    expect(onRemind).not.toHaveBeenCalled();
    chat(10);
    expect(onRemind).toHaveBeenCalledTimes(1);
    expect(onRemind.mock.calls[0][0]).toBeGreaterThanOrEqual(120 * MIN);
    chat(120);
    expect(onRemind).toHaveBeenCalledTimes(2);
  });

  it("resets the continuous session after more than 10 idle minutes", () => {
    const { timer, onRemind, chat, advance } = setup();
    timer.recordActivity();
    chat(100);
    advance(11);
    timer.tick();
    expect(timer.snapshot().active).toBe(false);
    timer.recordActivity();
    chat(100);
    expect(onRemind).not.toHaveBeenCalled();
    expect(timer.snapshot().continuousMs).toBe(100 * MIN);
  });

  it("does not reset on gaps of exactly 10 minutes", () => {
    const { timer, onRemind, chat } = setup();
    timer.recordActivity();
    chat(130, 10);
    expect(onRemind).toHaveBeenCalledTimes(1);
  });

  it("accumulates daily use across sessions and resets at midnight", () => {
    const { timer, chat, advance } = setup(new Date(2026, 0, 10, 21, 0).getTime());
    timer.recordActivity();
    chat(60);
    advance(30);
    timer.recordActivity();
    chat(30);
    expect(timer.snapshot().dailyMs).toBe(90 * MIN);
    advance(60);
    timer.recordActivity();
    expect(timer.snapshot().dailyMs).toBe(0);
  });

  it("holds reminders while quiet until the user acts or quiet ends", () => {
    const { timer, onRemind, chat, advance } = setup();
    timer.recordActivity();
    chat(115);
    timer.setQuiet(true);
    expect(timer.canActProactively()).toBe(false);
    advance(8);
    timer.tick();
    expect(onRemind).not.toHaveBeenCalled();
    timer.setQuiet(false);
    expect(onRemind).toHaveBeenCalledTimes(1);
    expect(timer.canActProactively()).toBe(true);
  });

  it("still reminds on user activity while quiet", () => {
    const { timer, onRemind, chat } = setup();
    timer.setQuiet(true);
    timer.recordActivity();
    chat(125);
    expect(onRemind).toHaveBeenCalledTimes(1);
  });

  it("reset() starts a fresh session", () => {
    const { timer, onRemind, chat } = setup();
    timer.recordActivity();
    chat(110);
    timer.reset();
    timer.recordActivity();
    chat(30);
    expect(onRemind).not.toHaveBeenCalled();
  });

  it("start() ticks on an interval", () => {
    vi.useFakeTimers();
    const { timer } = setup();
    const spy = vi.spyOn(timer, "tick");
    const stop = timer.start(1000);
    vi.advanceTimersByTime(3500);
    stop();
    vi.advanceTimersByTime(3000);
    expect(spy).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});
