import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_UPDATE_FEED,
  initialUpdateStatus,
  reduceUpdate,
  shortUpdateError,
  UpdateController,
  updateFeedUrl,
  updatesSupported,
  type UpdateDriver,
} from "./update-core.ts";

describe("support and feed", () => {
  it("is supported only when packaged, not E2E and not disabled", () => {
    expect(updatesSupported(true, {})).toBe(true);
    expect(updatesSupported(false, {})).toBe(false);
    expect(updatesSupported(true, { LOL_VIEWER_E2E: "1" })).toBe(false);
    expect(updatesSupported(true, { LOL_VIEWER_DISABLE_UPDATES: "1" })).toBe(false);
    expect(updatesSupported(true, { LOL_VIEWER_E2E: "0", LOL_VIEWER_DISABLE_UPDATES: "0" })).toBe(true);
  });
  it("defaults to the app-latest release and lets the environment override it", () => {
    expect(updateFeedUrl({})).toBe(DEFAULT_UPDATE_FEED);
    expect(updateFeedUrl({ LOL_VIEWER_UPDATE_URL: "  " })).toBe(DEFAULT_UPDATE_FEED);
    expect(updateFeedUrl({ LOL_VIEWER_UPDATE_URL: "http://127.0.0.1:8123" })).toBe("http://127.0.0.1:8123/");
    expect(updateFeedUrl({ LOL_VIEWER_UPDATE_URL: "http://127.0.0.1:8123/x/" })).toBe("http://127.0.0.1:8123/x/");
  });
  it("starts idle or unsupported", () => {
    expect(initialUpdateStatus("1.0.0", true).state).toBe("idle");
    expect(initialUpdateStatus("1.0.0", false).state).toBe("unsupported");
  });
});

describe("shortUpdateError", () => {
  it("turns noisy errors into one short sentence", () => {
    expect(shortUpdateError(new Error("net::ERR_INTERNET_DISCONNECTED"))).toBe("Could not reach the update server.");
    expect(shortUpdateError(Object.assign(new Error("getaddrinfo ENOTFOUND github.com"), { code: "ENOTFOUND" }))).toBe("Could not reach the update server.");
    expect(shortUpdateError(new Error("Cannot find latest.yml in the latest release artifacts (...): HttpError: 404\n<html>..."))).toBe("No update information was found.");
    expect(shortUpdateError(new Error("sha512 checksum mismatch, expected a, got b"))).toBe("The downloaded update is corrupted. Try again.");
    expect(shortUpdateError(new Error("something odd\nwith\nlines"))).toBe("Could not check for updates.");
    expect(shortUpdateError("x")).toBe("Could not check for updates.");
  });
});

describe("reduceUpdate", () => {
  const idle = initialUpdateStatus("0.0.1", true);
  it("walks check -> available -> downloading -> downloaded", () => {
    let s = reduceUpdate(idle, { type: "check-start" });
    expect(s.state).toBe("checking");
    s = reduceUpdate(s, { type: "available", version: "0.0.2" });
    expect(s).toMatchObject({ state: "available", latestVersion: "0.0.2" });
    s = reduceUpdate(s, { type: "download-start" });
    expect(s).toMatchObject({ state: "downloading", percent: 0 });
    s = reduceUpdate(s, { type: "progress", percent: 41.6 });
    expect(s.percent).toBe(42);
    s = reduceUpdate(s, { type: "downloaded" });
    expect(s).toMatchObject({ state: "downloaded", percent: 100, latestVersion: "0.0.2" });
  });
  it("reports up to date, keeping the feed version", () => {
    const s = reduceUpdate(reduceUpdate(idle, { type: "check-start" }), { type: "not-available", version: "0.0.1" });
    expect(s).toMatchObject({ state: "not-available", latestVersion: "0.0.1" });
  });
  it("clamps progress and ignores events that do not fit", () => {
    const dl = { ...idle, state: "downloading" as const, percent: 10, latestVersion: "0.0.2" };
    expect(reduceUpdate(dl, { type: "progress", percent: 250 }).percent).toBe(100);
    expect(reduceUpdate(dl, { type: "progress", percent: -3 }).percent).toBe(0);
    expect(reduceUpdate(idle, { type: "progress", percent: 5 })).toBe(idle);
    expect(reduceUpdate(idle, { type: "downloaded" })).toBe(idle);
    expect(reduceUpdate(dl, { type: "check-start" })).toBe(dl);
    expect(reduceUpdate(idle, { type: "error", message: "x" })).toBe(idle);
  });
  it("an error keeps the known latest version and a new check clears it", () => {
    const dl = { ...idle, state: "downloading" as const, percent: 10, latestVersion: "0.0.2" };
    const err = reduceUpdate(dl, { type: "error", message: "boom" });
    expect(err).toMatchObject({ state: "error", error: "boom", percent: null, latestVersion: "0.0.2" });
    expect(reduceUpdate(err, { type: "check-start" })).toMatchObject({ state: "checking", error: null });
  });
  it("never leaves unsupported", () => {
    const u = initialUpdateStatus("0.0.1", false);
    expect(reduceUpdate(u, { type: "check-start" })).toBe(u);
  });
});

function fakeDriver(over: Partial<UpdateDriver> = {}): UpdateDriver & { install: ReturnType<typeof vi.fn> } {
  return {
    check: async () => ({ isUpdateAvailable: true, version: "0.0.2" }),
    download: async (p) => (p(30), p(100)),
    install: vi.fn(),
    ...over,
  } as UpdateDriver & { install: ReturnType<typeof vi.fn> };
}

describe("UpdateController", () => {
  it("runs the whole flow and pushes every status", async () => {
    const d = fakeDriver();
    const c = new UpdateController("0.0.1", true, d);
    const seen: string[] = [];
    c.subscribe((s) => seen.push(`${s.state}${s.percent == null ? "" : ":" + s.percent}`));
    await c.check();
    await c.download();
    c.install();
    expect(seen).toEqual(["checking", "available", "downloading:0", "downloading:30", "downloading:100", "downloaded:100"]);
    expect(d.install).toHaveBeenCalledOnce();
  });
  it("does not install before the download finished, nor download before a check", async () => {
    const d = fakeDriver();
    const c = new UpdateController("0.0.1", true, d);
    await c.download();
    c.install();
    expect(c.status.state).toBe("idle");
    expect(d.install).not.toHaveBeenCalled();
  });
  it("ignores a second check while one is running", async () => {
    let n = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const c = new UpdateController("0.0.1", true, fakeDriver({ check: async () => (n++, await gate, { isUpdateAvailable: false, version: "0.0.1" }) }));
    const a = c.check();
    const b = c.check();
    release();
    await Promise.all([a, b]);
    expect(n).toBe(1);
    expect(c.status.state).toBe("not-available");
  });
  it("turns a failure into a short message and allows retrying", async () => {
    let fail = true;
    const c = new UpdateController("0.0.1", true, fakeDriver({ check: async () => { if (fail) throw new Error("net::ERR_INTERNET_DISCONNECTED"); return { isUpdateAvailable: false, version: "0.0.1" }; } }));
    await c.check();
    expect(c.status).toMatchObject({ state: "error", error: "Could not reach the update server." });
    fail = false;
    await c.check();
    expect(c.status.state).toBe("not-available");
  });
  it("a failed download goes to error with the version kept; a check recovers", async () => {
    const c = new UpdateController("0.0.1", true, fakeDriver({ download: async () => { throw new Error("sha512 checksum mismatch"); } }));
    await c.check();
    await c.download();
    expect(c.status).toMatchObject({ state: "error", latestVersion: "0.0.2", error: "The downloaded update is corrupted. Try again." });
    await c.check();
    expect(c.status.state).toBe("available");
  });
  it("does nothing when unsupported", async () => {
    const d = fakeDriver({ check: vi.fn() });
    const c = new UpdateController("0.0.1", false, d);
    await c.check();
    expect(c.status.state).toBe("unsupported");
    expect(d.check).not.toHaveBeenCalled();
  });
});
