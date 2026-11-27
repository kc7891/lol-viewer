import { describe, expect, it } from "vitest";
import type { PlayerRank, RankEstimate } from "@lol-viewer/protocol";
import { effectiveRank, parseRankedStats, rankLabel, rankPoints } from "./rank.ts";

const NOW = 1_000_000_000_000;
const DAY = 86_400_000;
const entry = (points: number) => ({ tier: "GOLD", division: "II", lp: 0, points });
const rank = (o: Partial<PlayerRank> = {}): PlayerRank => ({ solo: null, flex: null, prevSeason: null, fetchedAt: NOW, ...o });
const est = (points: number | null, fetchedAt = NOW): RankEstimate => ({ points, samples: 20, games: 5, min: 0, max: 0, perGame: [], fetchedAt });

describe("rankPoints", () => {
  it("adds tier, division and LP (LP capped at 100 below Master)", () => {
    expect(rankPoints("IRON", "IV", 0)).toBe(0);
    expect(rankPoints("GOLD", "II", 40)).toBe(1440);
    expect(rankPoints("DIAMOND", "I", 100)).toBe(2800);
    expect(rankPoints("SILVER", "I", 250)).toBe(800 + 300 + 100);
  });
  it("puts Master and above on 2800 + LP", () => {
    expect(rankPoints("MASTER", "NA", 120)).toBe(2920);
    expect(rankPoints("CHALLENGER", "I", 900)).toBe(3700);
  });
  it("is null for unknown tiers or divisions", () => {
    expect(rankPoints("WOOD", "I", 0)).toBeNull();
    expect(rankPoints("GOLD", "NA", 0)).toBeNull();
  });
});

describe("parseRankedStats", () => {
  const body = {
    queueMap: {
      RANKED_SOLO_5x5: { tier: "GOLD", division: "II", leaguePoints: 40, isProvisional: false, previousSeasonEndTier: "SILVER", previousSeasonEndDivision: "I" },
      RANKED_FLEX_SR: { tier: "PLATINUM", division: "IV", leaguePoints: 7, isProvisional: false },
    },
  };
  it("reads solo, flex and the previous season", () => {
    expect(parseRankedStats(body)).toEqual({
      solo: { tier: "GOLD", division: "II", lp: 40, points: 1440 },
      flex: { tier: "PLATINUM", division: "IV", lp: 7, points: 1607 },
      prevSeason: { tier: "SILVER", division: "I", lp: 0, points: 1100 },
    });
  });
  it("treats empty and NONE tiers, NA divisions and provisional entries as absent", () => {
    const b = {
      queueMap: {
        RANKED_SOLO_5x5: { tier: "", division: "NA", leaguePoints: 0, previousSeasonEndTier: "NONE", previousSeasonEndDivision: "NA" },
        RANKED_FLEX_SR: { tier: "GOLD", division: "III", leaguePoints: 10, isProvisional: true },
      },
    };
    expect(parseRankedStats(b)).toEqual({ solo: null, flex: null, prevSeason: null });
    expect(parseRankedStats({ queueMap: { RANKED_SOLO_5x5: { tier: "NONE", division: "NA" } } }).solo).toBeNull();
  });
  it("survives garbage", () => {
    for (const x of [null, undefined, 5, "x", [], {}, { queueMap: [] }, { queueMap: { RANKED_SOLO_5x5: 3 } }]) {
      expect(parseRankedStats(x)).toEqual({ solo: null, flex: null, prevSeason: null });
    }
  });
  it("keeps Master+ as a tier with LP", () => {
    expect(parseRankedStats({ queueMap: { RANKED_SOLO_5x5: { tier: "MASTER", division: "I", leaguePoints: 120 } } }).solo).toEqual({
      tier: "MASTER",
      division: "NA",
      lp: 120,
      points: 2920,
    });
  });
});

describe("effectiveRank", () => {
  it("prefers manual, then solo, flex, estimate, previous season", () => {
    const full = { rank: rank({ solo: entry(1400), flex: entry(1300), prevSeason: entry(1000) }), estimate: est(1200) };
    expect(effectiveRank(full, { rankOverride: 2000 }, NOW)).toEqual({ points: 2000, source: "manual" });
    expect(effectiveRank(full, {}, NOW)).toEqual({ points: 1400, source: "solo" });
    expect(effectiveRank({ ...full, rank: rank({ flex: entry(1300), prevSeason: entry(1000) }) }, undefined, NOW)).toEqual({ points: 1300, source: "flex" });
    expect(effectiveRank({ ...full, rank: rank({ prevSeason: entry(1000) }) }, undefined, NOW)).toEqual({ points: 1200, source: "estimate" });
    expect(effectiveRank({ rank: rank({ prevSeason: entry(1000) }), estimate: est(null) }, undefined, NOW)).toEqual({ points: 1000, source: "prev" });
    expect(effectiveRank({ rank: rank(), estimate: null }, undefined, NOW)).toBeNull();
    expect(effectiveRank(null, undefined, NOW)).toBeNull();
  });
  it("does not use data older than 14 days, but uses stale data", () => {
    expect(effectiveRank({ rank: rank({ solo: entry(1400), fetchedAt: NOW - 10 * DAY }), estimate: null }, undefined, NOW)?.source).toBe("solo");
    expect(effectiveRank({ rank: rank({ solo: entry(1400), fetchedAt: NOW - 15 * DAY }), estimate: est(900) }, undefined, NOW)).toEqual({ points: 900, source: "estimate" });
    expect(effectiveRank({ rank: null, estimate: est(900, NOW - 20 * DAY) }, undefined, NOW)).toBeNull();
  });
});

describe("rankLabel", () => {
  it("labels tiers and divisions", () => {
    expect(rankLabel(1400, "solo")).toBe("G2");
    expect(rankLabel(0, "solo")).toBe("I4");
    expect(rankLabel(399, "solo")).toBe("I1");
    expect(rankLabel(1607, "solo")).toBe("P4");
    expect(rankLabel(2799, "solo")).toBe("D1");
  });
  it("marks the source", () => {
    expect(rankLabel(1400, "flex")).toBe("G2 (Flex)");
    expect(rankLabel(1300, "estimate")).toBe("~G3");
    expect(rankLabel(1100, "prev")).toBe("S1 (prev)");
    expect(rankLabel(1400, "manual")).toBe("G2");
  });
  it("shows LP from Master", () => {
    expect(rankLabel(2920, "solo")).toBe("M 120LP");
    expect(rankLabel(2800, "estimate")).toBe("~M 0LP");
  });
});
