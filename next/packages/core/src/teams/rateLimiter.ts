/**
 * Request pacing for the League Client (Teams, M-038): a start-spacing token bucket with at most 2
 * requests in flight, a speed that rises while answers are quick and halves when they are slow or refused,
 * and a back-off for 429 / 503. Pure: `now` and `sleep` are injected.
 */
import type { ProbeResponse } from "@lol-viewer/protocol";

export type RateStats = { requests: number; throttled: number; avgMs: number; perSec: number };
export type RateLimiterOptions = {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  concurrency?: number;
  initialPerSec?: number;
  minPerSec?: number;
  maxPerSec?: number;
};

export const RATE_PAUSE_MS = 60_000;
const BACKOFF_START_MS = 2000;
const RETRY_AFTER_MS = 5000;
const BACKOFF_MAX_MS = 60_000;
const MAX_ATTEMPTS = 3;
const SPEED_UP_EVERY = 20;
const FAST_MS = 500;
const SLOW_MS = 1000;

const isThrottle = (r: ProbeResponse) => r.status === 429 || r.status === 503;

export class RateLimiter {
  readonly #now: () => number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #concurrency: number;
  readonly #min: number;
  readonly #max: number;
  #perSec: number;
  #nextAt = 0;
  #active = 0;
  #waiters: (() => void)[] = [];
  #requests = 0;
  #throttled = 0;
  #totalMs = 0;
  #answered = 0;
  #okInWindow = 0;
  #msInWindow = 0;
  #consecutive = 0;
  #pausedUntil = 0;

  constructor(o: RateLimiterOptions = {}) {
    this.#now = o.now ?? (() => Date.now());
    this.#sleep = o.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
    this.#concurrency = Math.max(1, o.concurrency ?? 2);
    this.#min = o.minPerSec ?? 1;
    this.#max = o.maxPerSec ?? 20;
    this.#perSec = Math.min(this.#max, Math.max(this.#min, o.initialPerSec ?? 5));
  }

  /** Set while the limiter is waiting out three refusals in a row; null otherwise. */
  pausedUntil(): number | null {
    return this.#now() < this.#pausedUntil ? this.#pausedUntil : null;
  }

  stats(): RateStats {
    return {
      requests: this.#requests,
      throttled: this.#throttled,
      avgMs: this.#answered ? Math.round(this.#totalMs / this.#answered) : 0,
      perSec: Math.round(this.#perSec * 100) / 100,
    };
  }

  /** Run one request (`send` is called again for a retry). Returns the last response. */
  async run(send: () => Promise<ProbeResponse>): Promise<ProbeResponse> {
    await this.#enter();
    try {
      let backoff = BACKOFF_START_MS;
      for (let attempt = 1; ; attempt++) {
        await this.#pace();
        this.#requests++;
        const r = await send();
        if (!isThrottle(r)) {
          this.#record(r);
          return r;
        }
        this.#throttled++;
        this.#perSec = Math.max(this.#min, this.#perSec / 2);
        this.#okInWindow = 0;
        this.#msInWindow = 0;
        if (++this.#consecutive >= MAX_ATTEMPTS) {
          this.#consecutive = 0;
          this.#pausedUntil = this.#now() + RATE_PAUSE_MS;
        }
        if (attempt >= MAX_ATTEMPTS) return r;
        const wait = r.retryAfter ? RETRY_AFTER_MS : backoff;
        backoff = Math.min(BACKOFF_MAX_MS, backoff * 2);
        await this.#sleep(wait);
      }
    } finally {
      this.#leave();
    }
  }

  #record(r: ProbeResponse): void {
    this.#consecutive = 0;
    if (r.status === 0) return; // no answer: says nothing about speed
    this.#answered++;
    this.#totalMs += r.ms;
    if (r.ms > SLOW_MS) {
      this.#perSec = Math.max(this.#min, this.#perSec / 2);
      this.#okInWindow = 0;
      this.#msInWindow = 0;
      return;
    }
    this.#okInWindow++;
    this.#msInWindow += r.ms;
    if (this.#okInWindow >= SPEED_UP_EVERY) {
      if (this.#msInWindow / this.#okInWindow < FAST_MS) this.#perSec = Math.min(this.#max, this.#perSec + 1);
      this.#okInWindow = 0;
      this.#msInWindow = 0;
    }
  }

  async #enter(): Promise<void> {
    if (this.#active < this.#concurrency) {
      this.#active++;
      return;
    }
    await new Promise<void>((r) => this.#waiters.push(r)); // the slot is handed over
  }

  #leave(): void {
    const next = this.#waiters.shift();
    if (next) next();
    else this.#active--;
  }

  /** Reserve the next start time (spaced by 1 / perSec) and wait for it and for any pause. */
  async #pace(): Promise<void> {
    const t = this.#now();
    const start = Math.max(t, this.#nextAt);
    this.#nextAt = start + 1000 / this.#perSec;
    if (start > t) await this.#sleep(start - t);
    for (let left = this.#pausedUntil - this.#now(); left > 0; left = this.#pausedUntil - this.#now()) await this.#sleep(left);
  }
}
