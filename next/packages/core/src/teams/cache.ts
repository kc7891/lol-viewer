/** The Teams cache file: shape, tolerant parsing, freshness and pruning (M-038). Pure; the file I/O lives in main. */
import {
  LaneSchema,
  TeamPlayerSchema,
  type Lane,
  type TeamPlayer,
} from "@lol-viewer/protocol";
import { z } from "zod";

const DAY = 86_400_000;
export const FRESH_MS = 3 * DAY;
export const STALE_MS = 14 * DAY;
export const EXPIRE_MS = 30 * DAY;
export const GAME_WINDOW_MS = 60 * DAY;
export const MAX_PLAYER_GAMES = 100;

export type PlayerGame = { gameId: number; at: number; queueId: number; lane: Lane | null };
export type GameDetail = { at: number; queueId: number; participants: { puuid: string; teamId: number }[] };
export type CoRank = { points: number | null; fetchedAt: number };
export type TeamCacheFile = {
  version: 1;
  players: Record<string, TeamPlayer>;
  /** From the match list (the player's own row). Deduplicated by gameId, at most 100. */
  playerGames: Record<string, PlayerGame[]>;
  /** From the game detail. */
  games: Record<string, GameDetail>;
  /** Rank of people who were in the same games (null = unranked). */
  coRanks: Record<string, CoRank>;
};

export const emptyCache = (): TeamCacheFile => ({ version: 1, players: {}, playerGames: {}, games: {}, coRanks: {} });

const PlayerGameSchema = z.object({
  gameId: z.number().int(),
  at: z.number(),
  queueId: z.number().int(),
  lane: LaneSchema.nullable(),
});
const GameDetailSchema = z.object({
  at: z.number(),
  queueId: z.number().int(),
  participants: z.array(z.object({ puuid: z.string(), teamId: z.number().int() })),
});
const CoRankSchema = z.object({ points: z.number().nullable(), fetchedAt: z.number() });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Parse whatever was on disk. Broken entries are dropped on their own; an unreadable file gives an empty cache. */
export function parseCacheFile(input: unknown): TeamCacheFile {
  const out = emptyCache();
  if (!isObj(input) || input.version !== 1) return out;
  if (isObj(input.players)) {
    for (const [k, v] of Object.entries(input.players)) {
      const r = TeamPlayerSchema.safeParse(v);
      if (r.success && r.data.puuid === k) out.players[k] = r.data;
    }
  }
  if (isObj(input.playerGames)) {
    for (const [k, v] of Object.entries(input.playerGames)) {
      if (!Array.isArray(v)) continue;
      const seen = new Set<number>();
      const list: PlayerGame[] = [];
      for (const g of v) {
        const r = PlayerGameSchema.safeParse(g);
        if (r.success && !seen.has(r.data.gameId)) {
          seen.add(r.data.gameId);
          list.push(r.data);
        }
      }
      out.playerGames[k] = list.sort((a, b) => b.at - a.at).slice(0, MAX_PLAYER_GAMES);
    }
  }
  if (isObj(input.games)) {
    for (const [k, v] of Object.entries(input.games)) {
      const r = GameDetailSchema.safeParse(v);
      if (r.success) out.games[k] = r.data;
    }
  }
  if (isObj(input.coRanks)) {
    for (const [k, v] of Object.entries(input.coRanks)) {
      const r = CoRankSchema.safeParse(v);
      if (r.success) out.coRanks[k] = r.data;
    }
  }
  return out;
}

export type Freshness = "fresh" | "stale" | "unused" | "expired";

/** Age of data: under 3 days fresh, under 14 stale (used, marked), under 30 unused (shown, not used), else expired. */
export function freshness(fetchedAt: number, now: number): Freshness {
  const age = now - fetchedAt;
  if (age <= FRESH_MS) return "fresh";
  if (age <= STALE_MS) return "stale";
  if (age <= EXPIRE_MS) return "unused";
  return "expired";
}

/** Drop what is too old (a new object; the input is not changed): data over 30 days, games over 60 days. Run at start and before saving. */
export function pruneCache(file: TeamCacheFile, now: number): TeamCacheFile {
  const out = emptyCache();
  const alive = (t: number) => now - t <= EXPIRE_MS;
  for (const [k, p] of Object.entries(file.players)) {
    const next: TeamPlayer = {
      ...p,
      rank: p.rank && alive(p.rank.fetchedAt) ? p.rank : null,
      lanes: p.lanes && alive(p.lanes.fetchedAt) ? p.lanes : null,
      estimate: p.estimate && alive(p.estimate.fetchedAt) ? p.estimate : null,
    };
    if (next.rank || next.lanes || next.estimate || alive(p.nameSeenAt)) out.players[k] = next;
  }
  for (const [k, list] of Object.entries(file.playerGames)) {
    const kept = list.filter((g) => now - g.at <= GAME_WINDOW_MS);
    if (kept.length) out.playerGames[k] = kept;
  }
  for (const [k, g] of Object.entries(file.games)) if (now - g.at <= GAME_WINDOW_MS) out.games[k] = g;
  for (const [k, c] of Object.entries(file.coRanks)) if (alive(c.fetchedAt)) out.coRanks[k] = c;
  return out;
}
