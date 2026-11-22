import { describe, expect, it } from "vitest";
import type { Lane, MatchState } from "@lol-viewer/protocol";
import { initialMatchState } from "./reducer.ts";
import { DEFAULT_SETTINGS } from "./settings.ts";
import { viewerUrl } from "./urls.ts";
import {
  MAX_VIEWERS,
  canAddViewer,
  defaultCooldownChampion,
  firstEmptyRow,
  initialWorkspace,
  opponentSuggestions,
  quickPicks,
  workspaceReducer,
  type Workspace,
  type WorkspaceAction,
} from "./workspace.ts";

// Champion ids (lane scores from champion_lane.csv in parentheses: top jg mid bot sup)
const GAREN = 86; // 5 0 0 0 0
const DARIUS = 122; // 5 0 0 0 0
const LEE = 64; // 0 5 0 0 0
const VI = 254; // 0 5 0 0 0
const ZED = 238; // 0 0 5 0 0
const YASUO = 157; // 0 0 5 0 0
const AHRI = 103; // 4 0 5 0 0
const JINX = 222; // 0 0 0 5 0
const ASHE = 22; // 0 0 0 5 0
const THRESH = 412; // 0 0 0 0 5
const LEONA = 89; // 0 0 0 0 5
const WUKONG = 62; // 5 0 0 0 0

type Pick = [number, Lane | null];
const ms = (p: Omit<Partial<MatchState>, "allies"> & { allies?: Pick[] } = {}): MatchState => {
  const { allies, ...rest } = p;
  return {
    ...initialMatchState(),
    phase: "ChampSelect",
    matchSeq: 1,
    ...rest,
    allies: (allies ?? []).map(([championId, lane]) => ({ championId, lane })),
  };
};
const run = (ws: Workspace, ...actions: WorkspaceAction[]) => actions.reduce(workspaceReducer, ws);
const match = (ws: Workspace, state: MatchState) => workspaceReducer(ws, { type: "match", state });
const col = (ws: Workspace, side: "ally" | "enemy") => ws.rows.map((r) => r[side]);

describe("matchup placement", () => {
  it("puts allies with a lane into their lane's row", () => {
    const ws = match(initialWorkspace(), ms({ allies: [[THRESH, "support"], [GAREN, "top"], [ZED, "middle"]] }));
    expect(col(ws, "ally")).toEqual([GAREN, null, ZED, null, THRESH]);
  });

  it("sends an ally whose lane row is taken to the first empty row", () => {
    const ws = match(initialWorkspace(), ms({ allies: [[GAREN, "top"], [DARIUS, "top"]] }));
    expect(col(ws, "ally")).toEqual([GAREN, DARIUS, null, null, null]);
  });

  it("places lane-less allies by lane suitability, ties to the upper row", () => {
    const ws = match(initialWorkspace(), ms({ allies: [[ZED, null], [LEE, null], [JINX, null], [THRESH, null], [GAREN, null]] }));
    expect(col(ws, "ally")).toEqual([GAREN, LEE, ZED, JINX, THRESH]);
    // two mid champions: the second takes the best remaining row (a tie of zeros goes to the top-most empty row)
    const two = match(initialWorkspace(), ms({ allies: [[ZED, null], [YASUO, null]] }));
    expect(col(two, "ally")).toEqual([YASUO, null, ZED, null, null]);
  });

  it("places lane-assigned allies first, then lane-less ones in the rows left over", () => {
    const ws = match(initialWorkspace(), ms({ allies: [[ZED, null], [GAREN, "middle"]] }));
    // Garen (lane middle) takes row 2 in pass 1; Zed (mid 5, taken) falls to the first empty row
    expect(col(ws, "ally")).toEqual([ZED, null, GAREN, null, null]);
  });

  it("places enemies by lane suitability regardless of pick order", () => {
    const ws = match(initialWorkspace(), ms({ enemies: [THRESH, JINX, ZED, LEE, GAREN] }));
    expect(col(ws, "enemy")).toEqual([GAREN, LEE, ZED, JINX, THRESH]);
  });

  it("breaks ties toward Top and uses the next best row when the best is taken", () => {
    const ws = match(initialWorkspace(), ms({ enemies: [ZED, YASUO, AHRI] }));
    // Zed -> mid. Yasuo (mid taken, every other lane 0) -> tie -> top. Ahri (top taken, mid taken) -> all 0 -> jungle.
    expect(col(ws, "enemy").slice(0, 3)).toEqual([YASUO, AHRI, ZED]);
  });

  it("allies and enemies are independent: the other side never moves", () => {
    let ws = match(initialWorkspace(), ms({ allies: [[GAREN, "top"]] }));
    ws = match(ws, ms({ allies: [[GAREN, "top"]], enemies: [ZED] }));
    expect(ws.rows[0]).toEqual({ ally: GAREN, enemy: null });
    expect(ws.rows[2]).toEqual({ ally: null, enemy: ZED });
  });

  it("stops when the side is full and never removes what was placed", () => {
    let ws = match(initialWorkspace(), ms({ enemies: [GAREN, LEE, ZED, JINX, THRESH] }));
    ws = match(ws, ms({ enemies: [GAREN, LEE, ZED, JINX, THRESH, DARIUS, ASHE] }));
    expect(col(ws, "enemy")).toEqual([GAREN, LEE, ZED, JINX, THRESH]);
    ws = match(ws, ms({ enemies: [] }));
    expect(col(ws, "enemy")).toEqual([GAREN, LEE, ZED, JINX, THRESH]);
  });

  it("a full ally side does not stop enemy placement", () => {
    // Allies were swapped by hand / debug-added so that a 6th lane ally finds no empty row.
    let ws = match(initialWorkspace(), ms({ allies: [[GAREN, "top"], [LEE, "jungle"], [ZED, "middle"], [JINX, "bottom"], [THRESH, "support"]] }));
    ws = match(ws, ms({ allies: [[GAREN, "top"], [LEE, "jungle"], [ZED, "middle"], [JINX, "bottom"], [THRESH, "support"], [DARIUS, "top"]], enemies: [AHRI] }));
    expect(col(ws, "ally")).toEqual([GAREN, LEE, ZED, JINX, THRESH]);
    expect(col(ws, "enemy")).toEqual([null, null, AHRI, null, null]);
  });

  it("skips a champion already in the side", () => {
    let ws = match(initialWorkspace(), ms({ allies: [[GAREN, "top"]] }));
    ws = workspaceReducer(ws, { type: "swapRows", side: "ally", from: 0, to: 3 });
    ws = match(ws, ms({ allies: [[GAREN, "top"]] }));
    expect(col(ws, "ally")).toEqual([null, null, null, GAREN, null]);
  });

  it("only places in ChampSelect and InProgress", () => {
    const ws = match(initialWorkspace(), ms({ phase: "Lobby", allies: [[GAREN, "top"]], enemies: [ZED] }));
    expect(ws.rows.every((r) => r.ally == null && r.enemy == null)).toBe(true);
    const game = match(initialWorkspace(), ms({ phase: "InProgress", allies: [[GAREN, null]], enemies: [ZED] }));
    expect(game.rows[0]!.ally).toBe(GAREN);
    expect(game.rows[2]!.enemy).toBe(ZED);
  });
});

describe("new match", () => {
  it("closes every viewer (manual ones too) and clears rows, pending and seen enemies", () => {
    let ws = match(initialWorkspace(), ms({ self: { championId: AHRI, lane: "middle" }, allies: [[AHRI, "middle"]], enemies: [ZED] }));
    ws = run(ws, { type: "addViewer" });
    expect(ws.viewers).toHaveLength(2);
    expect(ws.pending).toEqual([ZED]);
    ws = match(ws, ms({ matchSeq: 2 }));
    expect(ws.viewers).toEqual([]);
    expect(ws.pending).toEqual([]);
    expect(ws.seenEnemies).toEqual([]);
    expect(ws.rows.every((r) => r.ally == null && r.enemy == null)).toBe(true);
    expect(ws.lastSelf).toBeNull();
  });

  it("applies the new match's data after clearing (order: new match, table, self, enemies)", () => {
    let ws = match(initialWorkspace(), ms({ self: { championId: AHRI, lane: "middle" }, enemies: [ZED] }));
    ws = match(ws, ms({ matchSeq: 2, self: { championId: AHRI, lane: "middle" }, allies: [[AHRI, "middle"]], enemies: [ZED] }));
    expect(ws.viewers).toHaveLength(1);
    expect(ws.viewers[0]).toMatchObject({ championId: AHRI, picked: true, mode: "build", lane: "middle", nav: 1 });
    expect(ws.rows[2]).toEqual({ ally: AHRI, enemy: ZED });
    expect(ws.pending).toEqual([ZED]);
  });

  it("does not treat the first snapshot as a new match", () => {
    const ws = match(initialWorkspace(), ms({ matchSeq: 5, self: { championId: AHRI, lane: "middle" } }));
    expect(ws.viewers).toHaveLength(1);
  });
});

describe("my pick", () => {
  const pick = (id: number, lane: Lane | null, extra: Omit<Partial<MatchState>, "allies"> = {}) => ms({ self: { championId: id, lane }, ...extra });

  it("adds a picked viewer on the left each time champion or lane changes; repeats do nothing (M-002)", () => {
    let ws = match(initialWorkspace(), pick(AHRI, "middle"));
    ws = match(ws, pick(AHRI, "middle"));
    expect(ws.viewers).toHaveLength(1);
    ws = match(ws, pick(ZED, "middle"));
    ws = match(ws, pick(ZED, "top"));
    expect(ws.viewers.map((v) => [v.championId, v.lane])).toEqual([[ZED, "top"], [ZED, "middle"], [AHRI, "middle"]]);
    expect(ws.viewers.every((v) => v.picked && v.nav === 1)).toBe(true);
    expect(ws.viewers.map((v) => v.id)).toEqual([3, 2, 1]);
  });

  it("is an ARAM viewer without a lane in ARAM", () => {
    const ws = match(initialWorkspace(), pick(AHRI, null, { isAram: true, queueId: 450 }));
    expect(ws.viewers[0]).toMatchObject({ mode: "aram", lane: null, championId: AHRI });
  });

  it("lets the same pick open again after self was cleared", () => {
    let ws = match(initialWorkspace(), pick(AHRI, "middle"));
    ws = match(ws, ms({ phase: "Lobby" }));
    expect(ws.lastSelf).toBeNull();
    ws = match(ws, pick(AHRI, "middle"));
    expect(ws.viewers).toHaveLength(2);
  });

  it("does not create viewers beyond the limit but remembers the pick", () => {
    let ws = initialWorkspace();
    for (let i = 0; i < MAX_VIEWERS; i++) ws = run(ws, { type: "addViewer" });
    ws = match(ws, pick(AHRI, "middle"));
    expect(ws.viewers).toHaveLength(MAX_VIEWERS);
    expect(ws.lastSelf).toEqual({ championId: AHRI, lane: "middle" });
    expect(canAddViewer(ws)).toBe(false);
  });
});

describe("pending enemy picks", () => {
  it("queues new enemies in pick order, once, in ChampSelect only", () => {
    let ws = match(initialWorkspace(), ms({ enemies: [ZED] }));
    ws = match(ws, ms({ enemies: [ZED, GAREN] }));
    ws = run(ws, { type: "removePending", championId: ZED });
    ws = match(ws, ms({ enemies: [ZED, GAREN, LEE] }));
    expect(ws.pending).toEqual([GAREN, LEE]);
    ws = match(ws, ms({ phase: "InProgress", enemies: [ZED, GAREN, LEE, JINX] }));
    expect(ws.pending).toEqual([GAREN, LEE]);
    expect(ws.viewers).toHaveLength(0);
  });
});

describe("user actions", () => {
  const withViewer = () => run(initialWorkspace(), { type: "addViewer" });

  it("addViewer appends an empty build viewer, up to 20", () => {
    let ws = withViewer();
    expect(ws.viewers[0]).toEqual({ id: 1, championId: null, opponentId: null, lane: null, mode: "build", picked: false, hidden: false, nav: 0 });
    for (let i = 0; i < 30; i++) ws = run(ws, { type: "addViewer" });
    expect(ws.viewers).toHaveLength(MAX_VIEWERS);
    expect(ws.viewers.at(-1)!.id).toBe(MAX_VIEWERS);
  });

  it("set* keep values without a champion and reopen (nav + 1) with one", () => {
    let ws = run(withViewer(), { type: "setMode", id: 1, mode: "counter" }, { type: "setLane", id: 1, lane: "top" }, { type: "setOpponent", id: 1, opponentId: ZED });
    expect(ws.viewers[0]).toMatchObject({ mode: "counter", lane: "top", opponentId: ZED, nav: 0 });
    ws = run(ws, { type: "setChampion", id: 1, championId: AHRI });
    expect(ws.viewers[0]!.nav).toBe(1);
    ws = run(ws, { type: "setLane", id: 1, lane: "middle" }, { type: "reopen", id: 1 });
    expect(ws.viewers[0]!.nav).toBe(3);
    ws = run(ws, { type: "setOpponent", id: 1, opponentId: null });
    expect(ws.viewers[0]).toMatchObject({ opponentId: null, nav: 4 });
  });

  it("reopen without a champion does nothing; unknown ids are ignored", () => {
    const ws = withViewer();
    expect(run(ws, { type: "reopen", id: 1 })).toBe(ws);
    expect(run(ws, { type: "setLane", id: 99, lane: "top" })).toBe(ws);
    expect(run(ws, { type: "closeViewer", id: 99 })).toBe(ws);
  });

  it("toggleHidden does not reopen", () => {
    let ws = run(withViewer(), { type: "setChampion", id: 1, championId: AHRI }, { type: "toggleHidden", id: 1 });
    expect(ws.viewers[0]).toMatchObject({ hidden: true, nav: 1 });
    ws = run(ws, { type: "toggleHidden", id: 1 });
    expect(ws.viewers[0]!.hidden).toBe(false);
  });

  it("closeViewer / closeAll (closeAll also drops pending)", () => {
    let ws = match(initialWorkspace(), ms({ self: { championId: AHRI, lane: "middle" }, enemies: [ZED] }));
    ws = run(ws, { type: "addViewer" });
    ws = run(ws, { type: "closeViewer", id: 2 });
    expect(ws.viewers.map((v) => v.id)).toEqual([1]);
    ws = run(ws, { type: "closeAll" });
    expect(ws.viewers).toEqual([]);
    expect(ws.pending).toEqual([]);
  });

  it("openPending makes a Counter viewer at index 1 when a picked viewer exists, else 0", () => {
    let ws = match(initialWorkspace(), ms({ enemies: [ZED, GAREN] }));
    ws = run(ws, { type: "addViewer" }, { type: "openPending", championId: ZED });
    expect(ws.viewers.map((v) => v.championId)).toEqual([ZED, null]);
    expect(ws.viewers[0]).toMatchObject({ mode: "counter", picked: false, nav: 1 });
    expect(ws.pending).toEqual([GAREN]);

    let ws2 = match(initialWorkspace(), ms({ self: { championId: AHRI, lane: "middle" }, enemies: [ZED] }));
    ws2 = run(ws2, { type: "addViewer" }, { type: "openPending", championId: ZED });
    expect(ws2.viewers.map((v) => v.championId)).toEqual([AHRI, ZED, null]);
    expect(run(ws2, { type: "openPending", championId: ZED })).toBe(ws2);
  });

  it("swapRows swaps within one side only; same row and out of range are ignored", () => {
    const base = match(initialWorkspace(), ms({ allies: [[GAREN, "top"], [ZED, "middle"]], enemies: [DARIUS, YASUO] }));
    const ws = run(base, { type: "swapRows", side: "ally", from: 0, to: 2 });
    expect(col(ws, "ally")).toEqual([ZED, null, GAREN, null, null]);
    expect(col(ws, "enemy")).toEqual(col(base, "enemy"));
    expect(run(base, { type: "swapRows", side: "enemy", from: 1, to: 1 })).toBe(base);
    expect(run(base, { type: "swapRows", side: "enemy", from: 0, to: 5 })).toBe(base);
    expect(run(base, { type: "swapRows", side: "enemy", from: -1, to: 0 })).toBe(base);
  });

  it("a swapped table is kept when the next snapshot arrives", () => {
    const state = ms({ allies: [[GAREN, "top"], [ZED, "middle"]] });
    let ws = match(initialWorkspace(), state);
    ws = run(ws, { type: "swapRows", side: "ally", from: 0, to: 2 });
    ws = match(ws, state);
    expect(col(ws, "ally")).toEqual([ZED, null, GAREN, null, null]);
  });

  it("openRow appends a build viewer with the row's enemy and lane (duplicates allowed); empty ally does nothing", () => {
    let ws = match(initialWorkspace(), ms({ allies: [[AHRI, "middle"]], enemies: [ZED] }));
    ws = run(ws, { type: "openRow", index: 2 }, { type: "openRow", index: 2 });
    expect(ws.viewers).toHaveLength(2);
    expect(ws.viewers[1]).toMatchObject({ championId: AHRI, opponentId: ZED, lane: "middle", mode: "build", nav: 1, picked: false });
    expect(run(ws, { type: "openRow", index: 0 })).toBe(ws);
    expect(viewerUrl(ws.viewers[1]!, DEFAULT_SETTINGS.urls)).toBe("https://lolalytics.com/lol/ahri/vs/zed/build/?lane=middle&vslane=middle");
  });

  it("openRow without an enemy gives a lane build page", () => {
    const ws = run(match(initialWorkspace(), ms({ allies: [[GAREN, "top"]] })), { type: "openRow", index: 0 });
    expect(viewerUrl(ws.viewers[0]!, DEFAULT_SETTINGS.urls)).toBe("https://lolalytics.com/lol/garen/build/?lane=top");
  });

  it("openRow with Wukong as the enemy keeps `wukong` in the URL", () => {
    let ws = match(initialWorkspace(), ms({ allies: [[GAREN, "top"]], enemies: [WUKONG] }));
    ws = run(ws, { type: "openRow", index: 0 });
    expect(viewerUrl(ws.viewers[0]!, DEFAULT_SETTINGS.urls)).toBe("https://lolalytics.com/lol/garen/vs/wukong/build/?lane=top&vslane=top");
  });

  it("refreshMatchup rebuilds the table from the last state, drops pending, keeps seenEnemies", () => {
    const state = ms({ allies: [[GAREN, "top"], [ZED, "middle"]], enemies: [DARIUS, LEE] });
    let ws = match(initialWorkspace(), state);
    ws = run(ws, { type: "swapRows", side: "ally", from: 0, to: 4 }, { type: "refreshMatchup" });
    expect(col(ws, "ally")).toEqual([GAREN, null, ZED, null, null]);
    expect(ws.pending).toEqual([]);
    expect(ws.seenEnemies).toEqual([DARIUS, LEE]);
    ws = match(ws, state);
    expect(ws.pending).toEqual([]);
  });

  it("debugAdd uses the first empty row, ignoring suitability and duplicates; full side does nothing", () => {
    let ws = initialWorkspace();
    ws = run(ws, { type: "debugAdd", side: "ally", championId: THRESH }, { type: "debugAdd", side: "ally", championId: THRESH });
    expect(col(ws, "ally")).toEqual([THRESH, THRESH, null, null, null]);
    for (let i = 0; i < 4; i++) ws = run(ws, { type: "debugAdd", side: "enemy", championId: JINX });
    expect(firstEmptyRow(ws, "enemy")).toBe(4);
    ws = run(ws, { type: "debugAdd", side: "enemy", championId: JINX });
    expect(firstEmptyRow(ws, "enemy")).toBeNull();
    expect(run(ws, { type: "debugAdd", side: "enemy", championId: ZED })).toBe(ws);
  });
});

describe("derived values", () => {
  const table = () => match(initialWorkspace(), ms({ allies: [[AHRI, "middle"]], enemies: [THRESH, ZED, LEE, JINX, GAREN] }));

  it("quickPicks: enemies in row order, current opponent excluded, at most 5", () => {
    const ws = table();
    expect(quickPicks(ws, { opponentId: null })).toEqual([GAREN, LEE, ZED, JINX, THRESH]);
    expect(quickPicks(ws, { opponentId: ZED })).toEqual([GAREN, LEE, JINX, THRESH]);
    const dup = run(ws, { type: "debugAdd", side: "enemy", championId: GAREN });
    expect(dup.rows.filter((r) => r.enemy === GAREN)).toHaveLength(1); // side full: nothing added
    const dupFull = { ...ws, rows: ws.rows.map((r, i) => (i === 4 ? { ...r, enemy: GAREN } : r)) };
    expect(quickPicks(dupFull, { opponentId: null })).toEqual([GAREN, LEE, ZED, JINX]);
  });

  it("opponentSuggestions: table enemies, else other viewers' champions and opponents (not my own champion)", () => {
    expect(opponentSuggestions(table(), { id: 1, championId: AHRI })).toEqual([GAREN, LEE, ZED, JINX, THRESH]);
    let ws = initialWorkspace();
    ws = run(
      ws,
      { type: "addViewer" },
      { type: "addViewer" },
      { type: "addViewer" },
      { type: "setChampion", id: 1, championId: AHRI },
      { type: "setChampion", id: 2, championId: ZED },
      { type: "setOpponent", id: 2, opponentId: AHRI },
      { type: "setChampion", id: 3, championId: LEE },
    );
    expect(opponentSuggestions(ws, { id: 1, championId: AHRI })).toEqual([ZED, LEE]);
    expect(opponentSuggestions(initialWorkspace(), { id: 1, championId: null })).toEqual([]);
  });

  it("defaultCooldownChampion: my lane's enemy, else the first enemy, else null", () => {
    expect(defaultCooldownChampion(initialWorkspace())).toBeNull();
    const state = (lane: Lane | null) => ms({ self: { championId: AHRI, lane }, allies: [[AHRI, lane]], enemies: [GAREN, ZED] });
    expect(defaultCooldownChampion(match(initialWorkspace(), state("middle")))).toBe(ZED);
    expect(defaultCooldownChampion(match(initialWorkspace(), state("support")))).toBe(GAREN); // my row has no enemy
    expect(defaultCooldownChampion(match(initialWorkspace(), state(null)))).toBe(GAREN);
  });

  it("firstEmptyRow reports the top-most empty row", () => {
    expect(firstEmptyRow(initialWorkspace(), "ally")).toBe(0);
    expect(firstEmptyRow(match(initialWorkspace(), ms({ allies: [[GAREN, "top"]] })), "ally")).toBe(1);
  });
});
