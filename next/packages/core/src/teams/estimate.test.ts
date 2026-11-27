import { describe, expect, it } from "vitest";
import { emptyCache, type TeamCacheFile } from "./cache.ts";
import { estimateRank, missingForEstimate } from "./estimate.ts";

const NOW = 1_000_000_000_000;
const DAY = 86_400_000;
const T = "target";

/** `games` games for T, each with 9 others named `${gameId}-${i}` whose points come from `pts(gameId, i)`. */
function setup(games: { id: number; queueId?: number; daysAgo?: number }[], pts: (id: number, i: number) => number | null | undefined): TeamCacheFile {
  const f = emptyCache();
  f.playerGames[T] = games.map((g) => ({ gameId: g.id, at: NOW - (g.daysAgo ?? g.id) * DAY, queueId: g.queueId ?? 400, lane: null }));
  for (const g of games) {
    const others = Array.from({ length: 9 }, (_, i) => `${g.id}-${i}`);
    f.games[String(g.id)] = { at: NOW - (g.daysAgo ?? g.id) * DAY, queueId: g.queueId ?? 400, participants: [T, ...others].map((puuid, i) => ({ puuid, teamId: i < 5 ? 100 : 200 })) };
    others.forEach((o, i) => {
      const v = pts(g.id, i);
      if (v !== undefined) f.coRanks[o] = { points: v, fetchedAt: NOW };
    });
  }
  return f;
}

describe("estimateRank", () => {
  it("takes the median of every counted co-player and records each game", () => {
    const f = setup([{ id: 1 }, { id: 2 }], (id, i) => 1000 + i * 100 + (id === 2 ? 10 : 0));
    const e = estimateRank(T, f, NOW);
    expect(e.samples).toBe(18);
    expect(e.games).toBe(2);
    expect(e.points).toBe(1405); // 18 values: 1000..1800 and 1010..1810 -> median between 1400 and 1410
    expect(e.min).toBe(1000);
    expect(e.max).toBe(1810);
    expect(e.perGame.map((g) => [g.queueId, g.median, g.samples])).toEqual([[400, 1400, 9], [400, 1410, 9]]);
    expect(e.fetchedAt).toBe(NOW);
  });
  it("skips unranked people and gives null under 15 ranked people", () => {
    const f = setup([{ id: 1 }, { id: 2 }], (id, i) => (id === 1 ? 1200 : i < 5 ? 1200 : null));
    const e = estimateRank(T, f, NOW);
    expect(e.samples).toBe(14);
    expect(e.points).toBeNull();
    const g = setup([{ id: 1 }, { id: 2 }], (id, i) => (id === 1 ? 1200 : i < 6 ? 1200 : undefined));
    expect(estimateRank(T, g, NOW).points).toBe(1200);
    expect(estimateRank(T, g, NOW).samples).toBe(15);
  });
  it("uses only normals within 60 days, newest first", () => {
    const f = setup(
      [
        { id: 1, queueId: 420 },
        { id: 2, queueId: 2400 },
        { id: 3, daysAgo: 61 },
        ...Array.from({ length: 12 }, (_, i) => ({ id: 10 + i, daysAgo: 1 + i * 0.1 })),
      ],
      (id) => (id < 10 ? 9999 : 1000),
    );
    const e = estimateRank(T, f, NOW);
    expect(e.points).toBe(1000);
    expect(e.games).toBe(5); // 10 normals are eligible; the cut at 40 people ends after 5
  });
  it("takes at most 10 games", () => {
    const f = setup(Array.from({ length: 12 }, (_, i) => ({ id: i + 1 })), (_id, i) => (i < 2 ? 1000 : undefined));
    expect(estimateRank(T, f, NOW).games).toBe(10);
  });
  it("stops after the game that brings the count to 40 people", () => {
    const f = setup(Array.from({ length: 10 }, (_, i) => ({ id: i + 1 })), () => 1500);
    const e = estimateRank(T, f, NOW);
    expect(e.games).toBe(5); // 45 people
    expect(e.samples).toBe(45);
  });
  it("ignores the target's own rank and ranks older than 14 days", () => {
    const f = setup([{ id: 1 }], () => 1500);
    f.coRanks[T] = { points: 3000, fetchedAt: NOW };
    f.coRanks["1-0"] = { points: 0, fetchedAt: NOW - 20 * DAY };
    expect(estimateRank(T, f, NOW).samples).toBe(8);
  });
  it("is empty for a person without games", () => {
    expect(estimateRank("nobody", emptyCache(), NOW)).toMatchObject({ points: null, samples: 0, games: 0, min: null, max: null });
  });
});

describe("missingForEstimate", () => {
  it("lists games without a detail and people without a fresh rank", () => {
    const f = setup([{ id: 1 }, { id: 2 }], (_id, i) => (i === 0 ? undefined : 1000));
    delete f.games["2"];
    f.coRanks["1-1"] = { points: 1000, fetchedAt: NOW - 4 * DAY };
    expect(missingForEstimate(T, f, NOW)).toEqual({ gameIds: [2], puuids: ["1-0", "1-1"] });
  });
  it("is empty when everything is there", () => {
    expect(missingForEstimate(T, setup([{ id: 1 }], () => 1000), NOW)).toEqual({ gameIds: [], puuids: [] });
  });
});
