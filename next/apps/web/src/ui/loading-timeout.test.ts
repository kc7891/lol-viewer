import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLoadingTimeout, LOADING_BAR_MAX_MS } from "./loading-timeout.ts";

describe("createLoadingTimeout", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("is 30 seconds by default", () => {
    expect(LOADING_BAR_MAX_MS).toBe(30_000);
  });
  it("expires once, after the limit", () => {
    const onExpire = vi.fn();
    createLoadingTimeout(onExpire).start();
    vi.advanceTimersByTime(29_999);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
  it("stop cancels; start again restarts the clock", () => {
    const onExpire = vi.fn();
    const t = createLoadingTimeout(onExpire, 1000);
    t.start();
    vi.advanceTimersByTime(900);
    t.stop();
    vi.advanceTimersByTime(5000);
    expect(onExpire).not.toHaveBeenCalled();
    t.start();
    vi.advanceTimersByTime(900);
    t.start();
    vi.advanceTimersByTime(900);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});
