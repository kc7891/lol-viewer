import { describe, expect, it } from "vitest";
import type { ProbeResponse } from "@lol-viewer/protocol";
import { RateLimiter, RATE_PAUSE_MS } from "./rateLimiter.ts";

/** A clock that only moves when somebody sleeps. */
function clock() {
  let t = 1_000_000;
  const sleeps: number[] = [];
  return { now: () => t, sleep: async (ms: number) => { sleeps.push(ms); t += ms; }, sleeps, advance: (ms: number) => { t += ms; } };
}
const res = (status: number, ms = 20, extra: Partial<ProbeResponse> = {}): ProbeResponse => ({ status, ms, body: {}, ...extra });

describe("RateLimiter pacing", () => {
  it("starts requests 1 / perSec apart (5 per second at first)", async () => {
    const c = clock();
    const l = new RateLimiter({ now: c.now, sleep: c.sleep });
    const starts: number[] = [];
    for (let i = 0; i < 4; i++) await l.run(async () => { starts.push(c.now()); return res(200); });
    expect(starts.slice(1).map((s, i) => s - starts[i]!)).toEqual([200, 200, 200]);
  });
  it("lets at most 2 requests run at once", async () => {
    const c = clock();
    const l = new RateLimiter({ now: c.now, sleep: c.sleep });
    let inFlight = 0;
    let peak = 0;
    const gates: (() => void)[] = [];
    const job = () => l.run(async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise<void>((r) => gates.push(r));
      inFlight--;
      return res(200);
    });
    const all = Promise.all([job(), job(), job(), job()]);
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
      gates.splice(0).forEach((g) => g());
    }
    await all;
    expect(peak).toBe(2);
  });
});

describe("RateLimiter speed", () => {
  const run = async (l: RateLimiter, n: number, ms: number) => { for (let i = 0; i < n; i++) await l.run(async () => res(200, ms)); };
  it("goes up by 1 every 20 quick answers, to at most 20", async () => {
    const c = clock();
    const l = new RateLimiter({ now: c.now, sleep: c.sleep, initialPerSec: 5, maxPerSec: 7 });
    await run(l, 19, 100);
    expect(l.stats().perSec).toBe(5);
    await run(l, 1, 100);
    expect(l.stats().perSec).toBe(6);
    await run(l, 60, 100);
    expect(l.stats().perSec).toBe(7);
  });
  it("does not go up when the average is 500 ms or more", async () => {
    const c = clock();
    const l = new RateLimiter({ now: c.now, sleep: c.sleep });
    await run(l, 20, 600);
    expect(l.stats().perSec).toBe(5);
  });
  it("halves on an answer slower than 1 s, down to 1", async () => {
    const c = clock();
    const l = new RateLimiter({ now: c.now, sleep: c.sleep });
    await run(l, 1, 1500);
    expect(l.stats().perSec).toBe(2.5);
    await run(l, 3, 1500);
    expect(l.stats().perSec).toBe(1);
  });
  it("counts requests and the average time", async () => {
    const c = clock();
    const l = new RateLimiter({ now: c.now, sleep: c.sleep });
    await l.run(async () => res(200, 100));
    await l.run(async () => res(404, 300));
    expect(l.stats()).toMatchObject({ requests: 2, throttled: 0, avgMs: 200 });
  });
});

describe("RateLimiter refusals", () => {
  it("retries a 429 after 2 s, then 4 s, and halves the speed", async () => {
    const c = clock();
    const l = new RateLimiter({ now: c.now, sleep: c.sleep });
    const answers = [res(429), res(503), res(200)];
    const r = await l.run(async () => answers.shift()!);
    expect(r.status).toBe(200);
    expect(c.sleeps.filter((s) => s >= 1000)).toEqual([2000, 4000]);
    expect(l.stats()).toMatchObject({ requests: 3, throttled: 2 });
    expect(l.stats().perSec).toBe(1.25);
    expect(l.pausedUntil()).toBeNull();
  });
  it("waits 5 s when the client sent Retry-After", async () => {
    const c = clock();
    const l = new RateLimiter({ now: c.now, sleep: c.sleep });
    const answers = [res(429, 5, { retryAfter: true }), res(200)];
    await l.run(async () => answers.shift()!);
    expect(c.sleeps.filter((s) => s >= 1000)).toEqual([5000]);
  });
  it("gives up after 3 attempts and pauses for 60 s", async () => {
    const c = clock();
    const l = new RateLimiter({ now: c.now, sleep: c.sleep });
    let calls = 0;
    const r = await l.run(async () => { calls++; return res(429); });
    expect(r.status).toBe(429);
    expect(calls).toBe(3);
    const until = l.pausedUntil();
    expect(until).toBe(c.now() + RATE_PAUSE_MS);
    const before = c.now();
    let startedAt = 0;
    await l.run(async () => { startedAt = c.now(); return res(200); });
    expect(startedAt - before).toBeGreaterThanOrEqual(RATE_PAUSE_MS);
    expect(l.pausedUntil()).toBeNull();
  });
  it("does not pause when an answer comes in between", async () => {
    const c = clock();
    const l = new RateLimiter({ now: c.now, sleep: c.sleep });
    const answers = [res(429), res(429), res(200), res(429), res(429), res(200)];
    await l.run(async () => answers.shift()!);
    await l.run(async () => answers.shift()!);
    expect(l.pausedUntil()).toBeNull();
  });
  it("does not retry other failures, and a missing answer says nothing about speed", async () => {
    const c = clock();
    const l = new RateLimiter({ now: c.now, sleep: c.sleep });
    let calls = 0;
    const r = await l.run(async () => { calls++; return { status: 0, ms: 0, body: null, error: "network" as const }; });
    expect(r.status).toBe(0);
    expect(calls).toBe(1);
    expect(l.stats().avgMs).toBe(0);
  });
});
