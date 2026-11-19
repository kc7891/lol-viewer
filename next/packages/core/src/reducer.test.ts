import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { LcuEvent } from "@lol-viewer/protocol";
import { MatchStateSchema } from "@lol-viewer/protocol";
import { initialMatchState, normalizeLane, reduce, reduceAll } from "./reducer.ts";
import { parseScenario, scenarioEvents } from "./scenario.ts";

const scenario = parseScenario(
  readFileSync(new URL("../../../scenarios/ranked-two-matches.jsonl", import.meta.url), "utf8"),
);

const cs = (gameId: number, my: number[], their: number[] = [], local = 0): LcuEvent => ({
  type: "champ-select-session",
  session: {
    gameId,
    localPlayerCellId: local,
    myTeam: my.map((championId, cellId) => ({
      cellId,
      championId,
      assignedPosition: ["top", "jungle", "middle", "bottom", "utility"][cellId],
    })),
    theirTeam: their.map((championId, i) => ({ cellId: 5 + i, championId })),
  },
});

describe("normalizeLane", () => {
  it.each([
    ["utility", "support"],
    ["MIDDLE", "middle"],
    ["", null],
    [undefined, null],
  ])("%s -> %s", (raw, lane) => {
    expect(normalizeLane(raw)).toBe(lane);
  });
});

describe("reduce", () => {
  it("bumps matchSeq when entering ChampSelect and resets picks", () => {
    let s = reduce(initialMatchState(), { type: "gameflow-phase", phase: "ChampSelect" });
    s = reduce(s, cs(1, [122]));
    expect(s.matchSeq).toBe(1);
    expect(s.self).toEqual({ championId: 122, lane: "top" });

    s = reduce(s, { type: "gameflow-phase", phase: "InProgress" });
    s = reduce(s, { type: "gameflow-phase", phase: "ChampSelect" });
    expect(s.matchSeq).toBe(2);
    expect(s.self).toBeNull();
    expect(s.allies).toEqual([]);
  });

  it("does not bump twice when the session arrives before the phase event", () => {
    let s = reduce(initialMatchState(), cs(1, [0]));
    s = reduce(s, { type: "gameflow-phase", phase: "ChampSelect" });
    expect(s.matchSeq).toBe(1);
  });

  it("treats a gameId change inside ChampSelect as a new match (dodge -> requeue)", () => {
    let s = reduce(initialMatchState(), cs(1, [122]));
    s = reduce(s, cs(2, [0]));
    expect(s.matchSeq).toBe(2);
    expect(s.gameId).toBe(2);
    expect(s.self).toBeNull();
  });

  it("keeps picks when the champ-select session is deleted (game starting)", () => {
    let s = reduce(initialMatchState(), cs(1, [122], [86]));
    s = reduce(s, { type: "champ-select-session", session: null });
    expect(s.matchups[0]).toEqual({ lane: "top", allyChampionId: 122, enemyChampionId: 86 });
  });

  it("places allies without assigned positions in pick order (blind pick)", () => {
    const s = reduce(initialMatchState(), {
      type: "champ-select-session",
      session: {
        localPlayerCellId: 0,
        myTeam: [
          { cellId: 0, championId: 103 },
          { cellId: 1, championId: 222 },
        ],
        theirTeam: [],
      },
    });
    expect(s.matchups.map((r) => r.allyChampionId)).toEqual([103, 222, null, null, null]);
  });

  it("returns the same object for no-op events (cheap change detection)", () => {
    const s = initialMatchState();
    expect(reduce(s, { type: "connection", status: "connecting" })).toBe(s);
  });
});

describe("scenario: ranked-two-matches", () => {
  const events = scenarioEvents(scenario);

  it("every intermediate state satisfies the MatchState schema", () => {
    let s = initialMatchState();
    for (const e of events) {
      s = reduce(s, e);
      expect(() => MatchStateSchema.parse(s)).not.toThrow();
    }
  });

  it("end of match 1: full matchup table", () => {
    const endOfMatch1 = events.findIndex((e) => e.type === "gameflow-phase" && e.phase === "EndOfGame");
    const s = reduceAll(events.slice(0, endOfMatch1 + 1));
    expect(s.matchSeq).toBe(1);
    expect(s.queueId).toBe(420);
    expect(s.self).toEqual({ championId: 103, lane: "middle" });
    expect(s.matchups).toEqual([
      { lane: "top", allyChampionId: 122, enemyChampionId: 86 },
      { lane: "jungle", allyChampionId: 64, enemyChampionId: 76 },
      { lane: "middle", allyChampionId: 103, enemyChampionId: 238 },
      { lane: "bottom", allyChampionId: 222, enemyChampionId: 51 },
      { lane: "support", allyChampionId: 412, enemyChampionId: 89 },
    ]);
  });

  it("match 2 starts clean", () => {
    const s = reduceAll(events);
    expect(s.matchSeq).toBe(2);
    expect(s.gameId).toBe(1002);
    expect(s.self).toEqual({ championId: 266, lane: "top" });
    expect(s.matchups[0]).toEqual({ lane: "top", allyChampionId: 266, enemyChampionId: 122 });
    expect(s.matchups.slice(1).every((r) => r.allyChampionId == null)).toBe(true);
  });
});
