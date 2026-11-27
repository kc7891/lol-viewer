import { describe, expect, it } from "vitest";
import type { TeamPlayer } from "@lol-viewer/protocol";
import { ageLabel, balancePlayerOf, candidatesOf, entryText, lanesOf, membershipOf, overLockedLane, overridePoints, rankDetails, remainingText, tierOfPoints, toggleLane, withPref } from "./model.ts";

const NOW = 1_700_000_000_000;
const counts = (o: Partial<Record<"top" | "jungle" | "middle" | "bottom" | "support", number>>) => ({ top: 0, jungle: 0, middle: 0, bottom: 0, support: 0, ...o });
const player = (over: Partial<TeamPlayer> = {}): TeamPlayer => ({
  puuid: "p", gameName: "A", tagLine: "1", nameSeenAt: NOW, previousNames: [], error: null, estimate: null,
  rank: { solo: { tier: "GOLD", division: "II", lp: 40, points: 1440 }, flex: null, prevSeason: null, fetchedAt: NOW },
  lanes: { counts: counts({ jungle: 8, top: 4 }), games: 12, fetchedAt: NOW },
  ...over,
});

describe("who is listed and who plays", () => {
  const lobby = { team100: ["a", "b"], team200: ["c"], spectators: ["d", "a"] };
  it("lists team slots, spectators, then the added people, each once", () => {
    expect(candidatesOf(lobby, ["e", "c", "f"]).map((c) => [c.puuid, c.origin])).toEqual([
      ["a", "team"], ["b", "team"], ["c", "team"], ["d", "spectator"], ["e", "added"], ["f", "added"],
    ]);
    expect(candidatesOf(null, ["x"])).toEqual([{ puuid: "x", origin: "added" }]);
    expect(candidatesOf(null, [])).toEqual([]);
  });
  it("team slots and added people play, spectators sit out, a move overrides", () => {
    const [a, , , d, e] = candidatesOf(lobby, ["e"]);
    expect([a!, d!, e!].map((c) => membershipOf(c, {}))).toEqual(["in", "out", "in"]);
    expect(membershipOf(d!, { d: "in" })).toBe("in");
    expect(membershipOf(a!, { a: "out" })).toBe("out");
  });
});

describe("lanes and what the balancer gets", () => {
  it("uses the counted lanes, and a manual choice replaces them", () => {
    expect(lanesOf(player(), undefined)).toMatchObject({ mains: ["jungle"], subs: ["top"], manual: false, thin: false });
    expect(lanesOf(player(), { mains: ["support", "top"] })).toEqual({ mains: ["support", "top"], subs: [], thin: false, manual: true });
    expect(lanesOf(undefined, undefined)).toMatchObject({ mains: [], thin: true });
  });
  it("builds a BalancePlayer: manual rank, lock and NG lanes included", () => {
    expect(balancePlayerOf("p", player(), undefined, NOW)).toEqual({ puuid: "p", points: 1440, lock: null, mains: ["jungle"], subs: ["top"], ng: [], thin: false });
    expect(balancePlayerOf("p", player(), { lock: "top", ng: ["support"], rankOverride: 2000 }, NOW)).toMatchObject({ points: 2000, lock: "top", ng: ["support"] });
    expect(balancePlayerOf("p", undefined, undefined, NOW)).toMatchObject({ points: null, mains: [], thin: true });
    // Data older than two weeks is not used.
    const old = player({ rank: { solo: { tier: "GOLD", division: "II", lp: 0, points: 1400 }, flex: null, prevSeason: null, fetchedAt: NOW - 20 * 86_400_000 } });
    expect(balancePlayerOf("p", old, undefined, NOW).points).toBeNull();
  });
  it("finds a lane with three locks", () => {
    const l = (lock: "top" | "jungle" | null) => ({ puuid: String(Math.random()), points: 0, lock, mains: [], subs: [], ng: [] });
    expect(overLockedLane([l("jungle"), l("jungle"), l("top")])).toBeNull();
    expect(overLockedLane([l("jungle"), l("jungle"), l("jungle")])).toBe("jungle");
  });
});

describe("per-player settings", () => {
  it("adds, merges and removes empty entries", () => {
    let prefs = withPref({}, "a", { lock: "jungle" });
    expect(prefs).toEqual({ a: { lock: "jungle" } });
    prefs = withPref(prefs, "a", { ng: ["support"], rankOverride: 1200 });
    expect(prefs.a).toEqual({ lock: "jungle", ng: ["support"], rankOverride: 1200 });
    prefs = withPref(prefs, "a", { lock: undefined, ng: [], rankOverride: undefined });
    expect(prefs).toEqual({});
    expect(withPref({ b: { lock: "top" } }, "a", {})).toEqual({ b: { lock: "top" } });
  });
  it("toggles lanes; with a limit the oldest goes", () => {
    expect(toggleLane(undefined, "top", 2)).toEqual(["top"]);
    expect(toggleLane(["top", "jungle"], "middle", 2)).toEqual(["jungle", "middle"]);
    expect(toggleLane(["top", "jungle"], "top", 2)).toEqual(["jungle"]);
  });
  it("turns points into a tier and back", () => {
    expect(tierOfPoints(1440)).toEqual({ tier: "GOLD", division: "II", lp: 0 });
    expect(tierOfPoints(0)).toEqual({ tier: "IRON", division: "IV", lp: 0 });
    expect(tierOfPoints(2399)).toEqual({ tier: "EMERALD", division: "I", lp: 0 });
    expect(tierOfPoints(2999)).toEqual({ tier: "MASTER", division: "IV", lp: 199 });
    expect(overridePoints("GOLD", "II", 50)).toBe(1400);
    expect(overridePoints("MASTER", "IV", 120)).toBe(2920);
    expect(overridePoints("NOPE", "II", 0)).toBeNull();
  });
});

describe("wording", () => {
  it("ages", () => {
    expect(ageLabel(NOW - 5_000, NOW)).toBe("just now");
    expect(ageLabel(NOW - 5 * 60_000, NOW)).toBe("5 min ago");
    expect(ageLabel(NOW - 3 * 3_600_000, NOW)).toBe("3 h ago");
    expect(ageLabel(NOW - 86_400_000, NOW)).toBe("1 day ago");
    expect(ageLabel(NOW - 9 * 86_400_000, NOW)).toBe("9 days ago");
  });
  it("rank entries", () => {
    expect(entryText({ tier: "GOLD", division: "II", lp: 40, points: 1440 })).toBe("Gold II 40 LP");
    expect(entryText({ tier: "MASTER", division: "NA", lp: 120, points: 2920 })).toBe("Master 120 LP");
    expect(entryText(null)).toBe("Unranked");
  });
  it("tells where the rank came from", () => {
    const lines = rankDetails(player({ estimate: { points: 1300, samples: 22, games: 8, min: 800, max: 2000, perGame: [], fetchedAt: NOW } }), { points: 1440, source: "solo" }, NOW);
    expect(lines).toEqual(["Solo/Duo: Gold II 40 LP", "Flex: Unranked", "Fetched just now", "Estimate: G3 from 22 players in 8 games"]);
    expect(rankDetails(undefined, null, NOW)).toEqual(["Not fetched yet"]);
    expect(rankDetails(player({ rank: null, error: "Not found" }), null, NOW)).toEqual(["Problem: Not found"]);
  });
  it("estimates the time left from the time spent", () => {
    expect(remainingText(0, 10, 5000)).toBeNull();
    expect(remainingText(10, 10, 5000)).toBeNull();
    expect(remainingText(12, 30, 12 * 10_000)).toBe("~3 min");
    expect(remainingText(5, 6, 1000)).toBe("<1 min");
  });
});
