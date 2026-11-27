/** Rank points, parsing the client's ranked-stats body, and the rank shown for a player (Teams, M-038). */
import type { PlayerRank, RankEntry, RankEstimate } from "@lol-viewer/protocol";
import { freshness } from "./cache.ts";

export const TIER_BASE: Record<string, number> = {
  IRON: 0,
  BRONZE: 400,
  SILVER: 800,
  GOLD: 1200,
  PLATINUM: 1600,
  EMERALD: 2000,
  DIAMOND: 2400,
};
/** Master and above: 2800 + LP. */
export const MASTER_BASE = 2800;
const APEX = new Set(["MASTER", "GRANDMASTER", "CHALLENGER"]);
const DIVISION_POINTS: Record<string, number> = { IV: 0, III: 100, II: 200, I: 300 };
export const TIER_INITIAL: Record<string, string> = {
  IRON: "I",
  BRONZE: "B",
  SILVER: "S",
  GOLD: "G",
  PLATINUM: "P",
  EMERALD: "E",
  DIAMOND: "D",
  MASTER: "M",
  GRANDMASTER: "GM",
  CHALLENGER: "C",
};

/** Points for a tier / division / LP, or null for an unknown tier or division. */
export function rankPoints(tier: string, division: string, lp: number): number | null {
  const t = tier.toUpperCase();
  const points = Number.isFinite(lp) ? Math.max(0, lp) : 0;
  if (APEX.has(t)) return MASTER_BASE + points;
  const base = TIER_BASE[t];
  const div = DIVISION_POINTS[division.toUpperCase()];
  if (base === undefined || div === undefined) return null;
  return base + div + Math.min(points, 100);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function entryFrom(tier: unknown, division: unknown, lp: unknown): RankEntry | null {
  const t = str(tier).toUpperCase();
  if (t === "" || t === "NONE") return null;
  const d = str(division).toUpperCase();
  const apex = APEX.has(t);
  if (!apex && (d === "" || d === "NA")) return null;
  const lpN = typeof lp === "number" && Number.isFinite(lp) ? Math.max(0, Math.round(lp)) : 0;
  const points = rankPoints(t, d, lpN);
  return points === null ? null : { tier: t, division: apex ? "NA" : d, lp: lpN, points };
}

/** Read `queueMap.RANKED_SOLO_5x5` / `RANKED_FLEX_SR` of a ranked-stats body. Provisional or unranked queues are null. */
export function parseRankedStats(body: unknown): Omit<PlayerRank, "fetchedAt"> {
  const map = isObj(body) && isObj(body.queueMap) ? body.queueMap : {};
  const queue = (k: string): RankEntry | null => {
    const q = map[k];
    if (!isObj(q) || q.isProvisional === true) return null;
    return entryFrom(q.tier, q.division, q.leaguePoints);
  };
  const solo = isObj(map.RANKED_SOLO_5x5) ? map.RANKED_SOLO_5x5 : {};
  return {
    solo: queue("RANKED_SOLO_5x5"),
    flex: queue("RANKED_FLEX_SR"),
    prevSeason: entryFrom(solo.previousSeasonEndTier, solo.previousSeasonEndDivision, 0),
  };
}

export type RankSource = "manual" | "solo" | "flex" | "estimate" | "prev";
export type EffectiveRank = { points: number; source: RankSource };
export type RankPrefs = { rankOverride?: number };

const usable = (fetchedAt: number, now: number) => {
  const f = freshness(fetchedAt, now);
  return f === "fresh" || f === "stale";
};

/** The rank to balance with: manual override, solo, flex, estimate, previous season, else null. Data older than 14 days is not used. */
export function effectiveRank(
  player: { rank: PlayerRank | null; estimate: RankEstimate | null } | null | undefined,
  prefs: RankPrefs | null | undefined,
  now: number,
): EffectiveRank | null {
  if (prefs?.rankOverride !== undefined && Number.isFinite(prefs.rankOverride)) return { points: prefs.rankOverride, source: "manual" };
  const rank = player?.rank && usable(player.rank.fetchedAt, now) ? player.rank : null;
  if (rank?.solo) return { points: rank.solo.points, source: "solo" };
  if (rank?.flex) return { points: rank.flex.points, source: "flex" };
  const est = player?.estimate;
  if (est && est.points !== null && usable(est.fetchedAt, now)) return { points: est.points, source: "estimate" };
  if (rank?.prevSeason) return { points: rank.prevSeason.points, source: "prev" };
  return null;
}

/** `G2`, `G2 (Flex)`, `~G3` (estimate), `G1 (prev)`; Master and above `M 120LP`. */
export function rankLabel(points: number, source: RankSource = "solo"): string {
  const p = Math.max(0, Math.round(points));
  let base: string;
  if (p >= MASTER_BASE) {
    base = `M ${p - MASTER_BASE}LP`;
  } else {
    const tierBase = Math.min(2400, Math.floor(p / 400) * 400);
    const tier = Object.keys(TIER_BASE).find((k) => TIER_BASE[k] === tierBase)!;
    const division = 4 - Math.min(3, Math.floor((p - tierBase) / 100));
    base = `${TIER_INITIAL[tier]}${division}`;
  }
  if (source === "flex") return `${base} (Flex)`;
  if (source === "estimate") return `~${base}`;
  if (source === "prev") return `${base} (prev)`;
  return base;
}
