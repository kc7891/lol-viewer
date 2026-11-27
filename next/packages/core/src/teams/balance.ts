/**
 * Team proposals for 6, 8 or 10 players (Teams, M-038). Brute force: every split into two teams, and for
 * 10 players the best lane assignment of each team. Two views (rank first, lane first), every proposal
 * sorted best first. Pure and deterministic (ties are broken by PUUID order).
 */
import { LANES, type Lane } from "@lol-viewer/protocol";

export type BalancePlayer = {
  puuid: string;
  /** null = unknown rank (the average of the known ones is used). */
  points: number | null;
  lock: Lane | null;
  mains: Lane[];
  subs: Lane[];
  ng: Lane[];
  /** Few games behind the lane data: "other" lanes cost less. */
  thin?: boolean;
};
export type Slot = { puuid: string; lane: Lane | null };
export type Proposal = {
  blue: Slot[];
  red: Slot[];
  score: number;
  rankDiff: number;
  maxMatchupDiff: number | null;
  brokenNg: number;
  unknownRanks: number;
};
export type BalanceView = "rankFirst" | "laneFirst";
export type BalanceResult = { rankFirst: Proposal[]; laneFirst: Proposal[]; error: null | "count" | "locks" };

export const WEIGHTS: Record<BalanceView, { rank: number; lane: number; matchup: number }> = {
  rankFirst: { rank: 1.0, lane: 0.3, matchup: 0.3 },
  laneFirst: { rank: 0.3, lane: 1.0, matchup: 0.2 },
};
const PEN_SUB = 30;
const PEN_OTHER = 80;
const PEN_OTHER_THIN = 40;
const PEN_NG = 400;
const PEN_SAME_MAIN = 60;
const PEN_LOCK_BROKEN = 1000; // only when a hand-edited proposal breaks a lock

const SIZES = new Set([6, 8, 10]);

/** Penalty of putting `p` in `lane`; Infinity when it breaks the player's lock. */
function lanePenalty(p: BalancePlayer, lane: Lane): { cost: number; ng: boolean } {
  if (p.lock) return { cost: p.lock === lane ? 0 : Infinity, ng: false };
  if (p.ng.includes(lane)) return { cost: PEN_NG, ng: true };
  if (p.mains.includes(lane)) return { cost: 0, ng: false };
  if (p.subs.includes(lane)) return { cost: PEN_SUB, ng: false };
  return { cost: p.thin ? PEN_OTHER_THIN : PEN_OTHER, ng: false };
}

/** The lane of a player for the "same main" check (6 and 8 players). */
const primary = (p: BalancePlayer): Lane | null => p.lock ?? p.mains[0] ?? null;

function sameMainPenalty(team: BalancePlayer[]): number {
  let n = 0;
  for (let i = 0; i < team.length; i++)
    for (let j = i + 1; j < team.length; j++) {
      const a = primary(team[i]!);
      if (a !== null && a === primary(team[j]!)) n++;
    }
  return n * PEN_SAME_MAIN;
}

/** Players whose rank is unknown get the average of the known ones (0 when nobody is known). */
function pointsMap(players: BalancePlayer[]): { pts: Map<string, number>; unknown: number } {
  const known = players.filter((p) => p.points !== null);
  const avg = known.length ? known.reduce((s, p) => s + p.points!, 0) / known.length : 0;
  return { pts: new Map(players.map((p) => [p.puuid, p.points ?? avg])), unknown: players.length - known.length };
}

const combine = (v: BalanceView, rankDiff: number, lane: number, matchup: number) =>
  WEIGHTS[v].rank * rankDiff + WEIGHTS[v].lane * lane + WEIGHTS[v].matchup * matchup;

type Candidate = {
  blue: Slot[];
  red: Slot[];
  rankDiff: number;
  lane: number;
  matchupAvg: number;
  maxMatchup: number | null;
  brokenNg: number;
  unknown: number;
  key: string;
};

const toProposal = (c: Candidate, v: BalanceView): Proposal => ({
  blue: c.blue,
  red: c.red,
  score: combine(v, c.rankDiff, c.lane, c.matchupAvg),
  rankDiff: c.rankDiff,
  maxMatchupDiff: c.maxMatchup,
  brokenNg: c.brokenNg,
  unknownRanks: c.unknown,
});

const byScore = (a: { p: Proposal; key: string }, b: { p: Proposal; key: string }) =>
  Math.abs(a.p.score - b.p.score) > 1e-9 ? a.p.score - b.p.score : a.key < b.key ? -1 : a.key > b.key ? 1 : 0;

const MAX_TIES = 24;

/** Ways to give 5 people the 5 lanes with the lowest total penalty (ties kept, at most 24 so the pairing stays fast). */
function bestAssignments(team: BalancePlayer[]): { lanes: Lane[]; cost: number }[] {
  let best = Infinity;
  let found: { lanes: Lane[]; cost: number }[] = [];
  const used = new Array<boolean>(5).fill(false);
  const cur: Lane[] = [];
  const dfs = (i: number, cost: number) => {
    if (cost > best) return;
    if (i === team.length) {
      if (cost < best) {
        best = cost;
        found = [];
      }
      if (found.length < MAX_TIES) found.push({ lanes: [...cur], cost });
      return;
    }
    for (let l = 0; l < 5; l++) {
      if (used[l]) continue;
      const c = lanePenalty(team[i]!, LANES[l]!).cost;
      if (!Number.isFinite(c)) continue;
      used[l] = true;
      cur[i] = LANES[l]!;
      dfs(i + 1, cost + c);
      used[l] = false;
    }
  };
  dfs(0, 0);
  return found;
}

/** Choose k indexes of n with index 0 always in (so a split and its mirror are counted once). */
function* splits(n: number, k: number): Generator<number[]> {
  const pick: number[] = [0];
  function* rec(from: number): Generator<number[]> {
    if (pick.length === k) {
      yield [...pick];
      return;
    }
    for (let i = from; i < n; i++) {
      pick.push(i);
      yield* rec(i + 1);
      pick.pop();
    }
  }
  yield* rec(1);
}

/** Proposals for 6, 8 or 10 players, best first for each view. */
export function balanceTeams(input: BalancePlayer[]): BalanceResult {
  const fail = (error: "count" | "locks"): BalanceResult => ({ rankFirst: [], laneFirst: [], error });
  if (!SIZES.has(input.length) || new Set(input.map((p) => p.puuid)).size !== input.length) return fail("count");
  const players = [...input].sort((a, b) => (a.puuid < b.puuid ? -1 : a.puuid > b.puuid ? 1 : 0));
  const n = players.length;
  const lockCount = new Map<Lane, number>();
  for (const p of players) if (p.lock) lockCount.set(p.lock, (lockCount.get(p.lock) ?? 0) + 1);
  if ([...lockCount.values()].some((c) => c >= 3)) return fail("locks");

  const { pts, unknown } = pointsMap(players);
  const half = n / 2;
  const cands: Candidate[] = [];
  for (const idx of splits(n, half)) {
    const inBlue = new Set(idx);
    const blue = idx.map((i) => players[i]!);
    const red = players.filter((_, i) => !inBlue.has(i));
    const rankDiff = Math.abs(blue.reduce((s, p) => s + pts.get(p.puuid)!, 0) - red.reduce((s, p) => s + pts.get(p.puuid)!, 0)) / half;
    const key = blue.map((p) => p.puuid).join(",");
    if (n === 10) {
      const bs = bestAssignments(blue);
      const rs = bestAssignments(red);
      if (!bs.length || !rs.length) continue; // a lock cannot be kept in this split
      let pick: { b: Lane[]; r: Lane[]; sum: number; max: number } | null = null;
      for (const b of bs)
        for (const r of rs) {
          let sum = 0;
          let max = 0;
          for (const lane of LANES) {
            const d = Math.abs(pts.get(blue[b.lanes.indexOf(lane)]!.puuid)! - pts.get(red[r.lanes.indexOf(lane)]!.puuid)!);
            sum += d;
            max = Math.max(max, d);
          }
          if (!pick || sum < pick.sum) pick = { b: b.lanes, r: r.lanes, sum, max };
        }
      const slots = (team: BalancePlayer[], lanes: Lane[]): Slot[] =>
        LANES.map((lane) => ({ puuid: team[lanes.indexOf(lane)]!.puuid, lane }));
      const bSlots = slots(blue, pick!.b);
      const rSlots = slots(red, pick!.r);
      const byId = new Map(players.map((p) => [p.puuid, p]));
      const brokenNg = [...bSlots, ...rSlots].filter((s) => lanePenalty(byId.get(s.puuid)!, s.lane!).ng).length;
      cands.push({
        blue: bSlots,
        red: rSlots,
        rankDiff,
        lane: bs[0]!.cost + rs[0]!.cost,
        matchupAvg: pick!.sum / 5,
        maxMatchup: pick!.max,
        brokenNg,
        unknown,
        key,
      });
    } else {
      // Two people locked to the same lane must not share a team.
      const clash = (t: BalancePlayer[]) => t.some((a, i) => a.lock && t.some((b, j) => j > i && b.lock === a.lock));
      if (clash(blue) || clash(red)) continue;
      const order = (t: BalancePlayer[]) =>
        [...t].sort((a, b) => pts.get(b.puuid)! - pts.get(a.puuid)! || (a.puuid < b.puuid ? -1 : 1)).map((p) => ({ puuid: p.puuid, lane: null }));
      cands.push({
        blue: order(blue),
        red: order(red),
        rankDiff,
        lane: sameMainPenalty(blue) + sameMainPenalty(red),
        matchupAvg: 0,
        maxMatchup: null,
        brokenNg: 0,
        unknown,
        key,
      });
    }
  }
  if (!cands.length) return fail("locks");
  const sorted = (v: BalanceView) =>
    cands.map((c) => ({ p: toProposal(c, v), key: c.key })).sort(byScore).map((x) => x.p);
  return { rankFirst: sorted("rankFirst"), laneFirst: sorted("laneFirst"), error: null };
}

/**
 * Score a proposal again after the user swapped people (the slots keep their lanes). A lock broken by the
 * swap costs 1000 here, so the view shows it as a poor proposal instead of hiding it.
 */
export function scoreProposal(slots: { blue: Slot[]; red: Slot[] }, players: BalancePlayer[], view: BalanceView): Proposal {
  const byId = new Map(players.map((p) => [p.puuid, p]));
  const all = [...slots.blue, ...slots.red].map((s) => byId.get(s.puuid)).filter((p): p is BalancePlayer => !!p);
  const { pts, unknown } = pointsMap(all);
  const half = Math.max(1, slots.blue.length);
  const sum = (t: Slot[]) => t.reduce((s, x) => s + (pts.get(x.puuid) ?? 0), 0);
  const rankDiff = Math.abs(sum(slots.blue) - sum(slots.red)) / half;
  const laned = [...slots.blue, ...slots.red].every((s) => s.lane !== null);
  let lane = 0;
  let brokenNg = 0;
  let matchupAvg = 0;
  let maxMatchup: number | null = null;
  if (laned) {
    for (const s of [...slots.blue, ...slots.red]) {
      const p = byId.get(s.puuid);
      if (!p) continue;
      const r = lanePenalty(p, s.lane!);
      lane += Number.isFinite(r.cost) ? r.cost : PEN_LOCK_BROKEN;
      if (r.ng) brokenNg++;
    }
    const diffs = LANES.flatMap((l) => {
      const b = slots.blue.find((s) => s.lane === l);
      const r = slots.red.find((s) => s.lane === l);
      return b && r ? [Math.abs((pts.get(b.puuid) ?? 0) - (pts.get(r.puuid) ?? 0))] : [];
    });
    if (diffs.length) {
      matchupAvg = diffs.reduce((a, b) => a + b, 0) / diffs.length;
      maxMatchup = Math.max(...diffs);
    }
  } else {
    const team = (t: Slot[]) => t.map((s) => byId.get(s.puuid)).filter((p): p is BalancePlayer => !!p);
    lane = sameMainPenalty(team(slots.blue)) + sameMainPenalty(team(slots.red));
  }
  return {
    blue: slots.blue,
    red: slots.red,
    score: combine(view, rankDiff, lane, matchupAvg),
    rankDiff,
    maxMatchupDiff: maxMatchup,
    brokenNg,
    unknownRanks: unknown,
  };
}
