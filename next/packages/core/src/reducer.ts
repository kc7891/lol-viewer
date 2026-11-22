import {
  PROTOCOL_VERSION,
  type Ally,
  type ChampSelectSession,
  type GameflowSession,
  type Lane,
  type LcuEvent,
  type MatchState,
} from "@lol-viewer/protocol";
import { getChampion } from "./champions.ts";

/** Queues whose "my pick" page is ARAM: ARAM, ARAM Clash, and the Mayhem variants. */
export const ARAM_QUEUE_IDS: ReadonlySet<number> = new Set([450, 65, 100, 720, 2400, 2401, 2403, 2405, 3240, 3270]);

type TeamMember = NonNullable<NonNullable<GameflowSession["gameData"]>["teamOne"]>[number];

/** reduce()'s internal state. Only `match` leaves the hub. */
export type DetectorState = {
  match: MatchState;
  /** Mine, from my champ-select row or /lol-summoner/v1/current-summoner. */
  summonerId: number | string | null;
  puuid: string | null;
  /** Last non-zero champ-select gameId (dodge detection). */
  lastChampSelectGameId: number | null;
  /** Latest gameflow teams, kept so the in-game lists can be rebuilt when the phase or my identity arrives later. */
  gameflowTeams: { one: TeamMember[]; two: TeamMember[] } | null;
};

export function initialMatchState(): MatchState {
  return {
    protocolVersion: PROTOCOL_VERSION,
    connection: "connecting",
    phase: "None",
    matchSeq: 0,
    gameId: null,
    queueId: null,
    gameMode: null,
    isAram: false,
    self: null,
    allies: [],
    enemies: [],
  };
}

export function initialDetectorState(): DetectorState {
  return { match: initialMatchState(), summonerId: null, puuid: null, lastChampSelectGameId: null, gameflowTeams: null };
}

/** LCU says "utility" for support and "" when positions are not assigned. */
export function normalizeLane(raw: string | undefined | null): Lane | null {
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

const positive = (n: number | undefined | null): number | null => (n != null && n > 0 ? n : null);
const known = (id: number | null): id is number => id != null && getChampion(id) !== undefined;
const present = (v: number | string | null | undefined): v is number | string => v != null && v !== 0 && v !== "";

/** queue may be a bare number, `{id}` or `{queueId}`; gameMode lives on `queue` or on gameData. */
function readQueue(gd: NonNullable<GameflowSession["gameData"]>): { queueId: number | null; gameMode: string | null } {
  const q = gd.queue;
  let queueId: number | null = null;
  let gameMode: string | null = null;
  if (typeof q === "number") queueId = positive(q);
  else if (q && typeof q === "object") {
    const o = q as Record<string, unknown>;
    queueId = positive(typeof o.id === "number" ? o.id : typeof o.queueId === "number" ? o.queueId : undefined);
    gameMode = typeof o.gameMode === "string" && o.gameMode ? o.gameMode : typeof o.mode === "string" && o.mode ? o.mode : null;
  }
  return { queueId, gameMode: gameMode ?? (gd.gameMode ? gd.gameMode : null) };
}

function withQueue(match: MatchState, queueId: number | null, gameMode: string | null): MatchState {
  const isAram = (queueId != null && ARAM_QUEUE_IDS.has(queueId)) || gameMode?.toUpperCase() === "ARAM";
  if (queueId === match.queueId && gameMode === match.gameMode && isAram === match.isAram) return match;
  return { ...match, queueId, gameMode, isAram };
}

/** Start a fresh match. The queue is kept: the gameflow session usually arrives first. */
function startNewMatch(d: DetectorState): DetectorState {
  return {
    ...d,
    lastChampSelectGameId: null,
    gameflowTeams: null,
    match: {
      ...d.match,
      phase: "ChampSelect",
      matchSeq: d.match.matchSeq + 1,
      gameId: null,
      self: null,
      allies: [],
      enemies: [],
    },
  };
}

/** In game: build allies / enemies from gameflow teamOne / teamTwo (lane is unknown). */
function applyTeams(d: DetectorState): DetectorState {
  if (d.match.phase !== "InProgress" || !d.gameflowTeams) return d;
  const { one, two } = d.gameflowTeams;
  const mine = (m: TeamMember) =>
    (present(d.summonerId) && present(m.summonerId) && m.summonerId === d.summonerId) ||
    (d.puuid != null && m.puuid != null && m.puuid === d.puuid);
  // Unknown identity: assume teamOne is mine (the old app did the same).
  const allyTeam = two.some(mine) && !one.some(mine) ? two : one;
  const enemyTeam = allyTeam === one ? two : one;
  const ids = (t: TeamMember[]) => t.map((m) => positive(m.championId)).filter(known);
  const allies: Ally[] = ids(allyTeam).map((championId) => ({ championId, lane: null }));
  const enemies = ids(enemyTeam);
  // Nothing usable: keep what champ select gave us.
  if (allies.length + enemies.length === 0) return d;
  return { ...d, match: { ...d.match, allies, enemies } };
}

function applyPhase(d: DetectorState, phase: string): DetectorState {
  if (phase === "ChampSelect" && d.match.phase !== "ChampSelect") return startNewMatch(d);
  if (phase === d.match.phase) return d;
  if (phase === "InProgress") return applyTeams({ ...d, match: { ...d.match, phase } });
  if (phase === "None" || phase === "Lobby") {
    // Forget me and the lobby; keep allies/enemies (the old app also kept the last lists).
    return {
      ...d,
      summonerId: null,
      puuid: null,
      lastChampSelectGameId: null,
      gameflowTeams: null,
      match: { ...d.match, phase, self: null, gameId: null },
    };
  }
  return { ...d, match: { ...d.match, phase } };
}

function applyChampSelect(d: DetectorState, s: ChampSelectSession): DetectorState {
  let next = d;
  // The session can arrive before the phase event; treat it as entering champ select.
  if (next.match.phase !== "ChampSelect") next = startNewMatch(next);
  const gameId = positive(s.gameId);
  // Same phase, different lobby (dodge -> requeue without leaving ChampSelect).
  if (gameId != null && next.lastChampSelectGameId != null && gameId !== next.lastChampSelectGameId) {
    next = startNewMatch(next);
  }

  const me = s.myTeam.find((p) => p.cellId === s.localPlayerCellId);
  const allies: Ally[] = [];
  for (const p of s.myTeam) {
    const id = positive(p.championId);
    if (known(id)) allies.push({ championId: id, lane: normalizeLane(p.assignedPosition) });
  }
  const enemies: number[] = [];
  for (const p of s.theirTeam) {
    const id = positive(p.championId);
    if (known(id)) enemies.push(id);
  }

  let self = next.match.self;
  const myId = positive(me?.championId);
  // Hover included; when the id drops back to 0 (re-picking) the last pick stays.
  if (myId != null) self = { championId: myId, lane: normalizeLane(me?.assignedPosition) };

  const mySummonerId = me?.summonerId;
  return {
    ...next,
    summonerId: present(mySummonerId) ? mySummonerId : next.summonerId,
    puuid: me?.puuid ? me.puuid : next.puuid,
    lastChampSelectGameId: gameId ?? next.lastChampSelectGameId,
    match: { ...next.match, gameId: gameId ?? next.match.gameId, self, allies, enemies },
  };
}

function applyGameflowSession(d: DetectorState, session: GameflowSession): DetectorState {
  let next = session.phase ? applyPhase(d, session.phase) : d;
  const gd = session.gameData;
  if (!gd) return next;

  const { queueId, gameMode } = readQueue(gd);
  const match = withQueue(next.match, queueId ?? next.match.queueId, gameMode ?? next.match.gameMode);
  if (match !== next.match) next = { ...next, match };
  if (gd.teamOne || gd.teamTwo) {
    next = applyTeams({ ...next, gameflowTeams: { one: gd.teamOne ?? [], two: gd.teamTwo ?? [] } });
    const gameId = positive(gd.gameId);
    if (next.match.phase === "InProgress" && gameId != null && gameId !== next.match.gameId) {
      next = { ...next, match: { ...next.match, gameId } };
    }
  }
  return next;
}

function step(d: DetectorState, event: LcuEvent): DetectorState {
  switch (event.type) {
    case "connection": {
      if (event.status === d.match.connection) return d;
      if (event.status !== "disconnected") return { ...d, match: { ...d.match, connection: event.status } };
      // A dropped client forgets the phase; reconnecting into ChampSelect is a new match.
      return {
        ...d,
        summonerId: null,
        puuid: null,
        lastChampSelectGameId: null,
        gameflowTeams: null,
        match: { ...d.match, connection: event.status, phase: "None" },
      };
    }
    case "gameflow-phase":
      return applyPhase(d, event.phase);
    case "gameflow-session":
      return event.session ? applyGameflowSession(d, event.session) : d;
    case "champ-select-session":
      // Session deletion (champ select ended) keeps the picks for in-game use.
      return event.session ? applyChampSelect(d, event.session) : d;
    case "current-summoner": {
      const s = event.summoner;
      const summonerId = present(s?.summonerId) ? s.summonerId : d.summonerId;
      const puuid = s?.puuid ? s.puuid : d.puuid;
      return summonerId === d.summonerId && puuid === d.puuid ? d : applyTeams({ ...d, summonerId, puuid });
    }
  }
}

/**
 * Pure reducer: (DetectorState, LcuEvent) -> DetectorState.
 * Never throws, never performs I/O; identical input always yields identical output.
 * No-op events return the same object, and an event that changes nothing observable
 * keeps the same MatchState object (cheap change detection in the hub).
 */
export function reduce(d: DetectorState, event: LcuEvent): DetectorState {
  const next = step(d, event);
  if (next === d) return d;
  const match = JSON.stringify(next.match) === JSON.stringify(d.match) ? d.match : next.match;
  return match === next.match ? next : { ...next, match };
}

export function reduceAll(events: Iterable<LcuEvent>, state: DetectorState = initialDetectorState()): DetectorState {
  let s = state;
  for (const e of events) s = reduce(s, e);
  return s;
}
