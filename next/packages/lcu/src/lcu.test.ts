import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFakeLcu, type FakeLcu } from "@lol-viewer/fake-lcu";
import {
  findCredentials,
  parseClientCommandLine,
  READ_ONLY_PATHS,
  startLcuConnector,
  type RawLcuEvent,
} from "./index.ts";

const until = async (cond: () => boolean, ms = 4000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe("parseClientCommandLine", () => {
  it("parses quoted and unquoted arguments", () => {
    const q = parseClientCommandLine(
      '"C:\\Riot Games\\League of Legends\\LeagueClientUx.exe" "--app-port=51234" "--remoting-auth-token=abc_DEF-123" "--install-directory=C:\\Riot Games\\League of Legends"',
    );
    expect(q).toEqual({ port: 51234, password: "abc_DEF-123", installDir: "C:\\Riot Games\\League of Legends" });
    const u = parseClientCommandLine("LeagueClientUx.exe --app-port=2000 --remoting-auth-token=tok --install-directory=D:\\LoL");
    expect(u).toEqual({ port: 2000, password: "tok", installDir: "D:\\LoL" });
  });
  it("returns null without port or token, and omits installDir when absent", () => {
    expect(parseClientCommandLine("LeagueClientUx.exe --app-port=2000")).toBeNull();
    expect(parseClientCommandLine("")).toBeNull();
    expect(parseClientCommandLine("x --app-port=1 --remoting-auth-token=t")).toEqual({ port: 1, password: "t" });
  });
});

describe("findCredentials order", () => {
  it("env lockfile wins and nothing else is tried", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lcu-"));
    const lf = join(dir, "lockfile");
    await writeFile(lf, "LeagueClient:1:1111:pw:http");
    const c = await findCredentials(undefined, {
      env: { LOL_LCU_LOCKFILE: lf },
      readCommandLine: async () => {
        throw new Error("must not be called");
      },
    });
    expect(c).toEqual({ port: 1111, password: "pw", protocol: "http" });
  });
  it("process command line gives https credentials", async () => {
    const c = await findCredentials(undefined, {
      env: {},
      readCommandLine: async () => "x --app-port=5555 --remoting-auth-token=tok",
    });
    expect(c).toEqual({ port: 5555, password: "tok", protocol: "https" });
  });
  it("falls back to <install-directory>/lockfile, then defaults; a throwing process read is a miss", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lcu-"));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "lockfile"), "LeagueClient:1:2222:pw2:https");
    const viaInstall = await findCredentials(undefined, {
      env: {},
      readCommandLine: async () => `x --install-directory=${dir}`,
      defaultLockfiles: [],
    });
    expect(viaInstall).toEqual({ port: 2222, password: "pw2", protocol: "https" });
    const def = join(dir, "lockfile");
    const viaDefault = await findCredentials(undefined, {
      env: {},
      readCommandLine: async () => {
        throw new Error("boom");
      },
      defaultLockfiles: [def],
    });
    expect(viaDefault?.port).toBe(2222);
    expect(await findCredentials(undefined, { env: {}, readCommandLine: async () => null, defaultLockfiles: [] })).toBeNull();
  });
});

describe("startLcuConnector with fake LCU", () => {
  let fake: FakeLcu | null = null;
  let stop: (() => void) | null = null;
  afterEach(async () => {
    stop?.();
    stop = null;
    await fake?.close();
    fake = null;
  });

  it("allow-lists current-summoner and the fake serves it", () => {
    expect(READ_ONLY_PATHS).toContain("/lol-summoner/v1/current-summoner");
  });

  it("connects, resyncs on demand, and reconnect() reconnects without duplicate events", async () => {
    fake = await startFakeLcu({
      lines: [{ t: 0, uri: "/lol-gameflow/v1/gameflow-phase", eventType: "Update", data: "Lobby" }],
    });
    await fake.done;
    const events: RawLcuEvent[] = [];
    const statuses: string[] = [];
    const conn = startLcuConnector({
      findCredentials: () => findCredentials([fake!.lockfilePath]),
      onEvent: (e) => events.push(e),
      onStatus: (s) => statuses.push(s),
      retryMs: 20,
    });
    stop = conn.stop;
    await until(() => events.some((e) => e.uri === "/lol-summoner/v1/current-summoner"));
    expect(events.find((e) => e.uri === "/lol-summoner/v1/current-summoner")?.data).toMatchObject({ puuid: "player-self" });

    const before = events.length;
    await conn.resync();
    expect(events.length).toBe(before + 2); // gameflow-phase + current-summoner; the other paths 404
  });

  it("reconnect() reports connecting and reconnects", async () => {
    fake = await startFakeLcu({ lines: [] });
    const statuses: string[] = [];
    const conn = startLcuConnector({
      findCredentials: () => findCredentials([fake!.lockfilePath]),
      onEvent: () => {},
      onStatus: (s) => statuses.push(s),
      retryMs: 20,
    });
    stop = conn.stop;
    await until(() => statuses.includes("connected"));
    const n = statuses.filter((s) => s === "connected").length;
    conn.reconnect();
    expect(statuses.at(-1)).toBe("connecting");
    await until(() => statuses.filter((s) => s === "connected").length === n + 1);
    // the closed client must not report a stray disconnect afterwards
    await new Promise((r) => setTimeout(r, 100));
    expect(statuses.at(-1)).toBe("connected");
  });

  it("recovers when the client appears later, with capped doubling backoff", async () => {
    let found = false;
    let calls = 0;
    fake = await startFakeLcu({ lines: [] });
    const statuses: string[] = [];
    const conn = startLcuConnector({
      findCredentials: async () => {
        calls++;
        return found ? findCredentials([fake!.lockfilePath]) : null;
      },
      onEvent: () => {},
      onStatus: (s) => statuses.push(s),
      retryMs: 10,
      maxRetryMs: 40,
    });
    stop = conn.stop;
    await until(() => calls >= 3);
    found = true;
    await until(() => statuses.includes("connected"));
  });
});
