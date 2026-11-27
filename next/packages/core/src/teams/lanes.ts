/** Lane detection from the client's match list rows (Teams, M-038). */
import { LANES, type Lane, type LaneProfile } from "@lol-viewer/protocol";
import { GAME_WINDOW_MS, type PlayerGame } from "./cache.ts";

/** Queues counted for lanes: draft, solo, blind, flex, Swiftplay, Quickplay. */
export const COUNTED_QUEUES: readonly number[] = [400, 420, 430, 440, 480, 490];
/** Queues counted for the rank estimate (normals). */
export const NORMAL_QUEUES: readonly number[] = [400, 430, 480, 490];
const SMITE = 11;

export type LaneInput = { lane?: unknown; role?: unknown; spell1Id?: unknown; spell2Id?: unknown };

/** Lane from the old `timeline.lane` / `role` pair (support is role SUPPORT with lane NONE or BOTTOM); Smite makes it jungle. null = not counted. */
export function laneOf(p: LaneInput): Lane | null {
  const role = typeof p.role === "string" ? p.role.toUpperCase() : "";
  const lane = typeof p.lane === "string" ? p.lane.toUpperCase() : "";
  if (role === "SUPPORT" || role === "DUO_SUPPORT") return "support";
  if (lane === "TOP") return "top";
  if (lane === "JUNGLE") return "jungle";
  if (lane === "MIDDLE" || lane === "MID") return "middle";
  if (lane === "BOTTOM") return "bottom";
  if (p.spell1Id === SMITE || p.spell2Id === SMITE) return "jungle";
  return null;
}

/** Count lanes of the counted queues within the last 60 days. `fetchedAt` is `now`. */
export function laneProfileFromGames(games: readonly PlayerGame[], now: number): LaneProfile {
  const counts = Object.fromEntries(LANES.map((l) => [l, 0])) as Record<Lane, number>;
  let n = 0;
  for (const g of games) {
    if (!g.lane || !COUNTED_QUEUES.includes(g.queueId) || now - g.at > GAME_WINDOW_MS) continue;
    counts[g.lane]++;
    n++;
  }
  return { counts, games: n, fetchedAt: now };
}

export type MainLanes = { main: Lane | null; sub: Lane | null; thin: boolean };

/** Main = most played lane; sub = the second if it is at least 20% of the games. Under 5 games is thin. */
export function mainLanes(profile: LaneProfile | null | undefined): MainLanes {
  if (!profile || profile.games === 0) return { main: null, sub: null, thin: true };
  const total = LANES.reduce((s, l) => s + (profile.counts[l] ?? 0), 0);
  const sorted = LANES.map((l, i) => ({ l, c: profile.counts[l] ?? 0, i }))
    .filter((x) => x.c > 0)
    .sort((a, b) => b.c - a.c || a.i - b.i);
  const [first, second] = sorted;
  return {
    main: first?.l ?? null,
    sub: second && total > 0 && second.c / total >= 0.2 ? second.l : null,
    thin: profile.games < 5,
  };
}
