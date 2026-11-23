/**
 * Workspace: the user's working state (viewers, matchup table, pending enemy picks),
 * derived from a sequence of MatchState snapshots plus user actions (M-011).
 * Pure: no I/O, no clock, no randomness. See docs/spec/new-app-design.md §3.
 */
import { LANES, type Lane, type LivePlayer, type MatchState, type SelfPick } from "@lol-viewer/protocol";
import { getChampion } from "./champions.ts";

export const MAX_VIEWERS = 20;
export const MAX_QUICK_PICKS = 5;

export type ViewerMode = "build" | "counter" | "aram";
export type Side = "ally" | "enemy";

export type Viewer = {
  /** Monotonic from 1. The external view id is `viewer-<id>`. */
  id: number;
  championId: number | null;
  opponentId: number | null;
  lane: Lane | null;
  mode: ViewerMode;
  /** Created automatically from my own pick. */
  picked: boolean;
  hidden: boolean;
  /** +1 every time the page is (re)opened; the same URL is reloaded on change. */
  nav: number;
};

export type MatchupRow = { ally: number | null; enemy: number | null };

export type Workspace = {
  /** Left to right. */
  viewers: Viewer[];
  nextId: number;
  /** Always 5 rows, in LANES order. */
  rows: MatchupRow[];
  /** Enemy picks waiting to be opened as Counter viewers. */
  pending: number[];
  /** Last MatchState received. */
  last: MatchState | null;
  /** Enemies already pushed to `pending` in this match (no re-adding). */
  seenEnemies: number[];
  lastSelf: SelfPick | null;
  /**
   * Per side, the lane assignment from live data that was last applied to `rows` (assignmentKey),
   * or null. A side is corrected again only when its assignment changes (M-027).
   */
  liveApplied: { ally: string | null; enemy: string | null };
};

export type WorkspaceAction =
  | { type: "match"; state: MatchState }
  | { type: "addViewer" }
  | { type: "closeViewer"; id: number }
  | { type: "closeAll" }
  | { type: "toggleHidden"; id: number }
  | { type: "setChampion"; id: number; championId: number }
  | { type: "setOpponent"; id: number; opponentId: number | null }
  | { type: "setLane"; id: number; lane: Lane | null }
  | { type: "setMode"; id: number; mode: ViewerMode }
  | { type: "reopen"; id: number }
  | { type: "openPending"; championId: number }
  | { type: "removePending"; championId: number }
  | { type: "swapRows"; side: Side; from: number; to: number }
  | { type: "openRow"; index: number }
  | { type: "refreshMatchup" }
  | { type: "debugAdd"; side: Side; championId: number };

const emptyRows = (): MatchupRow[] => LANES.map(() => ({ ally: null, enemy: null }));

export function initialWorkspace(): Workspace {
  return { viewers: [], nextId: 1, rows: emptyRows(), pending: [], last: null, seenEnemies: [], lastSelf: null, liveApplied: { ally: null, enemy: null } };
}

export const canAddViewer = (ws: Workspace): boolean => ws.viewers.length < MAX_VIEWERS;

/** First row (from the top) with no champion on that side, or null when the side is full. */
export function firstEmptyRow(ws: Workspace, side: Side): number | null {
  const i = ws.rows.findIndex((r) => r[side] == null);
  return i < 0 ? null : i;
}

// ── placement ──────────────────────────────────────────────────────

const laneScore = (championId: number, row: number): number => getChampion(championId)?.lanes[LANES[row]!] ?? 0;

/** Index of the empty cell with the highest lane score for the champion; ties go to the upper row. */
function bestEmptyIndex(cells: readonly (number | null)[], championId: number): number | null {
  let best: number | null = null;
  let bestScore = -1;
  cells.forEach((c, i) => {
    if (c != null) return;
    const score = laneScore(championId, i);
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}
const bestEmptyRow = (rows: MatchupRow[], side: Side, id: number) => bestEmptyIndex(rows.map((r) => r[side]), id);

function place(rows: MatchupRow[], side: Side, row: number, championId: number): MatchupRow[] {
  return rows.map((r, i) => (i === row ? { ...r, [side]: championId } : r));
}

/** Put the picks of `state` into free rows. Never removes or moves anything already placed. */
function placeMatchup(rows: MatchupRow[], state: MatchState): MatchupRow[] {
  let out = rows;
  const placed = (side: Side, id: number) => out.some((r) => r[side] === id);

  // Allies, pass 1: those with a lane go to that lane's row, else the first empty row.
  const laneless: number[] = [];
  for (const a of state.allies) {
    if (placed("ally", a.championId)) continue;
    if (a.lane == null) {
      laneless.push(a.championId);
      continue;
    }
    const want = LANES.indexOf(a.lane);
    const row = out[want]!.ally == null ? want : out.findIndex((r) => r.ally == null);
    if (row < 0) break; // no empty ally row left: stop placing allies (enemies are independent)
    out = place(out, "ally", row, a.championId);
  }
  // Allies, pass 2: lane-less allies go to the best-fitting empty row.
  for (const id of laneless) {
    if (placed("ally", id)) continue;
    const row = bestEmptyRow(out, "ally", id);
    if (row == null) break;
    out = place(out, "ally", row, id);
  }
  // Enemies: best-fitting empty row.
  for (const id of state.enemies) {
    if (placed("enemy", id)) continue;
    const row = bestEmptyRow(out, "enemy", id);
    if (row == null) break;
    out = place(out, "enemy", row, id);
  }
  return out;
}

// ── live correction (M-027) ───────────────────────────────────────

/** Champion -> lane for one side of the live list. Lanes claimed by two players, and champions listed twice, are dropped. */
export function liveLaneAssignments(live: readonly LivePlayer[], side: Side): Map<number, Lane> {
  const players = live.filter((p) => p.team === side);
  const idCount = new Map<number, number>();
  for (const p of players) idCount.set(p.championId, (idCount.get(p.championId) ?? 0) + 1);
  const claims = players.filter((p) => p.lane != null && idCount.get(p.championId) === 1);
  const out = new Map<number, Lane>();
  for (const lane of LANES) {
    const who = claims.filter((p) => p.lane === lane);
    if (who.length === 1) out.set(who[0]!.championId, lane);
  }
  return out; // insertion order = LANES order
}

/** Stable text form, e.g. "jungle:64,middle:103". "" = nothing assigned. */
export const assignmentKey = (a: Map<number, Lane>): string => [...a].map(([id, lane]) => `${lane}:${id}`).join(",");

/**
 * Move the assigned champions of one side to their lane's row. Everyone else keeps their row
 * when it is still free; the ones pushed out go to the best-fitting free row. Nothing is removed,
 * nothing is added (champions not in the table are ignored).
 */
export function correctSide(rows: MatchupRow[], side: Side, assign: Map<number, Lane>): MatchupRow[] {
  const cur = rows.map((r) => r[side]);
  const next: (number | null)[] = cur.map(() => null);
  let fixed = 0;
  for (const [id, lane] of assign) {
    if (!cur.includes(id)) continue;
    next[LANES.indexOf(lane)] = id;
    fixed++;
  }
  if (fixed === 0) return rows;
  const displaced: number[] = [];
  cur.forEach((id, i) => {
    if (id == null || next.includes(id)) return; // empty, or moved above
    if (next[i] == null) next[i] = id;
    else displaced.push(id);
  });
  for (const id of displaced) {
    const i = bestEmptyIndex(next, id)!; // always exists: same number of champions
    next[i] = id;
  }
  const same = rows.every((r, i) => r[side] === next[i]);
  return same ? rows : rows.map((r, i) => (r[side] === next[i] ? r : { ...r, [side]: next[i] }));
}

/** M-027: correct each side when its live assignment differs from the one applied last. */
function applyLiveLanes(ws: Workspace, state: MatchState): Workspace {
  if (state.phase !== "InProgress" || !state.live) return ws;
  let { rows, liveApplied } = ws;
  for (const side of ["ally", "enemy"] as const) {
    const a = liveLaneAssignments(state.live, side);
    const key = assignmentKey(a);
    if (key === "" || key === liveApplied[side]) continue;
    rows = correctSide(rows, side, a);
    liveApplied = { ...liveApplied, [side]: key };
  }
  return rows === ws.rows && liveApplied === ws.liveApplied ? ws : { ...ws, rows, liveApplied };
}

// ── helpers ────────────────────────────────────────────────────────

function newViewer(ws: Workspace, init: Partial<Viewer>): { viewer: Viewer; nextId: number } {
  const viewer: Viewer = {
    id: ws.nextId,
    championId: null,
    opponentId: null,
    lane: null,
    mode: "build",
    picked: false,
    hidden: false,
    nav: 0,
    ...init,
  };
  return { viewer, nextId: ws.nextId + 1 };
}

/** Change a viewer; reopen the page when it has a champion. */
function updateViewer(ws: Workspace, id: number, patch: Partial<Viewer>, reopen = true): Workspace {
  const cur = ws.viewers.find((v) => v.id === id);
  if (!cur) return ws;
  let next = { ...cur, ...patch };
  if (reopen && next.championId != null) next = { ...next, nav: cur.nav + 1 };
  if ((Object.keys(next) as (keyof Viewer)[]).every((k) => next[k] === cur[k])) return ws;
  return { ...ws, viewers: ws.viewers.map((v) => (v.id === id ? next : v)) };
}

function applyMatch(ws: Workspace, state: MatchState): Workspace {
  let next = ws;

  // 1. New match: close everything, including viewers opened by hand (M-001).
  if (ws.last && ws.last.matchSeq !== state.matchSeq) {
    next = { ...next, viewers: [], rows: emptyRows(), pending: [], seenEnemies: [], lastSelf: null, liveApplied: { ally: null, enemy: null } };
  }

  // 2. Matchup table.
  if (state.phase === "ChampSelect" || state.phase === "InProgress") {
    next = { ...next, rows: placeMatchup(next.rows, state) };
    next = applyLiveLanes(next, state);
  }

  // 3. My pick: a new picked viewer on the left whenever champion or lane changes (M-002).
  const me = state.self;
  if (!me) {
    if (next.lastSelf) next = { ...next, lastSelf: null };
  } else if (!next.lastSelf || next.lastSelf.championId !== me.championId || next.lastSelf.lane !== me.lane) {
    next = { ...next, lastSelf: me };
    if (canAddViewer(next)) {
      const { viewer, nextId } = newViewer(next, {
        championId: me.championId,
        lane: state.isAram ? null : me.lane,
        mode: state.isAram ? "aram" : "build",
        picked: true,
        nav: 1,
      });
      next = { ...next, viewers: [viewer, ...next.viewers], nextId };
    }
  }

  // 4. Enemy picks (champ select only): queue the new ones for a Counter viewer.
  if (state.phase === "ChampSelect") {
    const fresh = state.enemies.filter((id) => !next.seenEnemies.includes(id));
    if (fresh.length) {
      next = { ...next, pending: [...next.pending, ...fresh], seenEnemies: [...next.seenEnemies, ...fresh] };
    }
  }

  return { ...next, last: state };
}

// ── reducer ────────────────────────────────────────────────────────

export function workspaceReducer(ws: Workspace, action: WorkspaceAction): Workspace {
  switch (action.type) {
    case "match":
      return applyMatch(ws, action.state);

    case "addViewer": {
      if (!canAddViewer(ws)) return ws;
      const { viewer, nextId } = newViewer(ws, {});
      return { ...ws, viewers: [...ws.viewers, viewer], nextId };
    }
    case "closeViewer":
      return ws.viewers.some((v) => v.id === action.id)
        ? { ...ws, viewers: ws.viewers.filter((v) => v.id !== action.id) }
        : ws;
    case "closeAll":
      return { ...ws, viewers: [], pending: [] };
    case "toggleHidden":
      return updateViewer(ws, action.id, { hidden: !ws.viewers.find((v) => v.id === action.id)?.hidden }, false);

    case "setChampion":
      return updateViewer(ws, action.id, { championId: action.championId });
    case "setOpponent":
      return updateViewer(ws, action.id, { opponentId: action.opponentId });
    case "setLane":
      return updateViewer(ws, action.id, { lane: action.lane });
    case "setMode":
      return updateViewer(ws, action.id, { mode: action.mode });
    case "reopen":
      return updateViewer(ws, action.id, {});

    case "openPending": {
      if (!ws.pending.includes(action.championId) || !canAddViewer(ws)) return ws;
      const { viewer, nextId } = newViewer(ws, { championId: action.championId, mode: "counter", nav: 1 });
      const at = ws.viewers.some((v) => v.picked) ? 1 : 0;
      const viewers = [...ws.viewers.slice(0, at), viewer, ...ws.viewers.slice(at)];
      return { ...ws, viewers, nextId, pending: ws.pending.filter((id) => id !== action.championId) };
    }
    case "removePending":
      return ws.pending.includes(action.championId)
        ? { ...ws, pending: ws.pending.filter((id) => id !== action.championId) }
        : ws;

    case "swapRows": {
      const { side, from, to } = action;
      const inRange = (i: number) => Number.isInteger(i) && i >= 0 && i < ws.rows.length;
      if (from === to || !inRange(from) || !inRange(to)) return ws;
      const a = ws.rows[from]![side];
      const b = ws.rows[to]![side];
      return {
        ...ws,
        rows: ws.rows.map((r, i) => (i === from ? { ...r, [side]: b } : i === to ? { ...r, [side]: a } : r)),
      };
    }
    case "openRow": {
      const row = ws.rows[action.index];
      if (!row || row.ally == null || !canAddViewer(ws)) return ws;
      const { viewer, nextId } = newViewer(ws, {
        championId: row.ally,
        opponentId: row.enemy,
        lane: LANES[action.index]!,
        mode: "build",
        nav: 1,
      });
      return { ...ws, viewers: [...ws.viewers, viewer], nextId };
    }
    case "refreshMatchup": {
      const base = {
        ...ws,
        rows: ws.last ? placeMatchup(emptyRows(), ws.last) : emptyRows(),
        pending: [],
        liveApplied: { ally: null, enemy: null },
      };
      return ws.last ? applyLiveLanes(base, ws.last) : base;
    }
    case "debugAdd": {
      const row = firstEmptyRow(ws, action.side);
      return row == null ? ws : { ...ws, rows: place(ws.rows, action.side, row, action.championId) };
    }
  }
}

// ── derived values ─────────────────────────────────────────────────

const distinct = (ids: (number | null)[]): number[] => [...new Set(ids.filter((id): id is number => id != null))];

/** Enemies in the matchup table, row order, no duplicates. */
function tableEnemies(ws: Workspace): number[] {
  return distinct(ws.rows.map((r) => r.enemy));
}

/** Up to 5 table enemies (row order) offered as one-click opponents; the current opponent is left out. */
export function quickPicks(ws: Workspace, viewer: Pick<Viewer, "opponentId">): number[] {
  return tableEnemies(ws)
    .filter((id) => id !== viewer.opponentId)
    .slice(0, MAX_QUICK_PICKS);
}

/**
 * Opponent suggestions: the table's enemies (row order); with none, the champions and
 * opponents of the other viewers (never this viewer's own champion).
 */
export function opponentSuggestions(ws: Workspace, viewer: Pick<Viewer, "id" | "championId">): number[] {
  const enemies = tableEnemies(ws);
  if (enemies.length) return enemies;
  return distinct(ws.viewers.filter((v) => v.id !== viewer.id).flatMap((v) => [v.championId, v.opponentId])).filter(
    (id) => id !== viewer.championId,
  );
}

/** Default cooldown target: the enemy in the row where I am (YOU), else my lane's row, else the first enemy (M-028). */
export function defaultCooldownChampion(ws: Workspace): number | null {
  const self = ws.last?.self ?? ws.lastSelf;
  const mine = self ? ws.rows.find((r) => r.ally === self.championId)?.enemy : null;
  if (mine != null) return mine;
  const laneEnemy = self?.lane ? ws.rows[LANES.indexOf(self.lane)]?.enemy : null;
  return laneEnemy ?? ws.rows.find((r) => r.enemy != null)?.enemy ?? null;
}

export type RowLiveDiff = { gold: number; level: number; ally: LivePlayer; enemy: LivePlayer };

/** Ally minus enemy in one row, from the last MatchState's live list; null when either side is missing. */
export function rowLiveDiff(ws: Workspace, index: number): RowLiveDiff | null {
  const live = ws.last?.live;
  const row = ws.rows[index];
  if (!live || !row || row.ally == null || row.enemy == null) return null;
  const ally = live.find((p) => p.team === "ally" && p.championId === row.ally);
  const enemy = live.find((p) => p.team === "enemy" && p.championId === row.enemy);
  if (!ally || !enemy) return null;
  return { gold: ally.itemGold - enemy.itemGold, level: ally.level - enemy.level, ally, enemy };
}

export type TeamLiveDiff = { gold: number; allyGold: number; enemyGold: number; allyCount: number; enemyCount: number };

/**
 * Team totals of item gold, ally minus enemy, from the whole live list (every player the game
 * reports, whether or not the table could place them). null without live data or with an empty side.
 */
export function teamLiveDiff(ws: Workspace): TeamLiveDiff | null {
  const live = ws.last?.live;
  if (!live) return null;
  const allies = live.filter((p) => p.team === "ally");
  const enemies = live.filter((p) => p.team === "enemy");
  if (!allies.length || !enemies.length) return null;
  const sum = (ps: readonly LivePlayer[]) => ps.reduce((n, p) => n + p.itemGold, 0);
  const allyGold = sum(allies);
  const enemyGold = sum(enemies);
  return { gold: allyGold - enemyGold, allyGold, enemyGold, allyCount: allies.length, enemyCount: enemies.length };
}
