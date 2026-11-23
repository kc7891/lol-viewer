/**
 * Update state machine (no Electron imports, so Vitest can drive it).
 * updater.ts wires it to electron-updater; see docs/spec/new-app-design.md §6.2.
 */
import type { UpdateStatus } from "@lol-viewer/protocol";

export const DEFAULT_UPDATE_FEED = "https://github.com/kc7891/lol-viewer/releases/download/app-latest/";

/** Updates run only in a packaged app, never under E2E, and can be switched off. */
export function updatesSupported(isPackaged: boolean, env: Record<string, string | undefined>): boolean {
  return isPackaged && env.LOL_VIEWER_E2E !== "1" && env.LOL_VIEWER_DISABLE_UPDATES !== "1";
}

/** LOL_VIEWER_UPDATE_URL (tests) wins; the feed always ends with a slash. */
export function updateFeedUrl(env: Record<string, string | undefined>): string {
  const u = env.LOL_VIEWER_UPDATE_URL?.trim();
  if (!u) return DEFAULT_UPDATE_FEED;
  return u.endsWith("/") ? u : u + "/";
}

export function initialUpdateStatus(currentVersion: string, supported: boolean): UpdateStatus {
  return { state: supported ? "idle" : "unsupported", currentVersion, latestVersion: null, percent: null, error: null };
}

/** A short sentence for the UI. The full error goes to the log only. */
export function shortUpdateError(err: unknown): string {
  const text = err instanceof Error ? `${err.name} ${(err as { code?: string }).code ?? ""} ${err.message}` : String(err);
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ERR_INTERNET|ERR_NAME|ERR_CONNECTION|ERR_NETWORK|ERR_TIMED_OUT|net::|getaddrinfo|socket hang up|timeout/i.test(text))
    return "Could not reach the update server.";
  if (/\b404\b|Cannot find latest|latest\.yml/i.test(text)) return "No update information was found.";
  if (/sha512|checksum/i.test(text)) return "The downloaded update is corrupted. Try again.";
  if (/\b(401|403|429)\b/.test(text)) return "The update server refused the request.";
  return "Could not check for updates.";
}

export type UpdateEvent =
  | { type: "check-start" }
  | { type: "available"; version: string }
  | { type: "not-available"; version: string | null }
  | { type: "download-start" }
  | { type: "progress"; percent: number }
  | { type: "downloaded" }
  | { type: "error"; message: string };

/** Pure transition. Events that do not fit the current state are ignored (return the same object). */
export function reduceUpdate(s: UpdateStatus, e: UpdateEvent): UpdateStatus {
  if (s.state === "unsupported") return s;
  switch (e.type) {
    case "check-start":
      return s.state === "idle" || s.state === "not-available" || s.state === "error"
        ? { ...s, state: "checking", percent: null, error: null }
        : s;
    case "available":
      return s.state === "checking" ? { ...s, state: "available", latestVersion: e.version, percent: null, error: null } : s;
    case "not-available":
      return s.state === "checking" ? { ...s, state: "not-available", latestVersion: e.version ?? s.currentVersion, percent: null, error: null } : s;
    case "download-start":
      return s.state === "available" ? { ...s, state: "downloading", percent: 0, error: null } : s;
    case "progress": {
      if (s.state !== "downloading") return s;
      const percent = Math.min(100, Math.max(0, Math.round(e.percent)));
      return percent === s.percent ? s : { ...s, percent };
    }
    case "downloaded":
      return s.state === "downloading" ? { ...s, state: "downloaded", percent: 100 } : s;
    case "error":
      return s.state === "checking" || s.state === "downloading" ? { ...s, state: "error", percent: null, error: e.message } : s;
  }
}

/** The part of electron-updater the controller needs. */
export interface UpdateDriver {
  check(): Promise<{ isUpdateAvailable: boolean; version: string | null } | null>;
  download(onProgress: (percent: number) => void): Promise<void>;
  install(): void;
}

export class UpdateController {
  private current: UpdateStatus;
  private readonly listeners = new Set<(s: UpdateStatus) => void>();

  constructor(
    currentVersion: string,
    supported: boolean,
    private readonly driver: UpdateDriver,
    private readonly log: { info(...a: unknown[]): void; warn(...a: unknown[]): void } = { info() {}, warn() {} },
  ) {
    this.current = initialUpdateStatus(currentVersion, supported);
  }

  get status(): UpdateStatus {
    return this.current;
  }

  subscribe(cb: (s: UpdateStatus) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private apply(e: UpdateEvent): boolean {
    const next = reduceUpdate(this.current, e);
    if (next === this.current) return false;
    this.current = next;
    this.listeners.forEach((l) => l(next));
    return true;
  }

  /** No-op unless idle / not-available / error. */
  async check(): Promise<void> {
    if (!this.apply({ type: "check-start" })) return;
    this.log.info("update", "checking");
    try {
      const r = await this.driver.check();
      if (r?.isUpdateAvailable && r.version) this.apply({ type: "available", version: r.version });
      else this.apply({ type: "not-available", version: r?.version ?? null });
      this.log.info("update", r?.isUpdateAvailable ? `available ${r.version}` : "up to date");
    } catch (err) {
      this.fail(err);
    }
  }

  /** No-op unless a newer version was found. */
  async download(): Promise<void> {
    if (!this.apply({ type: "download-start" })) return;
    this.log.info("update", "downloading", this.current.latestVersion);
    try {
      await this.driver.download((percent) => this.apply({ type: "progress", percent }));
      this.apply({ type: "downloaded" });
      this.log.info("update", "downloaded");
    } catch (err) {
      this.fail(err);
    }
  }

  /** No-op unless downloaded. */
  install(): void {
    if (this.current.state !== "downloaded") return;
    this.log.info("update", "restarting to install", this.current.latestVersion);
    this.driver.install();
  }

  private fail(err: unknown): void {
    this.log.warn("update", "failed:", err);
    this.apply({ type: "error", message: shortUpdateError(err) });
  }
}
