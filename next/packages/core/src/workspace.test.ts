import { describe, expect, it } from "vitest";
import type { Lane, MatchState } from "@lol-viewer/protocol";
import { initialMatchState } from "./reducer.ts";
import { DEFAULT_SETTINGS } from "./settings.ts";
import { viewerUrl } from "./urls.ts";
import type { LivePlayer } from "@lol-viewer/protocol";
import {
  MAX_VIEWERS,
  assignmentKey,
  correctSide,
  liveLaneAssignments,
  rowLiveDiff,
  teamLiveDiff,
  canAddViewer,
  defaultCooldownChampion,
  firstEmptyRow,
  initialWorkspace,
  opponentSuggestions,
  quickPicks,
  workspaceReducer,
  type MatchupRow,
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
const WUKONG = 62; // 0 5 0 0 0 (jungle, M-024)

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
    // Wukong's best lane is jungle (M-024), so he lands in the JG row opposite Lee Sin.
    let ws = match(initialWorkspace(), ms({ allies: [[GAREN, "top"], [LEE, "jungle"]], enemies: [WUKONG] }));
    expect(ws.rows[1]!.enemy).toBe(WUKONG);
    ws = run(ws, { type: "openRow", index: 1 });
    expect(viewerUrl(ws.viewers[0]!, DEFAULT_SETTINGS.urls)).toBe("https://lolalytics.com/lol/leesin/vs/wukong/build/?lane=jungle&vslane=jungle");
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

  it("defaultCooldownChampion: the enemy in my row, else my lane's row, else the first enemy, else null (M-028)", () => {
    expect(defaultCooldownChampion(initialWorkspace())).toBeNull();
    const state = (lane: Lane | null) => ms({ self: { championId: AHRI, lane }, allies: [[AHRI, lane]], enemies: [GAREN, ZED] });
    expect(defaultCooldownChampion(match(initialWorkspace(), state("middle")))).toBe(ZED);
    expect(defaultCooldownChampion(match(initialWorkspace(), state("support")))).toBe(GAREN); // my row has no enemy
    // no lane (blind, ARAM): Ahri is placed by suitability into MID, so my row's enemy is Zed
    expect(defaultCooldownChampion(match(initialWorkspace(), state(null)))).toBe(ZED);
  });

  it("defaultCooldownChampion follows me when I am moved to another row", () => {
    const ws0 = match(initialWorkspace(), ms({ self: { championId: AHRI, lane: "middle" }, allies: [[AHRI, "middle"]], enemies: [GAREN, ZED] }));
    expect(defaultCooldownChampion(run(ws0, { type: "swapRows", side: "ally", from: 2, to: 0 }))).toBe(GAREN);
  });

  it("firstEmptyRow reports the top-most empty row", () => {
    expect(firstEmptyRow(initialWorkspace(), "ally")).toBe(0);
    expect(firstEmptyRow(match(initialWorkspace(), ms({ allies: [[GAREN, "top"]] })), "ally")).toBe(1);
  });
});

// ── live correction (M-027) ───────────────────────────────────────

const PANTHEON = 80; // top
const GRAGAS = 79; // jungle
const JAYCE = 126; // top/mid
const VARUS = 110; // bottom
const KARMA = 43; // support
const lp = (championId: number, team: "ally" | "enemy", lane: Lane | null, level = 1, itemGold = 0): LivePlayer => ({ championId, team, lane, level, itemGold });
const rows5 = (side: "ally" | "enemy", ids: (number | null)[]): MatchupRow[] => ids.map((id) => ({ ally: null, enemy: null, [side]: id }));

describe("liveLaneAssignments / assignmentKey", () => {
  it("one claimant per lane; duplicates, null lanes and double champions are dropped", () => {
    const live = [lp(1, "enemy", "top"), lp(2, "enemy", "top"), lp(3, "enemy", "jungle"), lp(4, "enemy", null), lp(5, "enemy", "middle"), lp(5, "enemy", "bottom"), lp(9, "ally", "support")];
    const a = liveLaneAssignments(live, "enemy");
    expect([...a]).toEqual([[3, "jungle"]]);
    expect(assignmentKey(a)).toBe("jungle:3");
    expect(assignmentKey(new Map())).toBe("");
  });
  it("is in lane order", () => {
    const a = liveLaneAssignments([lp(1, "ally", "support"), lp(2, "ally", "top")], "ally");
    expect(assignmentKey(a)).toBe("top:2,support:1");
  });
});

describe("correctSide", () => {
  const enemyRows = () => rows5("enemy", [JAYCE, KARMA, GRAGAS, VARUS, PANTHEON]);
  const enemies = (rows: MatchupRow[]) => rows.map((r) => r.enemy);
  it("full assignment lines everyone up", () => {
    const a = new Map<number, Lane>([[PANTHEON, "top"], [GRAGAS, "jungle"], [JAYCE, "middle"], [VARUS, "bottom"], [KARMA, "support"]]);
    expect(enemies(correctSide(enemyRows(), "enemy", a))).toEqual([PANTHEON, GRAGAS, JAYCE, VARUS, KARMA]);
  });
  it("Smite only: the jungler swaps with the jungle row's owner, others stay", () => {
    const rows = rows5("enemy", [GAREN, ZED, LEE, JINX, THRESH]);
    const out = correctSide(rows, "enemy", new Map([[LEE, "jungle"]]));
    expect(enemies(out)).toEqual([GAREN, LEE, ZED, JINX, THRESH]);
  });
  it("two pushed-out champions go to their best free rows", () => {
    const rows = rows5("enemy", [ZED, GAREN, LEE, JINX, THRESH]);
    const out = correctSide(rows, "enemy", new Map<number, Lane>([[LEE, "top"], [THRESH, "jungle"]]));
    // Lee -> top, Thresh -> jungle; Zed (row 0 taken) and Garen (row 1 taken) displaced: Zed -> mid, Garen -> first best free (top/jg taken -> tie 0 -> row 4)
    expect(out.map((r) => r.enemy)).toEqual([LEE, THRESH, ZED, JINX, GAREN]);
  });
  it("ignores champions not in the table, returns the same array for nothing to do", () => {
    const rows = enemyRows();
    expect(correctSide(rows, "enemy", new Map([[ASHE, "top"]]))).toBe(rows);
    expect(correctSide(rows, "enemy", new Map())).toBe(rows);
    expect(correctSide(rows, "enemy", new Map<number, Lane>([[JAYCE, "top"]])).map((r) => r.enemy)).toContain(KARMA);
  });
  it("handles empty cells and never changes the count", () => {
    const rows = rows5("enemy", [null, ZED, null, null, LEE]);
    const out = correctSide(rows, "enemy", new Map([[LEE, "jungle"]]));
    expect(out.map((r) => r.enemy).filter((x) => x != null).sort()).toEqual([LEE, ZED].sort());
    expect(out[1]!.enemy).toBe(LEE);
  });
});

describe("applyMatch with live data", () => {
  const ally = [[GAREN, "top"], [LEE, "jungle"], [AHRI, "middle"], [JINX, "bottom"], [THRESH, "support"]] as Pick[];
  const guessed = (live: LivePlayer[] | null, phase = "InProgress") =>
    ms({ phase, self: { championId: AHRI, lane: "middle" }, allies: ally, enemies: [JAYCE, GRAGAS, PANTHEON, VARUS, KARMA], live });
  const liveList = (enemyLanes: (Lane | null)[]): LivePlayer[] => [
    ...ally.map(([id, lane]) => lp(id, "ally", lane)),
    ...[PANTHEON, GRAGAS, JAYCE, VARUS, KARMA].map((id, i) => lp(id, "enemy", enemyLanes[i]!)),
  ];
  const real = liveList(["top", "jungle", "middle", "bottom", "support"]);

  it("moves enemies to their lanes, leaves allies", () => {
    const before = match(initialWorkspace(), guessed(null, "ChampSelect"));
    const ws = match(before, guessed(real));
    expect(col(ws, "enemy")).toEqual([PANTHEON, GRAGAS, JAYCE, VARUS, KARMA]);
    expect(col(ws, "ally")).toEqual(col(before, "ally"));
    expect(ws.liveApplied.enemy).not.toBeNull();
  });
  it("keeps the user's swap on the next identical live state", () => {
    let ws = match(match(initialWorkspace(), guessed(null, "ChampSelect")), guessed(real));
    ws = run(ws, { type: "swapRows", side: "enemy", from: 0, to: 1 });
    const swapped = col(ws, "enemy");
    ws = match(ws, guessed(real.map((p) => ({ ...p, level: p.level + 1 }))));
    expect(col(ws, "enemy")).toEqual(swapped);
  });
  it("corrects again when the assignment changes", () => {
    let ws = match(match(initialWorkspace(), guessed(null, "ChampSelect")), guessed(liveList([null, null, null, null, null])));
    expect(col(ws, "enemy")).toEqual([JAYCE, KARMA, GRAGAS, VARUS, PANTHEON]);
    ws = match(ws, guessed(real));
    expect(col(ws, "enemy")).toEqual([PANTHEON, GRAGAS, JAYCE, VARUS, KARMA]);
  });
  it("does nothing outside InProgress, or without live", () => {
    const ws = match(match(initialWorkspace(), guessed(null, "ChampSelect")), guessed(real, "ChampSelect"));
    expect(col(ws, "enemy")).toEqual([JAYCE, KARMA, GRAGAS, VARUS, PANTHEON]);
    const off = match(match(initialWorkspace(), guessed(null, "ChampSelect")), guessed(null));
    expect(off.liveApplied).toEqual({ ally: null, enemy: null });
  });
  it("resets on a new match; refresh redoes the correction and drops swaps", () => {
    let ws = match(match(initialWorkspace(), guessed(null, "ChampSelect")), guessed(real));
    ws = run(ws, { type: "swapRows", side: "enemy", from: 0, to: 1 });
    ws = run(ws, { type: "refreshMatchup" });
    expect(col(ws, "enemy")).toEqual([PANTHEON, GRAGAS, JAYCE, VARUS, KARMA]);
    ws = match(ws, { ...guessed(null, "ChampSelect"), matchSeq: 2 });
    expect(ws.liveApplied).toEqual({ ally: null, enemy: null });
  });
});

describe("rowLiveDiff", () => {
  const live = [lp(AHRI, "ally", "middle", 12, 4650), lp(JAYCE, "enemy", "middle", 11, 4800), lp(GAREN, "ally", "top", 3, 100)];
  const ws = match(initialWorkspace(), ms({ phase: "InProgress", allies: [[AHRI, "middle"], [GAREN, "top"]], enemies: [JAYCE], live }));
  it("ally minus enemy; null when a side is missing or unknown", () => {
    expect(rowLiveDiff(ws, 2)).toMatchObject({ gold: -150, level: 1 });
    expect(rowLiveDiff(ws, 0)).toBeNull(); // no enemy in the top row
    expect(rowLiveDiff(ws, 1)).toBeNull();
    const unknown = run(ws, { type: "debugAdd", side: "enemy", championId: ZED });
    expect(rowLiveDiff(unknown, 0)).toBeNull(); // Zed not in the live list
  });
  it("null without live data", () => {
    expect(rowLiveDiff(match(initialWorkspace(), ms({ allies: [[AHRI, "middle"]], enemies: [JAYCE] })), 2)).toBeNull();
  });
  it("stays after the game and goes with the next match (M-031)", () => {
    const base = { allies: [[AHRI, "middle"], [GAREN, "top"]] as Pick[], enemies: [JAYCE], live };
    const ended = match(match(ws, ms({ ...base, phase: "EndOfGame" })), ms({ ...base, phase: "Lobby" }));
    expect(rowLiveDiff(ended, 2)).toMatchObject({ gold: -150, level: 1 });
    const next = match(ended, ms({ phase: "ChampSelect", matchSeq: 2 }));
    expect(rowLiveDiff(next, 2)).toBeNull();
    expect(col(next, "ally")).toEqual([null, null, null, null, null]);
  });
});

describe("teamLiveDiff", () => {
  it("sums every live player per team, placed in the table or not", () => {
    const live = [lp(AHRI, "ally", "middle", 12, 4650), lp(GAREN, "ally", "top", 3, 100), lp(JAYCE, "enemy", "middle", 11, 4800), lp(ZED, "enemy", null, 9, 2000)];
    const ws = match(initialWorkspace(), ms({ phase: "InProgress", allies: [[AHRI, "middle"], [GAREN, "top"]], enemies: [JAYCE], live }));
    expect(teamLiveDiff(ws)).toEqual({ gold: -2050, allyGold: 4750, enemyGold: 6800, allyCount: 2, enemyCount: 2 });
  });
  it("null without live data or with an empty side", () => {
    expect(teamLiveDiff(match(initialWorkspace(), ms({ allies: [[AHRI, "middle"]], enemies: [JAYCE] })))).toBeNull();
    const onlyAllies = match(initialWorkspace(), ms({ phase: "InProgress", allies: [[AHRI, "middle"]], live: [lp(AHRI, "ally", "middle", 1, 500)] }));
    expect(teamLiveDiff(onlyAllies)).toBeNull();
  });
});
