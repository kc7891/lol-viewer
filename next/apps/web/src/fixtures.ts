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
import type { LcuEvent, MatchState } from "@lol-viewer/protocol";
import scenarioText from "../../../scenarios/ranked-two-matches.jsonl?raw";

/** What the app holds at one moment: the League Client's facts and the user's workspace. */
export type Scene = { match: MatchState; ws: Workspace };

const connect: LcuEvent = { type: "connection", status: "connected" };
const events: LcuEvent[] = [connect, ...scenarioEvents(parseScenario(scenarioText))];

/** Feed the first `count` events through the detector, and every changed MatchState through the workspace. */
function replay(count: number): Scene {
  let d: DetectorState = initialDetectorState();
  let ws = initialWorkspace();
  for (const e of events.slice(0, count)) {
    const next = reduce(d, e);
    if (next.match !== d.match) ws = workspaceReducer(ws, { type: "match", state: next.match });
    d = next;
  }
  return { match: d.match, ws };
}

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

/** The first viewer of a scene (for single-pane component stories). */
export const firstViewer = (s: Scene) => s.ws.viewers[0]!;
