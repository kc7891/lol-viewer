import { describe, expect, it } from "vitest";
import type { ProbeBuildArgs, ProbeResponse, ProbeRouteId } from "@lol-viewer/protocol";
import type { ProbeBuild } from "../lcu-probe.ts";
import { emptyCache, parseCacheFile, type TeamCacheFile } from "./cache.ts";
import { TeamFetcher } from "./fetcher.ts";

const NOW0 = 1_700_000_000_000;
const DAY = 86_400_000;
const build: ProbeBuild = (id, args = {}) => {
  if (Object.values(args.params ?? {}).some((v) => /[^A-Za-z0-9_-]/.test(String(v)))) throw new Error("invalid parameter");
  return JSON.stringify({ id, args });
};
const ok = (body: unknown, ms = 10): ProbeResponse => ({ status: 200, ms, body });
const flush = () => new Promise<void>((r) => setImmediate(r));

const rankBody = (tier: string, division = "II", lp = 0) => ({
  queueMap: { RANKED_SOLO_5x5: { tier, division, leaguePoints: lp, isProvisional: false }, RANKED_FLEX_SR: { tier: "", division: "NA" } },
});
const UNRANKED = { queueMap: { RANKED_SOLO_5x5: { tier: "", division: "NA" }, RANKED_FLEX_SR: { tier: "NONE", division: "NA" } } };

type Call = { id: ProbeRouteId; args: ProbeBuildArgs };
type Handler = (c: Call) => ProbeResponse | Promise<ProbeResponse>;

function setup(handlers: Partial<Record<ProbeRouteId, Handler>>, o: { workers?: number; file?: TeamCacheFile; pollMs?: number; sleep?: (ms: number) => Promise<void> } = {}) {
  let t = NOW0;
  const calls: Call[] = [];
  const changes: number[] = [];
  const file = o.file ?? emptyCache();
  const fetcher = new TeamFetcher({
    get: async (path) => {
      const c = JSON.parse(path) as Call;
      calls.push(c);
      const h = handlers[c.id];
      return h ? h(c) : { status: 404, ms: 1, body: null };
    },
    build,
    now: () => t,
    sleep: o.sleep ?? (async (ms) => { t += ms; }),
    file,
    onChange: () => changes.push(t),
    workers: o.workers ?? 1,
    pollMs: o.pollMs,
  });
  const count = (id: ProbeRouteId) => calls.filter((c) => c.id === id).length;
  const seq = (id: ProbeRouteId, key: "puuid" | "gameId" = "puuid") => calls.filter((c) => c.id === id).map((c) => String(c.args.params?.[key]));
  return { fetcher, calls, file, changes, count, seq, now: () => t, advance: (ms: number) => { t += ms; } };
}

const matchRow = (gameId: number, queueId: number, daysAgo: number, lane: string, role = "NONE", puuid?: string) => ({
  gameId, queueId, gameCreation: NOW0 - daysAgo * DAY,
  participants: [{ timeline: { lane, role }, spell1Id: 4, spell2Id: 14 }],
  participantIdentities: [{ player: { puuid } }],
});
const matchList = (rows: unknown[]) => ok({ games: { games: rows } });

/** A game detail with `me` and 9 others named `g{id}o{k}`. */
const gameBody = (id: number, me: string, daysAgo = 1) => {
  const ids = [me, ...Array.from({ length: 9 }, (_, k) => `g${id}o${k}`)];
  return ok({
    gameId: id, queueId: 400, gameCreation: NOW0 - daysAgo * DAY,
    participants: ids.map((_, i) => ({ participantId: i + 1, teamId: i < 5 ? 100 : 200 })),
    participantIdentities: ids.map((p, i) => ({ participantId: i + 1, player: { puuid: p, gameName: "X", tagLine: "Y" } })),
  });
};

const base = (puuid: string): Partial<Record<ProbeRouteId, Handler>> => ({
  summonerByPuuid: () => ok({ gameName: "Alice", tagLine: "JP1" }),
  rankedStats: () => ok(rankBody("GOLD", "II", 40)),
  matches: () => matchList([matchRow(1, 420, 1, "MIDDLE", "SOLO", puuid), matchRow(2, 400, 2, "NONE", "SUPPORT", puuid), matchRow(3, 2400, 2, "TOP", "SOLO", puuid)]),
});

describe("TeamFetcher light fetch", () => {
  it("reads name, ranked stats and the match list", async () => {
    const s = setup(base("u1"));
    s.fetcher.ensure(["u1"], { priority: "lobby", mode: "stale", addedBy: "lobby" });
    await s.fetcher.idle();
    expect(s.calls.map((c) => c.id)).toEqual(["summonerByPuuid", "rankedStats", "matches"]);
    expect(s.calls[2]!.args).toEqual({ params: { puuid: "u1" }, query: { begIndex: 0, endIndex: 20 } });
    const p = s.file.players.u1!;
    expect(p).toMatchObject({ gameName: "Alice", tagLine: "JP1", addedBy: "lobby", error: null, estimate: null });
    expect(p.rank!.solo).toMatchObject({ tier: "GOLD", points: 1440 });
    expect(p.rank!.fetchedAt).toBeGreaterThanOrEqual(NOW0);
    expect(p.rank!.fetchedAt).toBeLessThan(NOW0 + 5000);
    expect(s.file.playerGames.u1!.map((g) => [g.gameId, g.lane])).toEqual([[1, "middle"], [2, "support"], [3, "top"]]);
    expect(p.lanes!.counts).toEqual({ top: 0, jungle: 0, middle: 1, bottom: 0, support: 1 }); // queue 2400 is not counted
    expect(s.changes.length).toBeGreaterThan(0);
    expect(parseCacheFile(JSON.parse(JSON.stringify(s.file)))).toEqual(s.file);
  });
  it("keeps the old name when the Riot ID changed, at most 3", async () => {
    let n = 0;
    const s = setup({ ...base("u1"), summonerByPuuid: () => ok({ gameName: `Name${n++}`, tagLine: "T" }) });
    for (let i = 0; i < 5; i++) {
      s.fetcher.refresh("u1");
      await s.fetcher.idle();
    }
    expect(s.file.players.u1).toMatchObject({ gameName: "Name4", previousNames: ["Name3#T", "Name2#T", "Name1#T"] });
  });
  it("ignores match rows of another player and merges rows by gameId", async () => {
    const s = setup({ ...base("u1"), matches: () => matchList([matchRow(1, 420, 1, "TOP", "SOLO", "someone-else"), matchRow(2, 420, 1, "TOP", "SOLO", "u1")]) });
    s.fetcher.refresh("u1");
    await s.fetcher.idle();
    s.fetcher.refresh("u1");
    await s.fetcher.idle();
    expect(s.file.playerGames.u1!.map((g) => g.gameId)).toEqual([2]);
  });
  it("stores a fixed message and goes on when a request fails", async () => {
    const s = setup({ ...base("u1"), rankedStats: () => ({ status: 500, ms: 5, body: { message: "secret" } }) });
    s.fetcher.ensure(["u1"], { priority: "prefetch", mode: "stale" });
    await s.fetcher.idle();
    expect(s.file.players.u1!.error).toBe("League Client returned 500");
    expect(s.file.players.u1!.lanes).not.toBeNull();
    expect(JSON.stringify(s.file)).not.toContain("secret");
    expect(s.fetcher.status()).toMatchObject({ done: 1, total: 1, failed: 1, running: false });
  });
  it("treats an invalid PUUID as nothing to do", async () => {
    const s = setup(base("u1"));
    s.fetcher.ensure(["bad id!", ""], { priority: "lobby", mode: "all" });
    await s.fetcher.idle();
    expect(s.calls).toEqual([]);
  });
});

describe("TeamFetcher staleness and de-duplication", () => {
  it("skips fresh people in stale mode and fetches everything in all mode", async () => {
    const s = setup(base("u1"));
    s.fetcher.ensure(["u1"], { priority: "lobby", mode: "stale" });
    await s.fetcher.idle();
    const n = s.calls.length;
    s.fetcher.ensure(["u1"], { priority: "lobby", mode: "stale" });
    await s.fetcher.idle();
    expect(s.calls.length).toBe(n);
    s.advance(4 * DAY);
    s.fetcher.ensure(["u1"], { priority: "lobby", mode: "stale" });
    await s.fetcher.idle();
    expect(s.calls.length).toBe(2 * n);
    s.fetcher.ensure(["u1"], { priority: "lobby", mode: "all" });
    await s.fetcher.idle();
    expect(s.count("rankedStats")).toBe(3);
  });
  it("queues one task per person", async () => {
    const s = setup(base("u1"), { workers: 1 });
    s.fetcher.ensure(["u1", "u2", "u2", "u2"], { priority: "prefetch", mode: "stale" });
    s.fetcher.ensure(["u2", "u2"], { priority: "prefetch", mode: "stale" });
    await s.fetcher.idle();
    expect(s.seq("summonerByPuuid").sort()).toEqual(["u1", "u2"]);
    expect(s.fetcher.status()).toMatchObject({ done: 2, total: 2 });
  });
});

describe("TeamFetcher estimate", () => {
  /** u1 is unranked and has `n` normal games. Everybody else is Gold II. */
  const unranked = (n: number, extra: Partial<Record<ProbeRouteId, Handler>> = {}) =>
    setup(
      {
        summonerByPuuid: () => ok({ gameName: "Alice", tagLine: "JP1" }),
        rankedStats: (c) => ok(c.args.params!.puuid === "u1" ? UNRANKED : rankBody("GOLD", "II", 0)),
        matches: () => matchList(Array.from({ length: n }, (_, i) => matchRow(i + 1, 400, i + 1, "MIDDLE", "SOLO", "u1"))),
        game: (c) => gameBody(Number(c.args.params!.gameId), "u1", Number(c.args.params!.gameId)),
        ...extra,
      },
      { workers: 1 },
    );

  it("runs after the light fetch: game details, then co-players' ranks, then the median", async () => {
    const s = unranked(2);
    s.fetcher.ensure(["u1"], { priority: "lobby", mode: "stale" });
    await s.fetcher.idle();
    expect(s.seq("game", "gameId")).toEqual(["1", "2"]);
    expect(s.count("rankedStats")).toBe(1 + 18);
    const e = s.file.players.u1!.estimate!;
    expect(e).toMatchObject({ samples: 18, games: 2, points: 1400, min: 1400, max: 1400 });
    expect(s.file.games["1"]!.participants).toHaveLength(10);
  });
  it("does not estimate a person who has a rank", async () => {
    const s = setup({ ...base("u1"), game: () => gameBody(1, "u1") });
    s.fetcher.ensure(["u1"], { priority: "lobby", mode: "stale" });
    await s.fetcher.idle();
    expect(s.count("game")).toBe(0);
    expect(s.file.players.u1!.estimate).toBeNull();
  });
  it("estimates a ranked person only for all mode or refresh", async () => {
    const s = setup({
      ...base("u1"),
      matches: () => matchList([matchRow(1, 400, 1, "TOP", "SOLO", "u1")]),
      game: () => gameBody(1, "u1"),
    });
    s.fetcher.ensure(["u1"], { priority: "lobby", mode: "all" });
    await s.fetcher.idle();
    expect(s.count("game")).toBe(1);
    expect(s.file.players.u1!.estimate).not.toBeNull();
  });
  it("does not fetch known game details or fresh ranks again", async () => {
    const s = unranked(2);
    s.fetcher.ensure(["u1"], { priority: "lobby", mode: "stale" });
    await s.fetcher.idle();
    const games = s.count("game");
    const ranks = s.count("rankedStats");
    s.fetcher.refresh("u1");
    await s.fetcher.idle();
    expect(s.count("game")).toBe(games);
    expect(s.count("rankedStats")).toBe(ranks + 1); // only u1's own rank
    // after 4 days the co-players' ranks are fetched again, the game details are not
    s.advance(4 * DAY);
    s.fetcher.refresh("u1");
    await s.fetcher.idle();
    expect(s.count("game")).toBe(games);
    expect(s.count("rankedStats")).toBe(ranks + 1 + 1 + 18);
  });
  it("stops fetching games once 40 ranked people are counted", async () => {
    const s = unranked(10);
    s.fetcher.ensure(["u1"], { priority: "lobby", mode: "stale" });
    await s.fetcher.idle();
    expect(s.count("game")).toBe(5);
    expect(s.file.players.u1!.estimate).toMatchObject({ samples: 45, games: 5 });
  });
  it("uses a co-player's fresh rank from the cache without a request", async () => {
    const s = unranked(1);
    s.fetcher.ensure(["g1o0"], { priority: "lobby", mode: "stale" });
    await s.fetcher.idle();
    const before = s.count("rankedStats");
    s.fetcher.ensure(["u1"], { priority: "lobby", mode: "stale" });
    await s.fetcher.idle();
    expect(s.count("rankedStats")).toBe(before + 1 + 8);
  });
  it("leaves a short note when a game detail cannot be read", async () => {
    const s = unranked(1, { game: () => ({ status: 500, ms: 1, body: null }) });
    s.fetcher.ensure(["u1"], { priority: "lobby", mode: "stale" });
    await s.fetcher.idle();
    expect(s.file.players.u1!.error).toBe("League Client returned 500");
    expect(s.file.players.u1!.estimate).toMatchObject({ points: null, samples: 0 });
  });
});

describe("TeamFetcher priority, cancel and connection", () => {
  it("serves the lobby before the prefetch queue, and a prefetch person's light and estimate together", async () => {
    const s = setup(
      {
        summonerByPuuid: () => ok({ gameName: "N", tagLine: "T" }),
        rankedStats: (c) => ok(String(c.args.params!.puuid).startsWith("g") ? rankBody("GOLD") : UNRANKED),
        matches: (c) => matchList([matchRow({ pa: 100, pb: 200, pc: 300, lobby1: 400 }[String(c.args.params!.puuid)]!, 400, 1, "TOP", "SOLO", String(c.args.params!.puuid))]),
        game: (c) => gameBody(Number(c.args.params!.gameId), "x"),
      },
      { workers: 1 },
    );
    s.fetcher.ensure(["pa", "pb", "pc"], { priority: "prefetch", mode: "stale" });
    s.fetcher.ensure(["lobby1"], { priority: "lobby", mode: "stale" });
    await s.fetcher.idle();
    const tag = s.calls
      .filter((c) => c.id === "summonerByPuuid" || c.id === "game")
      .map((c) => (c.id === "game" ? `game:${c.args.params!.gameId}` : String(c.args.params!.puuid)));
    // pa starts at once (workers = 1); lobby1 jumps ahead of pb and pc; each person's estimate follows their light fetch
    expect(tag).toEqual(["pa", "lobby1", "game:400", "game:100", "pb", "game:200", "pc", "game:300"]);
  });
  it("cancels the prefetch: queued people are dropped and the running one stops", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const s = setup(
      { ...base("u1"), rankedStats: async (c) => { if (c.args.params!.puuid === "u1") await gate; return ok(rankBody("GOLD")); } },
      { workers: 1 },
    );
    s.fetcher.ensure(["u1", "u2", "u3"], { priority: "prefetch", mode: "stale" });
    await flush();
    expect(s.fetcher.status()).toMatchObject({ running: true, total: 3, current: "u1" });
    s.fetcher.cancelPrefetch();
    expect(s.fetcher.status()).toMatchObject({ running: false, total: 0, done: 0 });
    release();
    await s.fetcher.idle();
    expect(s.seq("summonerByPuuid")).toEqual(["u1"]);
    expect(s.count("matches")).toBe(0); // stopped before the next request of u1
    // a new prefetch afterwards works
    s.fetcher.ensure(["u2"], { priority: "prefetch", mode: "stale" });
    await s.fetcher.idle();
    expect(s.file.players.u2!.rank).not.toBeNull();
  });
  it("does not cancel lobby work", async () => {
    const s = setup(base("u1"), { workers: 1 });
    s.fetcher.ensure(["u1"], { priority: "lobby", mode: "stale" });
    s.fetcher.cancelPrefetch();
    await s.fetcher.idle();
    expect(s.file.players.u1!.rank).not.toBeNull();
  });
  it("waits while the League Client is not reachable, and goes on when it is back", async () => {
    let up = false;
    const s = setup({ ...base("u1"), summonerByPuuid: () => (up ? ok({ gameName: "A", tagLine: "T" }) : { status: 0, ms: 0, body: null, error: "network" }) }, { workers: 1 });
    s.fetcher.ensure(["u1", "u2"], { priority: "prefetch", mode: "stale" });
    await flush();
    await flush();
    expect(s.fetcher.status().running).toBe(true);
    expect(s.calls).toHaveLength(1); // one failed try, then it waits
    let idle = false;
    void s.fetcher.idle().then(() => (idle = true));
    await flush();
    expect(idle).toBe(false);
    up = true;
    s.fetcher.setConnected(true);
    await s.fetcher.idle();
    expect(s.fetcher.status()).toMatchObject({ running: false, done: 2, total: 2, failed: 0 });
    expect(s.file.players.u2!.rank).not.toBeNull();
  });
  it("tries again by itself when pollMs is set", async () => {
    let tries = 0;
    const s = setup({ ...base("u1"), summonerByPuuid: () => (++tries > 3 ? ok({ gameName: "A", tagLine: "T" }) : { status: 0, ms: 0, body: null, error: "network" }) }, { pollMs: 5000 });
    s.fetcher.ensure(["u1"], { priority: "lobby", mode: "stale" });
    await s.fetcher.idle();
    expect(tries).toBe(4);
    expect(s.file.players.u1!.gameName).toBe("A");
  });
  it("does not request anything while setConnected(false)", async () => {
    const s = setup(base("u1"));
    s.fetcher.setConnected(false);
    s.fetcher.ensure(["u1"], { priority: "lobby", mode: "stale" });
    await flush();
    expect(s.calls).toEqual([]);
    expect(s.fetcher.fetching()).toEqual(["u1"]);
    s.fetcher.setConnected(true);
    await s.fetcher.idle();
    expect(s.fetcher.fetching()).toEqual([]);
    expect(s.count("rankedStats")).toBe(1);
  });
});

describe("TeamFetcher upkeep", () => {
  it("forgets one person and clears the cache in place", async () => {
    const s = setup(base("u1"));
    s.fetcher.ensure(["u1", "u2"], { priority: "lobby", mode: "stale" });
    await s.fetcher.idle();
    s.fetcher.forget("u1");
    expect(Object.keys(s.file.players)).toEqual(["u2"]);
    expect(s.file.playerGames.u1).toBeUndefined();
    s.fetcher.clearCache();
    expect(s.fetcher.file).toBe(s.file);
    expect(s.file).toEqual(emptyCache());
  });
  it("upserts a person with a known name", () => {
    const s = setup({});
    s.fetcher.upsertPlayer({ puuid: "u9", gameName: "Zed", tagLine: "T1" }, "riotId");
    s.fetcher.upsertPlayer({ puuid: "u9", gameName: "Zed2", tagLine: "T1" }, "friend");
    expect(s.file.players.u9).toMatchObject({ gameName: "Zed2", addedBy: "riotId", previousNames: ["Zed#T1"] });
    s.fetcher.upsertPlayer({ puuid: "bad id", gameName: "x", tagLine: "y" });
    expect(Object.keys(s.file.players)).toEqual(["u9"]);
  });
  it("offers rate-limited requests to the caller", async () => {
    const s = setup({ friends: () => ok([]) });
    expect((await s.fetcher.request("friends")).status).toBe(200);
    expect((await s.fetcher.request("rankedStats", { params: { puuid: "bad id" } })).status).toBe(-1);
    expect(s.fetcher.status().rate.requests).toBe(1);
  });
  it("reports progress and the rate", async () => {
    const s = setup(base("u1"));
    s.fetcher.ensure(["u1", "u2"], { priority: "prefetch", mode: "stale" });
    expect(s.fetcher.status()).toMatchObject({ running: true, done: 0, total: 2, pausedUntil: null });
    await s.fetcher.idle();
    expect(s.fetcher.status()).toMatchObject({ running: false, done: 2, total: 2, current: null });
    expect(s.fetcher.status().rate.requests).toBe(6);
  });
});

/** A GET that waits until `release()` is called. */
function gate() {
  let release!: () => void;
  const open = new Promise<void>((r) => (release = r));
  return { open, release };
}

describe("TeamFetcher dispose (flag off)", () => {
  it("sends no further GET: running work ends, queued work is dropped, request() answers -1", async () => {
    const g = gate();
    const s = setup({ ...base("u1"), summonerByPuuid: async () => (await g.open, ok({ gameName: "Alice", tagLine: "JP1" })) }, { workers: 1, pollMs: 30_000 });
    s.fetcher.ensure(["u1", "u2"], { priority: "lobby", mode: "stale" });
    await flush();
    expect(s.calls).toHaveLength(1); // u1's name is in flight, u2 is queued
    s.fetcher.dispose();
    g.release();
    await s.fetcher.idle();
    await flush();
    s.advance(120_000);
    await flush();
    expect(s.calls).toHaveLength(1);
    expect((await s.fetcher.request("friends")).status).toBe(-1);
    s.fetcher.ensure(["u3"], { priority: "lobby", mode: "stale" });
    await flush();
    expect(s.calls).toHaveLength(1);
    expect(s.file.players.u1!.rank).toBeNull(); // nothing is written after the dispose
  });

  it("does not come back after the poll interval when the client was unreachable", async () => {
    const wake: (() => void)[] = [];
    const s = setup({ ...base("u1"), summonerByPuuid: () => ({ status: 0, ms: 1, body: null, error: "network" }) }, { workers: 1, pollMs: 30_000, sleep: () => new Promise<void>((r) => wake.push(r)) });
    s.fetcher.ensure(["u1"], { priority: "lobby", mode: "stale" });
    await flush();
    expect(s.calls).toHaveLength(1); // unreachable: now waiting for the poll timer
    s.fetcher.dispose();
    for (const w of wake.splice(0)) w(); // the 30 s timer fires
    await flush();
    await s.fetcher.idle();
    await flush();
    expect(s.calls).toHaveLength(1);
  });

  it("ends a request() that waits for the connection", async () => {
    const s = setup({}, { pollMs: 30_000, sleep: () => new Promise<void>(() => {}) });
    s.fetcher.setConnected(false);
    const r = s.fetcher.request("friends");
    await flush();
    s.fetcher.dispose();
    expect((await r).status).toBe(-1);
    expect(s.calls).toHaveLength(0);
  });
});

describe("TeamFetcher clearCache and forget during a fetch", () => {
  it("clearCache while a lobby fetch runs: the running task writes nothing, and the fetch after it runs and fills the cache", async () => {
    const g = gate();
    let first = true;
    const s = setup({
      ...base("u1"),
      summonerByPuuid: async () => {
        if (first) {
          first = false;
          await g.open;
        }
        return ok({ gameName: "Alice", tagLine: "JP1" });
      },
    });
    s.fetcher.ensure(["u1"], { priority: "lobby", mode: "stale" });
    await flush();
    s.fetcher.clearCache();
    s.fetcher.ensure(["u1"], { priority: "lobby", mode: "stale" }); // what the controller does after clearing
    g.release();
    await s.fetcher.idle();
    const p = s.fetcher.file.players.u1!;
    expect(p.gameName).toBe("Alice");
    expect(p.rank).not.toBeNull();
    expect(p.lanes).not.toBeNull();
    expect(s.count("rankedStats")).toBe(1); // the old task stopped before its next request
  });

  it("forget while a fetch runs: nothing of that person is written afterwards", async () => {
    const g = gate();
    const s = setup({ ...base("u1"), rankedStats: async () => (await g.open, ok(rankBody("GOLD"))) });
    s.fetcher.ensure(["u1"], { priority: "lobby", mode: "stale" });
    await flush();
    s.fetcher.forget("u1");
    g.release();
    await s.fetcher.idle();
    await flush();
    expect(s.count("matches")).toBe(0);
    expect(JSON.stringify(s.file)).not.toContain("u1");
    expect(s.fetcher.fetching()).toEqual([]);
  });
});

describe("TeamFetcher estimate inputs", () => {
  it("a failed match list does not freeze the estimate: it is computed once the list can be read", async () => {
    let up = false;
    const others = Array.from({ length: 9 }, (_, k) => `o${k}`);
    const s = setup(
      {
        summonerByPuuid: () => ok({ gameName: "Alice", tagLine: "JP1" }),
        rankedStats: (c) => ok(c.args.params!.puuid === "u1" ? UNRANKED : rankBody("GOLD", "II", 0)),
        matches: () => (up ? matchList([1, 2, 3].map((n) => matchRow(n, 400, n, "TOP", "SOLO", "u1"))) : { status: 503, ms: 1, body: null }),
        game: (c) => {
          const ids = ["u1", ...others];
          return ok({
            queueId: 400, gameCreation: NOW0 - Number(c.args.params!.gameId) * DAY,
            participants: ids.map((_, i) => ({ participantId: i + 1, teamId: i < 5 ? 100 : 200 })),
            participantIdentities: ids.map((p, i) => ({ participantId: i + 1, player: { puuid: p } })),
          });
        },
      },
      { workers: 1 },
    );
    s.fetcher.ensure(["u1"], { priority: "lobby", mode: "stale" });
    await s.fetcher.idle();
    expect(s.file.players.u1!.estimate).toBeNull(); // not stamped from nothing
    up = true;
    s.advance(60_000);
    s.fetcher.ensure(["u1"], { priority: "lobby", mode: "stale" });
    await s.fetcher.idle();
    expect(s.file.players.u1!.lanes?.games).toBe(3);
    expect(s.file.players.u1!.estimate!.samples).toBeGreaterThan(0);
  });

  it("an estimate made with a failed input is retried by the next ensure, and a new game makes a fresh one outdated", async () => {
    let gameUp = false;
    const s = setup(
      {
        summonerByPuuid: () => ok({ gameName: "Alice", tagLine: "JP1" }),
        rankedStats: (c) => ok(c.args.params!.puuid === "u1" ? UNRANKED : rankBody("GOLD", "II", 0)),
        matches: () => matchList([matchRow(1, 400, 1, "TOP", "SOLO", "u1")]),
        game: (c) => (gameUp ? gameBody(Number(c.args.params!.gameId), "u1") : { status: 500, ms: 1, body: null }),
      },
      { workers: 1 },
    );
    s.fetcher.ensure(["u1"], { priority: "lobby", mode: "stale" });
    await s.fetcher.idle();
    expect(s.file.players.u1!.error).toBe("League Client returned 500");
    gameUp = true;
    s.fetcher.ensure(["u1"], { priority: "lobby", mode: "stale" });
    await s.fetcher.idle();
    expect(s.file.players.u1!.estimate!.samples).toBeGreaterThan(0);
    expect(s.file.players.u1!.error).toBeNull();
    const games = s.count("game");
    s.fetcher.ensure(["u1"], { priority: "lobby", mode: "stale" });
    await s.fetcher.idle();
    expect(s.count("game")).toBe(games); // complete and fresh: left alone
    // A newer game appears in the match list (the light data is refreshed by hand).
    s.file.playerGames.u1!.unshift({ gameId: 9, at: NOW0, queueId: 400, lane: "top" });
    s.fetcher.ensure(["u1"], { priority: "lobby", mode: "stale" });
    await s.fetcher.idle();
    expect(s.seq("game", "gameId")).toContain("9");
  });
});

describe("TeamFetcher retries and progress", () => {
  it("fetches again a person whose name lookup failed, or whose last fetch had an error", async () => {
    let nameUp = false;
    const s = setup({ ...base("u1"), summonerByPuuid: () => (nameUp ? ok({ gameName: "Alice", tagLine: "JP1" }) : { status: 500, ms: 1, body: null }) });
    s.fetcher.ensure(["u1"], { priority: "lobby", mode: "stale" });
    await s.fetcher.idle();
    expect(s.file.players.u1!.gameName).toBe("");
    expect(s.file.players.u1!.rank).not.toBeNull(); // rank and lanes are fresh, only the name is missing
    nameUp = true;
    s.fetcher.ensure(["u1"], { priority: "lobby", mode: "stale" });
    await s.fetcher.idle();
    expect(s.file.players.u1!.gameName).toBe("Alice");
    expect(s.file.players.u1!.error).toBeNull();
    const n = s.count("summonerByPuuid");
    s.fetcher.ensure(["u1"], { priority: "lobby", mode: "stale" });
    await s.fetcher.idle();
    expect(s.count("summonerByPuuid")).toBe(n); // healthy and fresh: left alone
  });

  it("adds up the chunks of one prefetch action, and starts again at 0 for a later one", async () => {
    const s = setup(base("u1"));
    s.fetcher.ensure(["u1", "u2"], { priority: "prefetch", mode: "stale" });
    await s.fetcher.idle();
    s.fetcher.ensure(["u3", "u4", "u5"], { priority: "prefetch", mode: "stale" }); // the next chunk of the same click
    expect(s.fetcher.status()).toMatchObject({ done: 2, total: 5 });
    await s.fetcher.idle();
    expect(s.fetcher.status()).toMatchObject({ running: false, done: 5, total: 5 });
    s.advance(60_000);
    s.fetcher.ensure(["u6"], { priority: "prefetch", mode: "stale" });
    expect(s.fetcher.status()).toMatchObject({ done: 0, total: 1 });
    await s.fetcher.idle();
    s.fetcher.ensure(["u7", "u8"], { priority: "prefetch", mode: "stale" });
    s.fetcher.cancelPrefetch();
    s.fetcher.ensure(["u9"], { priority: "prefetch", mode: "stale" });
    expect(s.fetcher.status()).toMatchObject({ done: 0, total: 1 });
    await s.fetcher.idle();
  });
});
