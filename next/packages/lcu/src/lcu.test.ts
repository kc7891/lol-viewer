import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFakeLcu, type FakeLcu } from "@lol-viewer/fake-lcu";
import {
  buildProbePath,
  findCredentials,
  isProbePath,
  PROBE_ROUTES,
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
    expect(READ_ONLY_PATHS).toContain("/lol-lobby/v2/lobby"); // Teams (M-038)
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

describe("buildProbePath", () => {
  it("fills and encodes path parameters", () => {
    expect(buildProbePath("currentSummoner")).toBe("/lol-summoner/v1/current-summoner");
    expect(buildProbePath("friendGroupFriends", { params: { id: 3 } })).toBe("/lol-chat/v1/friend-groups/3/friends");
    expect(buildProbePath("rankedStats", { params: { puuid: "abc_DEF-1" } })).toBe("/lol-ranked/v1/ranked-stats/abc_DEF-1");
    expect(buildProbePath("game", { params: { gameId: "123456789" } })).toBe("/lol-match-history/v1/games/123456789");
    expect(buildProbePath("summonerByPuuid", { params: { puuid: "p" } })).toBe("/lol-summoner/v2/summoners/puuid/p");
    expect(buildProbePath("summonerByPuuidCached", { params: { puuid: "p" } })).toBe("/lol-summoner/v1/summoners-by-puuid-cached/p");
  });
  it("builds queries: ints, Riot ID (# encoded) and the three list styles", () => {
    expect(buildProbePath("matches", { params: { puuid: "p" }, query: { begIndex: 0, endIndex: 20 } })).toBe(
      "/lol-match-history/v1/products/lol/p/matches?begIndex=0&endIndex=20",
    );
    expect(buildProbePath("summonerByName", { query: { name: "Some Name#JP1" } })).toBe("/lol-summoner/v1/summoners?name=Some+Name%23JP1");
    const list = ["a", "b"];
    expect(buildProbePath("rankedStatsBatch", { query: { puuids: { list, style: "json" } } })).toBe(
      "/lol-ranked/v1/ranked-stats?puuids=" + encodeURIComponent('["a","b"]'),
    );
    expect(buildProbePath("rankedStatsBatch", { query: { puuids: { list, style: "comma" } } })).toBe("/lol-ranked/v1/ranked-stats?puuids=a%2Cb");
    expect(buildProbePath("rankedStatsBatch", { query: { puuids: { list, style: "repeat" } } })).toBe("/lol-ranked/v1/ranked-stats?puuids=a&puuids=b");
  });
  it("throws on invalid input before anything is requested", () => {
    expect(() => buildProbePath("rankedStats", { params: { puuid: "../x" } })).toThrow();
    expect(() => buildProbePath("rankedStats", { params: { puuid: "" } })).toThrow();
    expect(() => buildProbePath("rankedStats", {})).toThrow();
    expect(() => buildProbePath("game", { params: { gameId: "12a" } })).toThrow();
    expect(() => buildProbePath("game", { params: { gameId: -1 } })).toThrow();
    expect(() => buildProbePath("game", { params: { gameId: 1.5 } })).toThrow();
    expect(() => buildProbePath("currentSummoner", { params: { puuid: "p" } })).toThrow();
    expect(() => buildProbePath("summonerByName", { query: { name: "a#b#c" } })).toThrow();
    expect(() => buildProbePath("summonerByName", { query: { name: "noTag" } })).toThrow();
    expect(() => buildProbePath("summonerByName", { query: { name: "#JP1" } })).toThrow();
    expect(() => buildProbePath("summonerByName", { query: { name: "a#toolongtag" } })).toThrow();
    expect(() => buildProbePath("summonerByName", { query: { name: "a\nb#JP1" } })).toThrow();
    expect(() => buildProbePath("rankedStatsBatch", { query: { puuids: { list: [], style: "json" } } })).toThrow();
    expect(() => buildProbePath("rankedStatsBatch", { query: { puuids: { list: Array.from({ length: 51 }, (_, i) => `p${i}`), style: "json" } } })).toThrow();
    expect(() => buildProbePath("rankedStatsBatch", { query: { puuids: { list: ["a/b"], style: "comma" } } })).toThrow();
    expect(() => buildProbePath("nope" as never)).toThrow();
  });
  it("accepts 50 PUUIDs", () => {
    const list = Array.from({ length: 50 }, (_, i) => `p${i}`);
    expect(buildProbePath("rankedStatsBatch", { query: { puuids: { list, style: "comma" } } })).toContain("puuids=");
  });
  it("every built path passes isProbePath; foreign paths do not", () => {
    for (const p of [
      buildProbePath("lobby"),
      buildProbePath("friends"),
      buildProbePath("recentlyPlayed"),
      buildProbePath("rankedStats", { params: { puuid: "p" } }),
      buildProbePath("matches", { params: { puuid: "p" }, query: { begIndex: 0, endIndex: 100 } }),
      buildProbePath("summonerByName", { query: { name: "A b#JP1" } }),
      buildProbePath("rankedStatsBatch", { query: { puuids: { list: ["a", "b"], style: "json" } } }),
      buildProbePath("rankedStatsBatch", { query: { puuids: { list: ["a", "b"], style: "comma" } } }),
      buildProbePath("rankedStatsBatch", { query: { puuids: { list: ["a", "b"], style: "repeat" } } }),
      "/lol-gameflow/v1/gameflow-phase", // READ_ONLY_PATHS
    ])
      expect(isProbePath(p), p).toBe(true);
    for (const p of [
      "/lol-chat/v1/me",
      "/lol-lobby/v2/lobby/members",
      "/lol-ranked/v1/ranked-stats/a/b",
      "/lol-ranked/v1/ranked-stats/..%2Fx",
      "/lol-lobby/v2/lobby?x=1",
      "/lol-match-history/v1/games/abc",
      "/lol-lobby/v2/lobby#x",
      "http://evil/lol-lobby/v2/lobby",
      "",
      // query values are checked too, not only the keys
      "/lol-lobby/v2/lobby?",
      "/lol-summoner/v1/summoners?name=%00anything&name=x",
      "/lol-summoner/v1/summoners?name=noTag",
      "/lol-summoner/v1/summoners",
      "/lol-match-history/v1/products/lol/p/matches?begIndex=-5&endIndex=20",
      "/lol-match-history/v1/products/lol/p/matches?begIndex=0",
      "/lol-match-history/v1/products/lol/p/matches?begIndex=0&endIndex=20&begIndex=1",
      "/lol-ranked/v1/ranked-stats?puuids=%5B%22a%22%2C%22..%2Fx%22%5D",
      "/lol-ranked/v1/ranked-stats?puuids=a,,b",
      "/lol-ranked/v1/ranked-stats?puuids=%5Bbroken",
    ])
      expect(isProbePath(p), p).toBe(false);
  });
  it("only has GET-shaped route templates", () => {
    expect(Object.keys(PROBE_ROUTES)).toHaveLength(13);
  });
});

describe("LcuClient probe with fake LCU", () => {
  let fake: FakeLcu | null = null;
  let stop: (() => void) | null = null;
  afterEach(async () => {
    stop?.();
    stop = null;
    await fake?.close();
    fake = null;
  });
  const start = async (lines: { t: number; uri: string; eventType: "Update"; data: unknown }[]) => {
    fake = await startFakeLcu({ lines });
    await fake.done;
    const statuses: string[] = [];
    const conn = startLcuConnector({
      findCredentials: () => findCredentials([fake!.lockfilePath]),
      onEvent: () => {},
      onStatus: (s) => statuses.push(s),
      retryMs: 20,
    });
    stop = conn.stop;
    return { conn, statuses };
  };

  it("reports status, time and body; matches path+query exactly; 404 has a body too", async () => {
    const { conn, statuses } = await start([
      { t: 0, uri: "/lol-ranked/v1/ranked-stats/player-1", eventType: "Update", data: { tier: "GOLD" } },
      { t: 0, uri: "/lol-match-history/v1/products/lol/player-1/matches?begIndex=0&endIndex=20", eventType: "Update", data: { n: 20 } },
    ]);
    await until(() => statuses.includes("connected"));
    const ok = await conn.probe(buildProbePath("rankedStats", { params: { puuid: "player-1" } }));
    expect(ok).toMatchObject({ status: 200, body: { tier: "GOLD" } });
    expect(ok.ms).toBeGreaterThanOrEqual(0);
    const q = await conn.probe(buildProbePath("matches", { params: { puuid: "player-1" }, query: { begIndex: 0, endIndex: 20 } }));
    expect(q.body).toEqual({ n: 20 });
    const other = await conn.probe(buildProbePath("matches", { params: { puuid: "player-1" }, query: { begIndex: 20, endIndex: 40 } }));
    expect(other.status).toBe(404);
    expect(other.body).toEqual({ httpStatus: 404 });
    expect(fake!.rejectedWrites).toEqual([]);
  });

  it("rejects paths that are neither READ_ONLY_PATHS nor probe routes, and reports network when not connected", async () => {
    const { conn, statuses } = await start([]);
    await expect(conn.probe("/lol-chat/v1/me")).rejects.toThrow();
    await until(() => statuses.includes("connected"));
    await expect(conn.probe("/lol-chat/v1/me")).rejects.toThrow();
    conn.stop();
    expect(await conn.probe("/lol-lobby/v2/lobby")).toEqual({ status: 0, ms: 0, body: null, error: "network" });
  });
});
