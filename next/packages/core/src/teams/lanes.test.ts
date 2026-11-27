import { describe, expect, it } from "vitest";
import type { LaneProfile } from "@lol-viewer/protocol";
import type { PlayerGame } from "./cache.ts";
import { COUNTED_QUEUES, laneOf, laneProfileFromGames, mainLanes } from "./lanes.ts";

const NOW = 1_000_000_000_000;
const DAY = 86_400_000;

describe("laneOf", () => {
  it("maps lane and role of the client", () => {
    expect(laneOf({ lane: "TOP", role: "SOLO" })).toBe("top");
    expect(laneOf({ lane: "JUNGLE", role: "NONE" })).toBe("jungle");
    expect(laneOf({ lane: "MIDDLE", role: "SOLO" })).toBe("middle");
    expect(laneOf({ lane: "MID", role: "SOLO" })).toBe("middle");
    expect(laneOf({ lane: "BOTTOM", role: "CARRY" })).toBe("bottom");
    expect(laneOf({ lane: "BOTTOM", role: "DUO_CARRY" })).toBe("bottom");
  });
  it("detects support from the role, whatever the lane is", () => {
    expect(laneOf({ lane: "NONE", role: "SUPPORT" })).toBe("support");
    expect(laneOf({ lane: "BOTTOM", role: "DUO_SUPPORT" })).toBe("support");
  });
  it("uses Smite as a fallback for jungle, and otherwise does not count the game", () => {
    expect(laneOf({ lane: "NONE", role: "NONE", spell1Id: 4, spell2Id: 11 })).toBe("jungle");
    expect(laneOf({ lane: "NONE", role: "NONE", spell1Id: 11, spell2Id: 4 })).toBe("jungle");
    expect(laneOf({ lane: "NONE", role: "NONE", spell1Id: 4, spell2Id: 7 })).toBeNull();
    expect(laneOf({})).toBeNull();
    expect(laneOf({ lane: 5, role: null })).toBeNull();
  });
  it("does not let Smite override a clear lane", () => {
    expect(laneOf({ lane: "MIDDLE", role: "SOLO", spell1Id: 11 })).toBe("middle");
  });
});

describe("laneProfileFromGames", () => {
  const g = (gameId: number, queueId: number, daysAgo: number, lane: PlayerGame["lane"]): PlayerGame => ({ gameId, queueId, at: NOW - daysAgo * DAY, lane });
  it("counts only the counted queues within 60 days", () => {
    const p = laneProfileFromGames(
      [g(1, 400, 1, "top"), g(2, 420, 2, "top"), g(3, 2400, 1, "top"), g(4, 3100, 1, "top"), g(5, 440, 61, "top"), g(6, 430, 60, "jungle"), g(7, 480, 3, null)],
      NOW,
    );
    expect(p.counts).toEqual({ top: 2, jungle: 1, middle: 0, bottom: 0, support: 0 });
    expect(p.games).toBe(3);
    expect(p.fetchedAt).toBe(NOW);
    expect(COUNTED_QUEUES).toEqual([400, 420, 430, 440, 480, 490]);
  });
});

describe("mainLanes", () => {
  const prof = (counts: Partial<LaneProfile["counts"]>): LaneProfile => {
    const c = { top: 0, jungle: 0, middle: 0, bottom: 0, support: 0, ...counts };
    return { counts: c, games: Object.values(c).reduce((a, b) => a + b, 0), fetchedAt: NOW };
  };
  it("picks main, and sub when it is at least 20%", () => {
    expect(mainLanes(prof({ middle: 8, bottom: 2 }))).toEqual({ main: "middle", sub: "bottom", thin: false });
    expect(mainLanes(prof({ middle: 9, bottom: 1 }))).toEqual({ main: "middle", sub: null, thin: false });
  });
  it("is thin under 5 games and for no data", () => {
    expect(mainLanes(prof({ top: 3, jungle: 1 }))).toEqual({ main: "top", sub: "jungle", thin: true });
    expect(mainLanes(null)).toEqual({ main: null, sub: null, thin: true });
    expect(mainLanes(prof({}))).toEqual({ main: null, sub: null, thin: true });
  });
  it("breaks ties by lane order", () => {
    expect(mainLanes(prof({ bottom: 3, jungle: 3 })).main).toBe("jungle");
  });
});
