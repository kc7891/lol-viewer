import {
  LANES,
  PROTOCOL_VERSION,
  type AllyPick,
  type ChampSelectSession,
  type EnemyPick,
  type Lane,
  type LcuEvent,
  type MatchState,
  type MatchupRow,
} from "@lol-viewer/protocol";

export function initialMatchState(): MatchState {
  return {
    protocolVersion: PROTOCOL_VERSION,
    connection: "connecting",
    phase: "None",
    matchSeq: 0,
    gameId: null,
    queueId: null,
    self: null,
    allies: [],
    enemies: [],
    matchups: emptyMatchups(),
  };
}

function emptyMatchups(): MatchupRow[] {
  return LANES.map((lane) => ({ lane, allyChampionId: null, enemyChampionId: null }));
}

/** LCU says "utility" for support and "" when positions are not assigned. */
export function normalizeLane(raw: string | undefined): Lane | null {
  switch ((raw ?? "").toLowerCase()) {
    case "top":
      return "top";
    case "jungle":
      return "jungle";
    case "middle":
    case "mid":
      return "middle";
    case "bottom":
    case "bot":
      return "bottom";
    case "utility":
    case "support":
      return "support";
    default:
      return null;
  }
}

const positive = (n: number | undefined): number | null => (n != null && n > 0 ? n : null);

/** Start a fresh match: everything champ-select related is cleared. */
function startNewMatch(state: MatchState): MatchState {
  return {
    ...state,
    phase: "ChampSelect",
    matchSeq: state.matchSeq + 1,
    gameId: null,
    queueId: state.queueId,
    self: null,
    allies: [],
    enemies: [],
    matchups: emptyMatchups(),
  };
}

function applyPhase(state: MatchState, phase: string): MatchState {
  if (phase === "ChampSelect" && state.phase !== "ChampSelect") return startNewMatch(state);
  if (phase === state.phase) return state;
  return { ...state, phase };
}

export function deriveMatchups(allies: AllyPick[], enemies: EnemyPick[]): MatchupRow[] {
  const rows = emptyMatchups();
  const unplaced: number[] = [];
  for (const a of allies) {
    if (a.championId == null) continue;
    const row = a.lane ? rows.find((r) => r.lane === a.lane && r.allyChampionId == null) : undefined;
    if (row) row.allyChampionId = a.championId;
    else unplaced.push(a.championId);
  }
  // Blind pick / missing positions: fill the remaining rows in pick order.
  for (const id of unplaced) {
    const row = rows.find((r) => r.allyChampionId == null);
    if (row) row.allyChampionId = id;
  }
  // Enemy positions are unknown in champ select; use pick order.
  const enemyIds = enemies.flatMap((e) => (e.championId == null ? [] : [e.championId]));
  rows.forEach((r, i) => {
    r.enemyChampionId = enemyIds[i] ?? null;
  });
  return rows;
}

function applyChampSelect(state: MatchState, session: ChampSelectSession): MatchState {
  let next = state;
  // The session can arrive before the phase event; treat it as entering champ select.
  if (next.phase !== "ChampSelect") next = startNewMatch(next);
  // Same phase, different lobby (dodge -> requeue without leaving ChampSelect).
  if (session.gameId != null && next.gameId != null && session.gameId !== next.gameId) {
    next = startNewMatch(next);
  }

  const allies: AllyPick[] = session.myTeam.map((p) => ({
    cellId: p.cellId,
    championId: positive(p.championId),
    intentChampionId: positive(p.championPickIntent),
    lane: normalizeLane(p.assignedPosition),
    isSelf: p.cellId === session.localPlayerCellId,
  }));
  const enemies: EnemyPick[] = session.theirTeam.map((p) => ({
    cellId: p.cellId,
    championId: positive(p.championId),
  }));
  const me = allies.find((a) => a.isSelf);

  return {
    ...next,
    gameId: session.gameId ?? next.gameId,
    self: me?.championId != null ? { championId: me.championId, lane: me.lane } : null,
    allies,
    enemies,
    matchups: deriveMatchups(allies, enemies),
  };
}

/**
 * Pure reducer: (MatchState, LcuEvent) -> MatchState.
 * Never throws, never performs I/O; identical input always yields identical output.
 */
export function reduce(state: MatchState, event: LcuEvent): MatchState {
  switch (event.type) {
    case "connection":
      return event.status === state.connection ? state : { ...state, connection: event.status };
    case "gameflow-phase":
      return applyPhase(state, event.phase);
    case "gameflow-session": {
      if (!event.session) return state;
      let next = event.session.phase ? applyPhase(state, event.session.phase) : state;
      const gd = event.session.gameData;
      if (gd) {
        next = {
          ...next,
          gameId: positive(gd.gameId) ?? next.gameId,
          queueId: positive(gd.queue?.id) ?? next.queueId,
        };
      }
      return next;
    }
    case "champ-select-session":
      // Session deletion (champ select ended) keeps the picks for in-game use.
      return event.session ? applyChampSelect(state, event.session) : state;
  }
}

export function reduceAll(events: Iterable<LcuEvent>, state = initialMatchState()): MatchState {
  let s = state;
  for (const e of events) s = reduce(s, e);
  return s;
}
