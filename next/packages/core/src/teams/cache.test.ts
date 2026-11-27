import { describe, expect, it } from "vitest";
import type { TeamPlayer } from "@lol-viewer/protocol";
import { EXPIRE_MS, FRESH_MS, freshness, parseCacheFile, pruneCache, STALE_MS, emptyCache, type TeamCacheFile } from "./cache.ts";

const NOW = 1_000_000_000_000;
const DAY = 86_400_000;
const player = (id: string, o: Partial<TeamPlayer> = {}): TeamPlayer => ({
  puuid: id, gameName: "P", tagLine: "t", nameSeenAt: NOW, previousNames: [], rank: null, lanes: null, estimate: null, error: null, ...o,
});

describe("freshness", () => {
  it("has its boundaries at 3, 14 and 30 days", () => {
    expect(freshness(NOW, NOW)).toBe("fresh");
    expect(freshness(NOW - FRESH_MS, NOW)).toBe("fresh");
    expect(freshness(NOW - FRESH_MS - 1, NOW)).toBe("stale");
    expect(freshness(NOW - STALE_MS, NOW)).toBe("stale");
    expect(freshness(NOW - STALE_MS - 1, NOW)).toBe("unused");
    expect(freshness(NOW - EXPIRE_MS, NOW)).toBe("unused");
    expect(freshness(NOW - EXPIRE_MS - 1, NOW)).toBe("expired");
  });
});

describe("parseCacheFile", () => {
  it("gives an empty cache for anything unreadable", () => {
    for (const x of [null, undefined, 3, "x", [], {}, { version: 2, players: {} }]) expect(parseCacheFile(x)).toEqual(emptyCache());
  });
  it("round-trips a good file", () => {
    const f: TeamCacheFile = {
      version: 1,
      players: { a: player("a") },
      playerGames: { a: [{ gameId: 2, at: 20, queueId: 400, lane: "top" }, { gameId: 1, at: 10, queueId: 420, lane: null }] },
      games: { "1": { at: 10, queueId: 400, participants: [{ puuid: "a", teamId: 100 }] } },
      coRanks: { b: { points: null, fetchedAt: 5 } },
    };
    expect(parseCacheFile(JSON.parse(JSON.stringify(f)))).toEqual(f);
  });
  it("drops only the broken items", () => {
    const f = parseCacheFile({
      version: 1,
      players: { a: player("a"), b: { puuid: "b" }, c: player("not-c") },
      playerGames: { a: [{ gameId: 1, at: 1, queueId: 400, lane: "top" }, { gameId: 1, at: 2, queueId: 400, lane: "top" }, { nope: 1 }], b: "x" },
      games: { "1": { at: 1, queueId: 400, participants: [] }, "2": 5 },
      coRanks: { a: { points: 3, fetchedAt: 1 }, b: { points: "x" } },
    });
    expect(Object.keys(f.players)).toEqual(["a"]);
    expect(f.playerGames.a).toHaveLength(1);
    expect(f.playerGames.b).toBeUndefined();
    expect(Object.keys(f.games)).toEqual(["1"]);
    expect(Object.keys(f.coRanks)).toEqual(["a"]);
  });
  it("keeps at most 100 games per player, newest first", () => {
    const rows = Array.from({ length: 130 }, (_, i) => ({ gameId: i, at: i, queueId: 400, lane: null }));
    const f = parseCacheFile({ version: 1, playerGames: { a: rows } });
    expect(f.playerGames.a).toHaveLength(100);
    expect(f.playerGames.a![0]!.gameId).toBe(129);
  });
});

describe("pruneCache", () => {
  it("removes what is too old and keeps the rest", () => {
    const rank = (age: number) => ({ solo: null, flex: null, prevSeason: null, fetchedAt: NOW - age });
    const f: TeamCacheFile = {
      version: 1,
      players: {
        keep: player("keep", { rank: rank(5 * DAY) }),
        partly: player("partly", { rank: rank(31 * DAY), lanes: { counts: { top: 1, jungle: 0, middle: 0, bottom: 0, support: 0 }, games: 1, fetchedAt: NOW - DAY }, nameSeenAt: NOW - 40 * DAY }),
        gone: player("gone", { rank: rank(31 * DAY), nameSeenAt: NOW - 31 * DAY }),
        nameOnly: player("nameOnly", { nameSeenAt: NOW - 29 * DAY }),
      },
      playerGames: {
        keep: [{ gameId: 1, at: NOW - 59 * DAY, queueId: 400, lane: null }, { gameId: 2, at: NOW - 61 * DAY, queueId: 400, lane: null }],
        old: [{ gameId: 3, at: NOW - 61 * DAY, queueId: 400, lane: null }],
      },
      games: { "1": { at: NOW - 59 * DAY, queueId: 400, participants: [] }, "2": { at: NOW - 61 * DAY, queueId: 400, participants: [] } },
      coRanks: { a: { points: 1, fetchedAt: NOW - 29 * DAY }, b: { points: 1, fetchedAt: NOW - 31 * DAY } },
    };
    const p = pruneCache(f, NOW);
    expect(Object.keys(p.players).sort()).toEqual(["keep", "nameOnly", "partly"]);
    expect(p.players.partly!.rank).toBeNull();
    expect(p.players.partly!.lanes).not.toBeNull();
    expect(p.playerGames.keep).toHaveLength(1);
    expect(p.playerGames.old).toBeUndefined();
    expect(Object.keys(p.games)).toEqual(["1"]);
    expect(Object.keys(p.coRanks)).toEqual(["a"]);
    expect(Object.keys(f.players)).toHaveLength(4); // input untouched
  });
});
