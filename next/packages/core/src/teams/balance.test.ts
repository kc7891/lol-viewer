import { describe, expect, it } from "vitest";
import { LANES, type Lane } from "@lol-viewer/protocol";
import { balanceTeams, scoreProposal, type BalancePlayer, type Proposal } from "./balance.ts";

const P = (puuid: string, points: number | null, o: Partial<BalancePlayer> = {}): BalancePlayer => ({ puuid, points, lock: null, mains: [], subs: [], ng: [], ...o });
const group = (n: number, points: number | null = 1000, o: Partial<BalancePlayer> = {}) => Array.from({ length: n }, (_, i) => P(`p${i}`, points, o));
/** One main per lane, two players each. */
const pairs = (topA: number): BalancePlayer[] =>
  LANES.flatMap((l, i) => [P(`a${i}`, i === 0 ? topA : 1000, { mains: [l] }), P(`b${i}`, i === 0 ? 0 : 1000, { mains: [l] })]);
const ids = (p: Proposal) => [p.blue.map((s) => s.puuid).sort(), p.red.map((s) => s.puuid).sort()];
const laneOfId = (p: Proposal, id: string): Lane | null => [...p.blue, ...p.red].find((s) => s.puuid === id)!.lane;

describe("balanceTeams: counts", () => {
  it("only accepts 6, 8 and 10 players", () => {
    for (const n of [0, 1, 4, 5, 7, 9, 11, 12]) expect(balanceTeams(group(n)).error).toBe("count");
    for (const n of [6, 8, 10]) expect(balanceTeams(group(n)).error).toBeNull();
  });
  it("rejects repeated PUUIDs", () => {
    expect(balanceTeams([...group(9), P("p0", 1)]).error).toBe("count");
  });
  it("makes 126, 35 and 10 splits", () => {
    expect(balanceTeams(group(10)).rankFirst).toHaveLength(126);
    expect(balanceTeams(group(8)).laneFirst).toHaveLength(35);
    expect(balanceTeams(group(6)).rankFirst).toHaveLength(10);
  });
});

describe("balanceTeams: 10 players", () => {
  it("gives every team the 5 lanes once and sorts best first", () => {
    const r = balanceTeams(group(10).map((p, i) => ({ ...p, points: 800 + i * 70, mains: [LANES[i % 5]!] })));
    for (const view of [r.rankFirst, r.laneFirst]) {
      for (const p of view) {
        expect(p.blue.map((s) => s.lane)).toEqual([...LANES]);
        expect(p.red.map((s) => s.lane)).toEqual([...LANES]);
      }
      expect(view.map((p) => p.score)).toEqual([...view.map((p) => p.score)].sort((a, b) => a - b));
    }
  });
  it("finds the most even split", () => {
    const pts = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    const r = balanceTeams(pts.map((p, i) => P(`p${i}`, p)));
    expect(r.rankFirst[0]!.rankDiff).toBe(20); // 5500 in total cannot be halved in steps of 100: 2700 vs 2800
    expect(r.rankFirst[0]!.unknownRanks).toBe(0);
  });
  it("puts people on their main lane and reports the matchup gap", () => {
    const players = [
      ...LANES.map((l, i) => P(`a${i}`, 1000 + i * 10, { mains: [l] })),
      ...LANES.map((l, i) => P(`b${i}`, 1000 + i * 10 + 20, { mains: [l] })),
    ];
    const best = balanceTeams(players).laneFirst[0]!;
    for (const p of players) expect(laneOfId(best, p.puuid)).toBe(p.mains[0]);
    expect(best.maxMatchupDiff).toBe(20);
    expect(best.brokenNg).toBe(0);
  });
  it("always keeps a lock", () => {
    const players = group(10).map((p, i) => (i === 0 ? { ...p, lock: "jungle" as const } : i === 1 ? { ...p, lock: "jungle" as const } : p));
    const r = balanceTeams(players);
    expect(r.error).toBeNull();
    for (const p of [...r.rankFirst, ...r.laneFirst]) {
      expect(laneOfId(p, "p0")).toBe("jungle");
      expect(laneOfId(p, "p1")).toBe("jungle");
      expect(ids(p)[0]!.includes("p0")).not.toBe(ids(p)[0]!.includes("p1")); // two locks on one lane: different teams
    }
  });
  it("says locks when 3 people are locked to one lane", () => {
    const r = balanceTeams(group(10).map((p, i) => (i < 3 ? { ...p, lock: "top" as const } : p)));
    expect(r).toEqual({ rankFirst: [], laneFirst: [], error: "locks" });
  });
  it("breaks an NG lane only when it cannot be avoided", () => {
    const ng: Lane[] = ["support"];
    const easy = balanceTeams(group(10).map((p, i) => (i === 0 ? { ...p, ng } : p)));
    expect(easy.rankFirst.every((p) => p.brokenNg === 0)).toBe(true);
    const onlyJungle = LANES.filter((l) => l !== "jungle");
    const hard = balanceTeams(group(10).map((p, i) => (i < 3 ? { ...p, ng: onlyJungle } : p)));
    expect(hard.rankFirst.every((p) => p.brokenNg >= 1)).toBe(true);
    expect(hard.rankFirst[0]!.brokenNg).toBe(1);
  });
  it("uses the average of the known ranks for unknown ones and counts them", () => {
    const players = [...group(9, 1000), P("x", null)];
    const r = balanceTeams(players);
    expect(r.rankFirst[0]!.rankDiff).toBe(0);
    expect(r.rankFirst.every((p) => p.unknownRanks === 1)).toBe(true);
    expect(balanceTeams(group(10, null)).rankFirst[0]!.unknownRanks).toBe(10);
  });
  it("gives different best proposals for the two views", () => {
    const r = balanceTeams(pairs(2000));
    expect(ids(r.rankFirst[0]!)).not.toEqual(ids(r.laneFirst[0]!));
    expect(r.rankFirst[0]!.rankDiff).toBeLessThan(r.laneFirst[0]!.rankDiff);
    expect(r.rankFirst[0]!.rankDiff).toBe(0);
  });
  it("does not depend on the input order, and breaks ties by PUUID", () => {
    const players = group(10);
    const a = balanceTeams(players);
    const b = balanceTeams([...players].reverse());
    expect(b).toEqual(a);
    expect(a.rankFirst[0]!.blue.map((s) => s.puuid)).toContain("p0");
  });
});

describe("balanceTeams: 6 and 8 players", () => {
  it("assigns no lanes and has no matchup gap", () => {
    for (const n of [6, 8]) {
      const best = balanceTeams(group(n)).rankFirst[0]!;
      expect([...best.blue, ...best.red].every((s) => s.lane === null)).toBe(true);
      expect(best.maxMatchupDiff).toBeNull();
      expect(best.blue).toHaveLength(n / 2);
    }
  });
  it("separates people with the same main lane", () => {
    const mains: Lane[] = ["top", "top", "jungle", "jungle", "middle", "middle"];
    const players = mains.map((l, i) => P(`p${i}`, 1000, { mains: [l] }));
    for (const view of ["rankFirst", "laneFirst"] as const) {
      const best = balanceTeams(players)[view][0]!;
      for (const team of [best.blue, best.red]) {
        const m = team.map((s) => mains[Number(s.puuid.slice(1))]);
        expect(new Set(m).size).toBe(3);
      }
    }
  });
  it("keeps two people locked to the same lane apart", () => {
    const players = group(6).map((p, i) => (i < 2 ? { ...p, lock: "top" as const } : p));
    for (const p of balanceTeams(players).rankFirst) expect(p.blue.some((s) => s.puuid === "p0")).not.toBe(p.blue.some((s) => s.puuid === "p1"));
  });
});

describe("scoreProposal", () => {
  const players = pairs(2000);
  it("gives the proposal's own score back", () => {
    const r = balanceTeams(players);
    for (const view of ["rankFirst", "laneFirst"] as const) {
      const p = r[view][3]!;
      const again = scoreProposal({ blue: p.blue, red: p.red }, players, view);
      expect(again.score).toBeCloseTo(p.score, 6);
      expect(again.rankDiff).toBeCloseTo(p.rankDiff, 6);
      expect(again.maxMatchupDiff).toBe(p.maxMatchupDiff);
    }
  });
  it("scores a swap again", () => {
    const best = balanceTeams(players).laneFirst[0]!;
    const blue = best.blue.map((s) => ({ ...s }));
    const red = best.red.map((s) => ({ ...s }));
    [blue[1]!.puuid, red[1]!.puuid] = [red[1]!.puuid, blue[1]!.puuid]; // same lane, same rank: nothing changes
    expect(scoreProposal({ blue, red }, players, "laneFirst").score).toBeCloseTo(best.score, 6);
    [blue[0]!.puuid, red[0]!.puuid] = [red[0]!.puuid, blue[0]!.puuid]; // swap the top laners: rank gap flips
    const swapped = scoreProposal({ blue, red }, players, "laneFirst");
    expect(swapped.rankDiff).toBeCloseTo(best.rankDiff, 6);
    const off = blue.map((s) => ({ ...s }));
    [off[0]!.lane, off[1]!.lane] = [off[1]!.lane, off[0]!.lane]; // both off their main lane
    expect(scoreProposal({ blue: off, red }, players, "laneFirst").score).toBeGreaterThan(swapped.score);
  });
  it("counts a broken lock, an NG lane and unknown ranks", () => {
    const ps = [P("a", 1000, { lock: "top" }), P("b", null, { ng: ["jungle"] })];
    const out = scoreProposal({ blue: [{ puuid: "a", lane: "jungle" }], red: [{ puuid: "b", lane: "jungle" }] }, ps, "rankFirst");
    expect(out.score).toBeGreaterThanOrEqual(300);
    expect(out.brokenNg).toBe(1);
    expect(out.unknownRanks).toBe(1);
  });
});
