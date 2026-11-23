import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MatchStateSchema, type LcuEvent } from "@lol-viewer/protocol";
import { initialDetectorState, initialMatchState, normalizeLane, reduce, reduceAll, type DetectorState } from "./reducer.ts";
import { parseScenario, scenarioEvents, toLcuEvent } from "./scenario.ts";

const load = (name: string) => scenarioEvents(parseScenario(readFileSync(new URL(`../../../scenarios/${name}.jsonl`, import.meta.url), "utf8")));
const ranked = load("ranked-two-matches");

const POS = ["top", "jungle", "middle", "bottom", "utility"];
const cs = (gameId: number | undefined, my: number[], their: number[] = [], local = 0, extra: Record<string, unknown> = {}): LcuEvent => ({
  type: "champ-select-session",
  session: {
    gameId,
    localPlayerCellId: local,
    myTeam: my.map((championId, cellId) => ({ cellId, championId, assignedPosition: POS[cellId], ...extra })),
    theirTeam: their.map((championId, i) => ({ cellId: 5 + i, championId })),
  },
});
const phase = (p: string): LcuEvent => ({ type: "gameflow-phase", phase: p });
const gf = (session: Record<string, unknown>): LcuEvent => ({ type: "gameflow-session", session });
const run = (...events: LcuEvent[]): DetectorState => reduceAll(events);

describe("normalizeLane", () => {
  it.each([
    ["utility", "support"],
    ["UTILITY", "support"],
    ["mid", "middle"],
    ["MIDDLE", "middle"],
    ["bot", "bottom"],
    ["bottom", "bottom"],
    ["top", "top"],
    ["jungle", "jungle"],
    ["", null],
    ["nonsense", null],
    [undefined, null],
  ])("%s -> %s", (raw, lane) => {
    expect(normalizeLane(raw)).toBe(lane);
  });
});

describe("new match", () => {
  it("bumps matchSeq entering ChampSelect and clears picks and gameId", () => {
    let d = run(phase("ChampSelect"), cs(1, [122], [86]));
    expect(d.match).toMatchObject({ matchSeq: 1, gameId: 1, self: { championId: 122, lane: "top" } });
    d = reduceAll([phase("InProgress"), phase("ChampSelect")], d);
    expect(d.match).toMatchObject({ matchSeq: 2, gameId: null, self: null, allies: [], enemies: [] });
  });

  it("does not bump twice when the session arrives before the phase event", () => {
    const d = run(cs(1, [0]), phase("ChampSelect"));
    expect(d.match.matchSeq).toBe(1);
  });

  it("treats a gameId change inside ChampSelect as a new match (dodge)", () => {
    const d = run(cs(1, [122]), cs(2, [0]));
    expect(d.match).toMatchObject({ matchSeq: 2, gameId: 2, self: null });
  });

  it("ignores gameId 0 / missing when detecting a dodge", () => {
    const d = run(cs(1, [122]), cs(0, [122]), cs(undefined, [122]), cs(1, [122]));
    expect(d.match.matchSeq).toBe(1);
    expect(d.match.gameId).toBe(1);
  });
});

describe("my pick", () => {
  it("keeps self when championId drops back to 0", () => {
    const d = run(cs(1, [122]), cs(1, [0]));
    expect(d.match.self).toEqual({ championId: 122, lane: "top" });
  });

  it("follows hover changes and uses the assigned lane", () => {
    const d = run(cs(1, [122]), cs(1, [266]));
    expect(d.match.self).toEqual({ championId: 266, lane: "top" });
  });

  it("is null for an empty lane (blind pick)", () => {
    const d = run({ type: "champ-select-session", session: { localPlayerCellId: 0, myTeam: [{ cellId: 0, championId: 103 }], theirTeam: [] } });
    expect(d.match.self).toEqual({ championId: 103, lane: null });
  });

  it("does not use championPickIntent", () => {
    const d = run({ type: "champ-select-session", session: { localPlayerCellId: 0, myTeam: [{ cellId: 0, championId: 0, championPickIntent: 103 }], theirTeam: [] } });
    expect(d.match.self).toBeNull();
  });
});

describe("allies and enemies", () => {
  it("lists only picked champions in order and drops ids missing from the data", () => {
    const d = run(cs(1, [122, 0, 103, 999999, 412], [0, 86, 238]));
    expect(d.match.allies).toEqual([
      { championId: 122, lane: "top" },
      { championId: 103, lane: "middle" },
      { championId: 412, lane: "support" },
    ]);
    expect(d.match.enemies).toEqual([86, 238]);
  });

  it("keeps the lists when the champ-select session is deleted", () => {
    const d = run(cs(1, [122], [86]), { type: "champ-select-session", session: null });
    expect(d.match.allies).toHaveLength(1);
    expect(d.match.enemies).toEqual([86]);
  });
});

describe("None / Lobby", () => {
  it.each(["None", "Lobby"])("%s clears self, gameId and summoner but keeps the lists", (p) => {
    const d = run(cs(1, [122], [86], 0, { summonerId: 5, puuid: "x" }), phase(p));
    expect(d.match).toMatchObject({ phase: p, self: null, gameId: null });
    expect(d.match.allies).toHaveLength(1);
    expect(d.match.enemies).toEqual([86]);
    expect(d.summonerId).toBeNull();
    expect(d.puuid).toBeNull();
  });
});

describe("in game", () => {
  const team = (ids: number[], base: number) => ids.map((championId, i) => ({ championId, summonerId: base + i }));
  const session = (one: number[], two: number[]) =>
    gf({ phase: "InProgress", gameData: { gameId: 9, queue: 420, teamOne: team(one, 100), teamTwo: team(two, 200) } });

  it("builds both teams from gameflow and keeps my champ-select pick", () => {
    const d = run(cs(1, [122], [86], 0, { summonerId: 100 }), phase("InProgress"), session([122, 64], [86, 238]));
    expect(d.match.allies).toEqual([{ championId: 122, lane: null }, { championId: 64, lane: null }]);
    expect(d.match.enemies).toEqual([86, 238]);
    expect(d.match.self).toEqual({ championId: 122, lane: "top" });
    expect(d.match.gameId).toBe(9);
  });

  it("decides my team by summonerId (teamTwo)", () => {
    const d = run(cs(1, [86], [122], 0, { summonerId: 200 }), session([122, 64], [86, 238]));
    expect(d.match.allies.map((a) => a.championId)).toEqual([86, 238]);
    expect(d.match.enemies).toEqual([122, 64]);
  });

  it("decides my team by puuid", () => {
    const mk = (championId: number, puuid: string) => ({ championId, puuid });
    const d = run(
      { type: "current-summoner", summoner: { puuid: "me" } },
      gf({ phase: "InProgress", gameData: { teamOne: [mk(122, "a")], teamTwo: [mk(86, "me")] } }),
    );
    expect(d.match.allies.map((a) => a.championId)).toEqual([86]);
  });

  it("assumes teamOne when identity is unknown, then fixes it when current-summoner arrives", () => {
    let d = run(session([122, 64], [86, 238]));
    expect(d.match.allies.map((a) => a.championId)).toEqual([122, 64]);
    d = reduce(d, { type: "current-summoner", summoner: { summonerId: 200 } });
    expect(d.match.allies.map((a) => a.championId)).toEqual([86, 238]);
  });

  it("keeps the previous lists when the gameflow teams are empty", () => {
    const d = run(cs(1, [122], [86], 0), session([], []));
    expect(d.match.allies).toHaveLength(1);
    expect(d.match.enemies).toEqual([86]);
  });

  it("rebuilds the lists when the InProgress phase event comes after the session", () => {
    const d = run(phase("GameStart"), gf({ phase: "GameStart", gameData: { teamOne: team([122], 100), teamTwo: team([86], 200) } }), phase("InProgress"));
    expect(d.match.allies.map((a) => a.championId)).toEqual([122]);
  });
});

describe("current-summoner", () => {
  it("is stored in the detector state but never in MatchState", () => {
    const d = run({ type: "current-summoner", summoner: { summonerId: 77, puuid: "p" } });
    expect(d).toMatchObject({ summonerId: 77, puuid: "p" });
    expect(Object.keys(d.match)).not.toContain("summonerId");
  });
  it("prefers the champ-select row when present", () => {
    const d = run({ type: "current-summoner", summoner: { summonerId: 77 } }, cs(1, [122], [], 0, { summonerId: 5 }));
    expect(d.summonerId).toBe(5);
  });
});

describe("queue and ARAM", () => {
  it.each([
    ["bare number", { queue: 450 }, 450, null, true],
    ["{id}", { queue: { id: 420 } }, 420, null, false],
    ["{queueId}", { queue: { queueId: 450 } }, 450, null, true],
    ["queue.gameMode", { queue: { id: 999, gameMode: "ARAM" } }, 999, "ARAM", true],
    ["queue.mode", { queue: { id: 999, mode: "ARAM" } }, 999, "ARAM", true],
    ["gameData.gameMode", { queue: { id: 999 }, gameMode: "ARAM" }, 999, "ARAM", true],
    ["classic", { queue: { id: 420, gameMode: "CLASSIC" } }, 420, "CLASSIC", false],
    ["mayhem 2400", { queue: 2400 }, 2400, null, true],
    ["blind 430", { queue: 430 }, 430, null, false],
  ])("%s", (_n, gameData, queueId, gameMode, isAram) => {
    const d = run(gf({ phase: "ChampSelect", gameData }));
    expect(d.match).toMatchObject({ queueId, gameMode, isAram });
  });

  it.each([450, 65, 100, 720, 2400, 2401, 2403, 2405, 3240, 3270])("queue %i is ARAM", (q) => {
    expect(run(gf({ gameData: { queue: q } })).match.isAram).toBe(true);
  });

  it("keeps the queue across the new-match reset (gameflow arrives before the phase)", () => {
    const d = run(gf({ gameData: { queue: 450 } }), phase("ChampSelect"));
    expect(d.match).toMatchObject({ queueId: 450, isAram: true, matchSeq: 1 });
  });
});

describe("connection", () => {
  it("disconnect resets the phase to None but keeps the lists; reconnect into ChampSelect is a new match", () => {
    let d = run({ type: "connection", status: "connected" }, phase("ChampSelect"), cs(1, [122], [86]));
    d = reduce(d, { type: "connection", status: "disconnected" });
    expect(d.match).toMatchObject({ connection: "disconnected", phase: "None" });
    expect(d.match.allies).toHaveLength(1);
    d = reduceAll([{ type: "connection", status: "connected" }, phase("ChampSelect")], d);
    expect(d.match.matchSeq).toBe(2);
  });

  it("returns the same object for no-op events", () => {
    const d = initialDetectorState();
    expect(reduce(d, { type: "connection", status: "connecting" })).toBe(d);
    expect(reduce(d, phase("None"))).toBe(d);
    expect(reduce(d, { type: "champ-select-session", session: null })).toBe(d);
  });

  it("keeps the same MatchState object when an event changes nothing observable", () => {
    const d = run(phase("ChampSelect"), cs(1, [122], [86]));
    const again = reduce(d, cs(1, [122], [86]));
    expect(again.match).toBe(d.match);
  });
});

describe("scenarios", () => {
  it.each(["ranked-two-matches", "aram-match", "blind-dodge-ingame"])("%s: every state satisfies the schema", (name) => {
    let d = initialDetectorState();
    for (const e of load(name)) {
      d = reduce(d, e);
      expect(() => MatchStateSchema.parse(d.match)).not.toThrow();
    }
  });

  it("ranked: end of match 1 has the full teams", () => {
    const end = ranked.findIndex((e) => e.type === "gameflow-phase" && e.phase === "EndOfGame");
    const { match } = reduceAll(ranked.slice(0, end + 1));
    expect(match).toMatchObject({ matchSeq: 1, queueId: 420, isAram: false, self: { championId: 103, lane: "middle" } });
    expect(match.allies).toEqual([
      { championId: 122, lane: "top" },
      { championId: 64, lane: "jungle" },
      { championId: 103, lane: "middle" },
      { championId: 222, lane: "bottom" },
      { championId: 412, lane: "support" },
    ]);
    expect(match.enemies).toEqual([86, 76, 238, 51, 89]);
  });

  it("ranked: match 2 starts clean", () => {
    const { match } = reduceAll(ranked);
    expect(match).toMatchObject({ matchSeq: 2, gameId: 1002, self: { championId: 266, lane: "top" } });
    expect(match.allies).toEqual([{ championId: 266, lane: "top" }]);
    expect(match.enemies).toEqual([122]);
  });

  it("aram: queue 450, no lanes, my pick is the second slot", () => {
    const events = load("aram-match");
    const { match } = reduceAll(events.slice(0, events.findIndex((e) => e.type === "gameflow-phase" && e.phase === "GameStart")));
    expect(match).toMatchObject({ queueId: 450, gameMode: "ARAM", isAram: true, self: { championId: 238, lane: null } });
    expect(match.allies.every((a) => a.lane === null)).toBe(true);
    expect(match.enemies).toHaveLength(5);
  });

  it("blind-dodge-ingame: dodge bumps matchSeq; in game I am on teamTwo", () => {
    const events = load("blind-dodge-ingame");
    const dodge = reduceAll(events.slice(0, events.findIndex((e) => e.type === "gameflow-phase" && e.phase === "GameStart")));
    expect(dodge.match).toMatchObject({ matchSeq: 2, gameId: 4002, queueId: 430, isAram: false, self: { championId: 62, lane: null } });
    const end = reduceAll(events);
    expect(end.match.allies.map((a) => a.championId)).toEqual([62, 222, 103, 412, 32]);
    expect(end.match.enemies).toEqual([86, 238, 22, 64, 89]);
    expect(end.match.queueId).toBe(430);
    expect(end.match.gameMode).toBe("CLASSIC");
  });
});

it("initialMatchState is schema-valid", () => {
  expect(() => MatchStateSchema.parse(initialMatchState())).not.toThrow();
});

describe("live-players (M-025..M-029)", () => {
  const liveScenario = load("live-ingame");
  const idx = liveScenario.map((e, i) => (e.type === "live-players" && e.players ? i : -1)).filter((i) => i >= 0);
  const upTo = (n: number) => reduceAll(liveScenario.slice(0, n + 1));

  it("toLcuEvent: skips broken players; Delete (API gone) and non-array are ignored", () => {
    const good = { championName: "Ahri", team: "ORDER", level: 2 };
    expect(toLcuEvent({ uri: "/liveclientdata/playerlist", eventType: "Update", data: [good, { team: 5 }, 7] })).toEqual({
      type: "live-players",
      players: [{ championId: 103, team: "ORDER", lane: null, level: 2, itemGold: 0 }],
    });
    expect(toLcuEvent({ uri: "/liveclientdata/playerlist", eventType: "Delete", data: null })).toBeNull();
    expect(toLcuEvent({ uri: "/liveclientdata/playerlist", eventType: "Update", data: {} })).toBeNull();
  });

  it("scenario: the second playerlist gives table B of the design", () => {
    const live = upTo(idx[1]!).match.live!;
    expect(live).toHaveLength(10);
    expect(live.map((p) => [p.team, p.championId, p.lane, p.level, p.itemGold])).toEqual([
      ["enemy", 126, "middle", 11, 4800],
      ["enemy", 79, "jungle", 9, 2750],
      ["enemy", 80, "top", 10, 4350],
      ["enemy", 110, "bottom", 11, 5850],
      ["enemy", 43, "support", 8, 2900],
      ["ally", 86, "top", 11, 4500],
      ["ally", 64, "jungle", 10, 4150],
      ["ally", 103, "middle", 12, 4650],
      ["ally", 222, "bottom", 10, 4900],
      ["ally", 412, "support", 8, 2900],
    ]);
    expect(MatchStateSchema.safeParse(upTo(idx[1]!).match).success).toBe(true);
  });

  it("ignores live-players outside InProgress (same object back)", () => {
    const d = reduceAll(liveScenario.slice(0, 3));
    const ev = liveScenario[idx[0]!]!;
    expect(reduce(d, ev)).toBe(d);
  });

  it("keeps live after the game: EndOfGame, Lobby, None and disconnect (M-031)", () => {
    const d = upTo(idx[1]!);
    const kept = d.match.live;
    expect(kept).not.toBeNull();
    let after = reduce(d, phase("EndOfGame"));
    expect(after.match.live).toEqual(kept);
    after = reduce(after, phase("Lobby"));
    expect(after.match.live).toEqual(kept);
    after = reduce(after, phase("None"));
    expect(after.match.live).toEqual(kept);
    expect(reduce(d, { type: "connection", status: "disconnected" }).match.live).toEqual(kept);
    // the whole scenario ends in the lobby (after the API went away): still there
    expect(reduceAll(liveScenario).match.live).toEqual(kept);
  });

  it("clears live on the next match, on the next game and on null (M-031)", () => {
    const d = upTo(idx[1]!);
    const lobby = reduce(reduce(d, phase("EndOfGame")), phase("Lobby"));
    const next = reduce(lobby, phase("ChampSelect"));
    expect(next.match.live).toBeNull();
    expect(next.liveFacts).toBeNull();
    // a game that starts without champ select (e.g. the app started late)
    const noPick = reduce(reduce(d, phase("EndOfGame")), phase("InProgress"));
    expect(noPick.match.live).toBeNull();
    expect(noPick.liveFacts).toBeNull();
    // resuming the same game keeps it
    expect(reduce(reduce(d, phase("Reconnect")), phase("InProgress")).match.live).toEqual(d.match.live);
    expect(reduce(d, { type: "live-players", players: null }).match.live).toBeNull();
  });

  it("an identical playerlist keeps the same MatchState object", () => {
    const d = upTo(idx[1]!);
    const again = reduce(d, liveScenario[idx[1]!]!);
    expect(again.match).toBe(d.match);
  });

  it("rebuilds teams when current-summoner arrives later", () => {
    const events = liveScenario.filter((e) => e.type !== "current-summoner");
    const noSelf = events.slice(0, events.findIndex((e) => e.type === "live-players") + 1);
    // self is known from champ select, so the team is right either way
    expect(reduceAll(noSelf).match.live!.filter((p) => p.team === "ally").map((p) => p.championId)).toContain(103);
    const d = reduce({ ...reduceAll(noSelf), match: { ...reduceAll(noSelf).match, self: null } }, { type: "live-players", players: reduceAll(noSelf).liveFacts });
    expect(d.match.live).not.toBeNull();
  });
});
