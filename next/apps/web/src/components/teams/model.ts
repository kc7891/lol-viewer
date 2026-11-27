/** Pure helpers of the Teams page (M-038): who is listed, what a row shows, per-player settings, and wording. Tested in model.test.ts. */
import {
  effectiveRank,
  freshness,
  mainLanes,
  rankLabel,
  rankPoints,
  TIER_BASE,
  type BalancePlayer,
  type EffectiveRank,
  type TeamPlayerPref,
} from "@lol-viewer/core";
import { LANES, type CustomLobby, type Lane, type PlayerRank, type RankEntry, type TeamPlayer } from "@lol-viewer/protocol";
import { LANE_LABEL } from "../../ui/labels.ts";

export type Membership = "in" | "out";
export type Origin = "team" | "spectator" | "added";
export type Candidate = { puuid: string; origin: Origin };

/** Everyone the page lists: the lobby's team slots, its spectators, then the people added from Saved (not in the lobby). */
export function candidatesOf(lobby: CustomLobby | null, extras: readonly string[]): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const add = (puuid: string, origin: Origin) => {
    if (seen.has(puuid)) return;
    seen.add(puuid);
    out.push({ puuid, origin });
  };
  for (const p of lobby?.team100 ?? []) add(p, "team");
  for (const p of lobby?.team200 ?? []) add(p, "team");
  for (const p of lobby?.spectators ?? []) add(p, "spectator");
  for (const p of extras) add(p, "added");
  return out;
}

/** Team slots and added people play, spectators sit out, until the user moves them. */
export const membershipOf = (c: Candidate, moved: Readonly<Record<string, Membership>>): Membership =>
  moved[c.puuid] ?? (c.origin === "spectator" ? "out" : "in");

export type LaneView = { mains: Lane[]; subs: Lane[]; thin: boolean; manual: boolean };

/** Manual preferred lanes win over the lanes counted from the match history. */
export function lanesOf(p: TeamPlayer | undefined, pref: TeamPlayerPref | undefined): LaneView {
  if (pref?.mains?.length) return { mains: [...pref.mains], subs: [], thin: false, manual: true };
  const auto = mainLanes(p?.lanes);
  return { mains: auto.main ? [auto.main] : [], subs: auto.sub ? [auto.sub] : [], thin: auto.thin, manual: false };
}

export function balancePlayerOf(puuid: string, p: TeamPlayer | undefined, pref: TeamPlayerPref | undefined, now: number): BalancePlayer {
  const lanes = lanesOf(p, pref);
  return {
    puuid,
    points: effectiveRank(p, pref, now)?.points ?? null,
    lock: pref?.lock ?? null,
    mains: lanes.mains,
    subs: lanes.subs,
    ng: pref?.ng ? [...pref.ng] : [],
    thin: lanes.thin,
  };
}

/** The lane three or more people are locked to (balanceTeams refuses these), if any. */
export function overLockedLane(players: readonly BalancePlayer[]): Lane | null {
  for (const lane of LANES) if (players.filter((p) => p.lock === lane).length >= 3) return lane;
  return null;
}

/** Add `patch` to one person's settings; a person left with nothing is removed. */
export function withPref(prefs: Readonly<Record<string, TeamPlayerPref>>, puuid: string, patch: Partial<Record<keyof TeamPlayerPref, TeamPlayerPref[keyof TeamPlayerPref] | undefined>>): Record<string, TeamPlayerPref> {
  const next: Record<string, TeamPlayerPref> = { ...prefs };
  const merged: Record<string, unknown> = { ...(prefs[puuid] ?? {}), ...patch };
  for (const k of Object.keys(merged)) {
    const v = merged[k];
    if (v === undefined || (Array.isArray(v) && v.length === 0)) delete merged[k];
  }
  if (Object.keys(merged).length === 0) delete next[puuid];
  else next[puuid] = merged as TeamPlayerPref;
  return next;
}

/** Toggle a lane in a list; with `max`, a new lane pushes the oldest one out. */
export function toggleLane(list: readonly Lane[] | undefined, lane: Lane, max = 5): Lane[] {
  const cur = list ?? [];
  if (cur.includes(lane)) return cur.filter((l) => l !== lane);
  return [...cur, lane].slice(-max);
}

export const OVERRIDE_TIERS = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"] as const;
export const DIVISIONS = ["IV", "III", "II", "I"] as const;
export const isApex = (tier: string) => tier === "MASTER" || tier === "GRANDMASTER" || tier === "CHALLENGER";
const titleCase = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1).toLowerCase() : s);
export const tierName = titleCase;

/** The tier / division / LP a rank override of `points` stands for (Master and above is shown as Master). */
export function tierOfPoints(points: number): { tier: (typeof OVERRIDE_TIERS)[number]; division: (typeof DIVISIONS)[number]; lp: number } {
  const p = Math.max(0, Math.round(points));
  if (p >= 2800) return { tier: "MASTER", division: "IV", lp: p - 2800 };
  const base = Math.min(2400, Math.floor(p / 400) * 400);
  const tier = (Object.keys(TIER_BASE) as (keyof typeof TIER_BASE)[]).find((k) => TIER_BASE[k] === base)! as (typeof OVERRIDE_TIERS)[number];
  const d = Math.min(3, Math.floor((p - base) / 100));
  return { tier, division: DIVISIONS[d]!, lp: 0 };
}

/** Points of a chosen tier / division (LP counts only for Master and above); null when nothing valid. */
export const overridePoints = (tier: string, division: string, lp: number): number | null => rankPoints(tier, division, isApex(tier) ? lp : 0);

export const entryText = (e: RankEntry | null): string =>
  e ? (isApex(e.tier) ? `${tierName(e.tier)} ${e.lp} LP` : `${tierName(e.tier)} ${e.division} ${e.lp} LP`) : "Unranked";

const DAY = 86_400_000;
/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function ageLabel(at: number, now: number): string {
  const ms = Math.max(0, now - at);
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < DAY) return `${Math.floor(ms / 3_600_000)} h ago`;
  const d = Math.floor(ms / DAY);
  return d === 1 ? "1 day ago" : `${d} days ago`;
}

/** "new" (under 3 days), "old" (a mark, still used), "unused" (shown, not used), "expired". */
export const freshClass = (at: number | undefined, now: number): "none" | "fresh" | "stale" | "unused" | "expired" =>
  at === undefined ? "none" : freshness(at, now);

/** What a hover on the rank shows: where each value came from. */
export function rankDetails(p: TeamPlayer | undefined, eff: EffectiveRank | null, now: number): string[] {
  if (!p) return ["Not fetched yet"];
  const lines: string[] = [];
  const r: PlayerRank | null = p.rank;
  if (eff?.source === "manual") lines.push("Set by hand");
  if (r) {
    lines.push(`Solo/Duo: ${entryText(r.solo)}`, `Flex: ${entryText(r.flex)}`);
    if (r.prevSeason) lines.push(`Last season: ${entryText(r.prevSeason)}`);
    lines.push(`Fetched ${ageLabel(r.fetchedAt, now)}`);
  }
  const e = p.estimate;
  if (e) lines.push(e.points === null ? `Estimate: too little data (${e.samples} players in ${e.games} games)` : `Estimate: ${rankLabel(e.points, "solo")} from ${e.samples} players in ${e.games} games`);
  if (p.error) lines.push(`Problem: ${p.error}`);
  return lines.length ? lines : ["No rank data"];
}

/** "~3 min" for the work left, from how long the finished part took; null until one person is done. */
export function remainingText(done: number, total: number, elapsedMs: number): string | null {
  if (done <= 0 || total <= done || elapsedMs <= 0) return null;
  const minutes = ((elapsedMs / done) * (total - done)) / 60_000;
  return minutes < 1 ? "<1 min" : `~${Math.round(minutes)} min`;
}

/** The lock of `lane` that cannot be kept, as a sentence. */
export const tooManyLocksText = (lane: Lane): string => `Too many players are locked to ${LANE_LABEL[lane]}.`;
