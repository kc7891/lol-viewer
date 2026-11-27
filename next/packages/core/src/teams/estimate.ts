/** Rank estimate for unranked players: the median rank of the people they played normals with (M-038). Pure. */
import type { RankEstimate } from "@lol-viewer/protocol";
import { freshness, GAME_WINDOW_MS, type TeamCacheFile } from "./cache.ts";
import { NORMAL_QUEUES } from "./lanes.ts";

export const ESTIMATE_MAX_GAMES = 10;
/** Stop taking more games once this many ranked co-players are counted. */
export const ESTIMATE_MAX_SAMPLES = 40;
/** Fewer ranked co-players than this: no estimate. */
export const ESTIMATE_MIN_SAMPLES = 15;

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** The target's newest normal games within 60 days (at most 10), newest first. */
export function estimateGameIds(target: string, file: TeamCacheFile, now: number): number[] {
  return (file.playerGames[target] ?? [])
    .filter((g) => NORMAL_QUEUES.includes(g.queueId) && now - g.at <= GAME_WINDOW_MS)
    .sort((a, b) => b.at - a.at)
    .slice(0, ESTIMATE_MAX_GAMES)
    .map((g) => g.gameId);
}

/** A co-player's rank that may be used (not older than 14 days). */
export function coRankPoints(file: TeamCacheFile, puuid: string, now: number): number | null | undefined {
  const c = file.coRanks[puuid];
  if (!c) return undefined;
  const f = freshness(c.fetchedAt, now);
  return f === "fresh" || f === "stale" ? c.points : undefined;
}

/**
 * Median rank of the 9 other people in the target's recent normals. Games are taken newest first and
 * stop after the game that brings the count to 40. Under 15 ranked people: `points` is null.
 */
export function estimateRank(target: string, file: TeamCacheFile, now: number): RankEstimate {
  const perGame: RankEstimate["perGame"] = [];
  const all: number[] = [];
  for (const id of estimateGameIds(target, file, now)) {
    const g = file.games[String(id)];
    if (!g) continue;
    const pts: number[] = [];
    for (const p of g.participants) {
      if (p.puuid === target) continue;
      const v = coRankPoints(file, p.puuid, now);
      if (typeof v === "number") pts.push(v);
    }
    perGame.push({ at: g.at, queueId: g.queueId, median: pts.length ? Math.round(median(pts)) : null, samples: pts.length });
    all.push(...pts);
    if (all.length >= ESTIMATE_MAX_SAMPLES) break;
  }
  const enough = all.length >= ESTIMATE_MIN_SAMPLES;
  return {
    points: enough ? Math.round(median(all)) : null,
    samples: all.length,
    games: perGame.length,
    min: all.length ? Math.min(...all) : null,
    max: all.length ? Math.max(...all) : null,
    perGame,
    fetchedAt: now,
  };
}

/** What is still needed for an estimate: games without a detail, and people whose rank is missing or older than 3 days (only for games whose detail is known, up to the 40-person stop). */
export function missingForEstimate(target: string, file: TeamCacheFile, now: number): { gameIds: number[]; puuids: string[] } {
  const gameIds: number[] = [];
  const puuids = new Set<string>();
  let counted = 0;
  for (const id of estimateGameIds(target, file, now)) {
    const g = file.games[String(id)];
    if (!g) {
      gameIds.push(id);
      continue;
    }
    for (const p of g.participants) {
      if (p.puuid === target) continue;
      const c = file.coRanks[p.puuid];
      if (!c || freshness(c.fetchedAt, now) !== "fresh") puuids.add(p.puuid);
      const v = coRankPoints(file, p.puuid, now);
      if (typeof v === "number") counted++;
    }
    if (counted >= ESTIMATE_MAX_SAMPLES) break;
  }
  return { gameIds, puuids: [...puuids] };
}
