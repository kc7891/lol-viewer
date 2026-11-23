/**
 * Fixtures derived from the real scenario through the real reducers
 * (core.reduce for MatchState, core.workspaceReducer for the Workspace),
 * so stories always show states the app can actually reach.
 */
import {
  CHAMPIONS,
  initialDetectorState,
  initialMatchState,
  initialWorkspace,
  MAX_VIEWERS,
  parseScenario,
  reduce,
  scenarioEvents,
  workspaceReducer,
  type DetectorState,
  type Workspace,
  type WorkspaceAction,
} from "@lol-viewer/core";
import type { LcuEvent, MatchState, UpdateStatus } from "@lol-viewer/protocol";
import scenarioText from "../../../scenarios/ranked-two-matches.jsonl?raw";
import liveText from "../../../scenarios/live-ingame.jsonl?raw";

/** What the app holds at one moment: the League Client's facts and the user's workspace. */
export type Scene = { match: MatchState; ws: Workspace };

const connect: LcuEvent = { type: "connection", status: "connected" };
const events: LcuEvent[] = [connect, ...scenarioEvents(parseScenario(scenarioText))];

/** Feed the first `count` events through the detector, and every changed MatchState through the workspace. */
function replayEvents(list: readonly LcuEvent[], count: number): Scene {
  let d: DetectorState = initialDetectorState();
  let ws = initialWorkspace();
  for (const e of list.slice(0, count)) {
    const next = reduce(d, e);
    if (next.match !== d.match) ws = workspaceReducer(ws, { type: "match", state: next.match });
    d = next;
  }
  return { match: d.match, ws };
}

const replay = (count: number): Scene => replayEvents(events, count);

const indexOf = (pred: (e: LcuEvent) => boolean): number => events.findIndex(pred) + 1;

/** Apply user actions to a scene. */
export function act(scene: Scene, ...actions: WorkspaceAction[]): Scene {
  return { ...scene, ws: actions.reduce(workspaceReducer, scene.ws) };
}

const idle = replay(1);
const complete = replay(indexOf((e) => e.type === "champ-select-session" && (e.session?.theirTeam[4]?.championId ?? 0) > 0));

export const scenes = {
  disconnected: { match: { ...initialMatchState(), connection: "disconnected" } as MatchState, ws: initialWorkspace() } satisfies Scene,
  connecting: { match: { ...initialMatchState(), connection: "connecting" } as MatchState, ws: initialWorkspace() } satisfies Scene,
  idle,
  champSelectStart: replay(indexOf((e) => e.type === "champ-select-session")),
  champSelectPartial: replay(indexOf((e) => e.type === "champ-select-session" && (e.session?.myTeam[2]?.championId ?? 0) > 0)),
  /** All 10 picked: picked viewers for my pick (hover changes included) and every enemy waiting as an enemy pick. */
  champSelectComplete: complete,
  inGame: replay(indexOf((e) => e.type === "gameflow-phase" && e.phase === "InProgress")),
  /** The second match: everything from the first was closed (M-001). */
  secondMatch: replay(events.length),
} satisfies Record<string, Scene>;

export type SceneName = keyof typeof scenes;

const id = (name: string): number => {
  const c = CHAMPIONS.find((x) => x.name === name);
  if (!c) throw new Error(`fixture champion missing: ${name}`);
  return c.id;
};
export const champ = id;

const lastId = (s: Scene) => s.ws.nextId - 1;

/** Three viewers: my pick, a Counter from the enemy list, and the Top matchup. */
export const threeViewers: Scene = act(scenes.champSelectComplete, { type: "openPending", championId: id("Zed") }, { type: "openRow", index: 0 });

/** Same, with the Counter viewer hidden. */
export const withHidden: Scene = act(threeViewers, { type: "toggleHidden", id: lastId(threeViewers) - 1 });

/** Viewers opened by hand before any champion select: one with a champion, one still empty. */
export const manualViewers: Scene = act(
  scenes.idle,
  { type: "addViewer" },
  { type: "setChampion", id: 1, championId: id("Ahri") },
  { type: "setOpponent", id: 1, opponentId: id("Zed") },
  { type: "setLane", id: 1, lane: "middle" },
  { type: "addViewer" },
);

/** An empty viewer, just added. */
export const emptyViewer: Scene = act(scenes.idle, { type: "addViewer" });

/** Viewer limit: MAX_VIEWERS viewers, every one with a champion. */
export const viewerLimit: Scene = act(
  scenes.idle,
  ...Array.from({ length: MAX_VIEWERS }, (_, i): WorkspaceAction[] => [
    { type: "addViewer" },
    { type: "setChampion", id: i + 1, championId: CHAMPIONS[i * 7]!.id },
  ]).flat(),
);

// ── In game with Live Client data (feature flag liveClientData, M-025..M-029) ──

const liveEvents: LcuEvent[] = [connect, ...scenarioEvents(parseScenario(liveText))];
const livePlayerIdx = liveEvents.flatMap((e, i) => (e.type === "live-players" && e.players ? [i + 1] : []));
const liveCount = (n: number) => livePlayerIdx[n]!;

const liveMid = replayEvents(liveEvents, liveCount(1));

export const liveScenes = {
  /** In game, nothing from the Live Client yet: the table is the champ-select guess. */
  inGameGuessed: replayEvents(liveEvents, liveEvents.findIndex((e) => e.type === "current-summoner") + 1),
  /** First playerlist (level 1, starting items). */
  liveEarly: replayEvents(liveEvents, liveCount(0)),
  /** Second playerlist (mid game): rows on their real lanes, gold and level differences. */
  liveMid,
  /** Same moment with the flag off: main never polls, so no live-players event ever arrives. */
  liveFlagOff: replayEvents(
    liveEvents.filter((e) => e.type !== "live-players"),
    liveCount(1) - livePlayerIdx.length,
  ),
  /** After the correction I swapped two enemy rows; the next playerlist leaves the swap alone (M-027). */
  liveSwappedAfter: ((): Scene => {
    const swapped = act(liveMid, { type: "swapRows", side: "enemy", from: 0, to: 4 });
    return { ...swapped, ws: workspaceReducer(swapped.ws, { type: "match", state: liveMid.match }) };
  })(),
} satisfies Record<string, Scene>;

/** The first viewer of a scene (for single-pane component stories). */
export const firstViewer = (s: Scene) => s.ws.viewers[0]!;

// ── Desktop update states (Settings > Version, Top bar dot) ──

const upd = (patch: Partial<UpdateStatus>): UpdateStatus => ({
  state: "idle",
  currentVersion: "0.1.0",
  latestVersion: null,
  percent: null,
  error: null,
  ...patch,
});

export const updateStatuses = {
  unsupported: upd({ state: "unsupported" }),
  idle: upd({}),
  checking: upd({ state: "checking" }),
  notAvailable: upd({ state: "not-available", latestVersion: "0.1.0" }),
  available: upd({ state: "available", latestVersion: "0.2.0" }),
  downloading: upd({ state: "downloading", latestVersion: "0.2.0", percent: 42 }),
  downloaded: upd({ state: "downloaded", latestVersion: "0.2.0", percent: 100 }),
  error: upd({ state: "error", error: "Could not reach the update server." }),
} satisfies Record<string, UpdateStatus>;
