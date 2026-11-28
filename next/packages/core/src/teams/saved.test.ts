import { describe, expect, it } from "vitest";
import { nameLength, parseTeamRosters, ROSTERS_MAX, type SavedMatchup, type SavedRoster } from "../settings.ts";
import { balanceTeams, type BalancePlayer } from "./balance.ts";
import {
  applyRoster,
  defaultMatchupName,
  defaultRosterName,
  deleteMatchup,
  deleteRoster,
  duplicateRoster,
  findByName,
  matchupDiscordText,
  matchupFromProposal,
  missingPeopleText,
  nameProblem,
  normalizeName,
  renameMatchup,
  renameRoster,
  sameMatchup,
  upsertMatchup,
  upsertRoster,
} from "./saved.ts";

const R = (id: string, name: string, savedAt = 1, puuids = ["a", "b"]): SavedRoster => ({ id, name, puuids, savedAt });

describe("names", () => {
  it("trims, and refuses empty and over 40", () => {
    expect(normalizeName("  Friday 8 ")).toBe("Friday 8");
    expect(nameProblem("   ")).toBe("empty");
    expect(nameProblem("x".repeat(41))).toBe("long");
    expect(nameProblem(` ${"x".repeat(40)} `)).toBeNull();
  });
  it("finds a name in any case", () => {
    expect(findByName([R("1", "Friday 8")], " friday 8 ")?.id).toBe("1");
    expect(findByName([R("1", "Friday 8")], "Friday")).toBeUndefined();
  });
  it("default names", () => {
    const d = new Date(2026, 10, 28, 12).getTime();
    expect(defaultRosterName(d)).toBe("Roster 11/28");
    expect(defaultMatchupName([], d)).toBe("Matchup 11/28 #1");
    const m = { name: "Matchup 11/28 #2" } as SavedMatchup;
    expect(defaultMatchupName([m], d)).toBe("Matchup 11/28 #3");
  });
});

describe("roster list", () => {
  it("adds, overwrites by name (keeps the id) and refuses bad input", () => {
    const a = upsertRoster([], { name: " Friday 8 ", puuids: ["a", "b", "a"] }, 10, "r1");
    expect(a.item).toEqual({ id: "r1", name: "Friday 8", puuids: ["a", "b"], savedAt: 10 });
    const b = upsertRoster(a.list, { name: "FRIDAY 8", puuids: ["c"] }, 20, "other");
    expect(b.replaced).toBe(true);
    expect(b.list).toEqual([{ id: "r1", name: "FRIDAY 8", puuids: ["c"], savedAt: 20 }]);
    expect(upsertRoster(a.list, { name: " ", puuids: ["a"] }, 1).item).toBeNull();
    expect(upsertRoster(a.list, { name: "x", puuids: [] }, 1).item).toBeNull();
    expect(upsertRoster(a.list, { name: "x", puuids: Array.from({ length: 21 }, (_, i) => `p${i}`) }, 1).item).toBeNull();
  });
  it("drops the oldest beyond 50", () => {
    const list = Array.from({ length: ROSTERS_MAX }, (_, i) => R(`r${i}`, `R${i}`, i + 1));
    const r = upsertRoster(list, { name: "New", puuids: ["a"] }, 1000);
    expect(r.list).toHaveLength(ROSTERS_MAX);
    expect(r.list.some((x) => x.id === "r0")).toBe(false);
    expect(r.list.at(-1)?.name).toBe("New");
  });
  it("renames, refusing a taken or bad name; deletes", () => {
    const list = [R("1", "A"), R("2", "B")];
    expect(renameRoster(list, "1", " C ")[0]!.name).toBe("C");
    expect(renameRoster(list, "1", "b")).toEqual(list);
    expect(renameRoster(list, "1", "a")[0]!.name).toBe("a");
    expect(renameRoster(list, "1", "")).toEqual(list);
    expect(renameRoster(list, "9", "Z")).toEqual(list);
    expect(deleteRoster(list, "1").map((r) => r.id)).toEqual(["2"]);
  });
});

describe("duplicateRoster", () => {
  it("adds (copy), then (copy 2), (copy 3)", () => {
    let list = [R("1", "Friday 8", 5, ["a", "b", "c"])];
    const a = duplicateRoster(list, "1", 50, "n1");
    expect(a.item).toEqual({ id: "n1", name: "Friday 8 (copy)", puuids: ["a", "b", "c"], savedAt: 50 });
    list = a.list;
    const b = duplicateRoster(list, "1", 60, "n2");
    expect(b.item?.name).toBe("Friday 8 (copy 2)");
    const c = duplicateRoster(b.list, "n1", 70, "n3");
    expect(c.item?.name).toBe("Friday 8 (copy) (copy)");
    expect(duplicateRoster(b.list, "1", 80, "n4").item?.name).toBe("Friday 8 (copy 3)");
    expect(a.item!.puuids).not.toBe(list[0]!.puuids);
  });
  it("is case-insensitive about taken names, and refuses an unknown id", () => {
    const list = [R("1", "A"), R("2", "a (COPY)")];
    expect(duplicateRoster(list, "1", 9).item?.name).toBe("A (copy 2)");
    const none = duplicateRoster(list, "x", 9);
    expect(none.item).toBeNull();
    expect(none.list).toEqual(list);
  });
  it("cuts the base so the name stays within 40 characters", () => {
    const long = "x".repeat(40);
    const r = duplicateRoster([R("1", long)], "1", 9);
    expect(r.item!.name).toBe(`${"x".repeat(33)} (copy)`);
    expect(r.item!.name).toHaveLength(40);
    const r2 = duplicateRoster(r.list, "1", 10);
    expect(r2.item!.name).toBe(`${"x".repeat(31)} (copy 2)`);
    expect(r2.item!.name.length).toBeLessThanOrEqual(40);
  });
  it("cuts by code points, never inside an emoji (the 40 limit counts code points)", () => {
    const lone = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
    // 32 + 1 emoji + 7 = 40 code points (41 UTF-16 units); the cut for " (copy)" lands right after the emoji.
    const edge = `${"a".repeat(32)}😀${"b".repeat(7)}`;
    expect(nameProblem(edge)).toBeNull();
    const r = duplicateRoster([R("1", edge)], "1", 9);
    expect(r.item!.name).toBe(`${"a".repeat(32)}😀 (copy)`);
    expect(lone.test(r.item!.name)).toBe(false);
    expect(nameLength(r.item!.name)).toBeLessThanOrEqual(40);
    // One more letter pushes the emoji across the boundary: it goes whole, not in half.
    const over = duplicateRoster([R("1", `${"a".repeat(33)}😀${"b".repeat(6)}`)], "1", 9);
    expect(over.item!.name).toBe(`${"a".repeat(33)} (copy)`);
    expect(lone.test(over.item!.name)).toBe(false);
    // 40 emoji are a valid name and survive the settings parser; the copy is a valid name too.
    const emoji = "😀".repeat(40);
    expect(nameProblem(emoji)).toBeNull();
    expect(nameProblem("😀".repeat(41))).toBe("long");
    const e = duplicateRoster([R("1", emoji)], "1", 9);
    expect(e.item!.name).toBe(`${"😀".repeat(33)} (copy)`);
    expect(parseTeamRosters(JSON.parse(JSON.stringify(e.list))).map((x) => x.name)).toEqual([emoji, e.item!.name]);
  });
  it("over the cap the oldest go, but never the roster that was copied", () => {
    const list = Array.from({ length: ROSTERS_MAX }, (_, i) => R(`r${i}`, `R${i}`, i + 1));
    const r = duplicateRoster(list, "r5", 1000);
    expect(r.list).toHaveLength(ROSTERS_MAX);
    expect(r.list.some((x) => x.id === "r0")).toBe(false);
    expect(r.list.some((x) => x.id === "r5")).toBe(true);
    // the copied one is the oldest: it stays, the next oldest goes
    const r2 = duplicateRoster(list, "r0", 1000);
    expect(r2.list.some((x) => x.id === "r0")).toBe(true);
    expect(r2.list.some((x) => x.id === "r1")).toBe(false);
    expect(r2.list).toHaveLength(ROSTERS_MAX);
  });
});

describe("applyRoster", () => {
  const candidates = [{ puuid: "a" }, { puuid: "b" }, { puuid: "c" }];
  it("moves listed people, adds saved ones, reports the unknown", () => {
    const r = applyRoster(candidates, { puuids: ["a", "c", "s", "u"] }, { a: 1, b: 1, c: 1, s: 1 });
    expect(r.moved).toEqual({ a: "in", b: "out", c: "in", s: "in" });
    expect(r.extras).toEqual(["s"]);
    expect(r.missing).toEqual(["u"]);
  });
  it("the three cases alone", () => {
    expect(applyRoster(candidates, { puuids: ["b"] }, {})).toEqual({ moved: { a: "out", b: "in", c: "out" }, extras: [], missing: [] });
    expect(applyRoster([], { puuids: ["x"] }, { x: 1 })).toEqual({ moved: { x: "in" }, extras: ["x"], missing: [] });
    expect(applyRoster([], { puuids: ["x"] }, {})).toEqual({ moved: {}, extras: [], missing: ["x"] });
  });
  it("does not treat prototype names as saved people", () => {
    expect(applyRoster([], { puuids: ["toString"] }, {}).missing).toEqual(["toString"]);
  });
  it("words the toast", () => {
    expect(missingPeopleText("Friday 8", 2)).toBe('2 people in "Friday 8" are not in People. Add them from People › Add.');
    expect(missingPeopleText("X", 1)).toBe('1 person in "X" is not in People. Add them from People › Add.');
  });
});

const players = (n: number): BalancePlayer[] => Array.from({ length: n }, (_, i) => ({ puuid: `p${i}`, points: 1000 + i * 90, lock: null, mains: [], subs: [], ng: [] }));
const info = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i}`, { name: { gameName: `Name${i}`, tagLine: `t${i}` }, rank: { label: `G${i}`, points: 1000 + i * 90 }}]));

describe("matchups", () => {
  const p = balanceTeams(players(10)).rankFirst[0]!;
  it("matchupFromProposal keeps slots, labels and the view", () => {
    const m = matchupFromProposal(p, info(10), "laneFirst", "  My split ", 7);
    expect(m).toMatchObject({ name: "My split", savedAt: 7, priority: "laneFirst" });
    expect(m.blue).toEqual(p.blue);
    expect(m.people.p3).toEqual({ gameName: "Name3", tagLine: "t3", rankLabel: "G3", points: 1270 });
    expect(matchupFromProposal(p, {}, "rankFirst", "x", 1).people.p0).toEqual({ gameName: "?", tagLine: "", rankLabel: "—" });
  });
  it("upsert, overwrite, rename, delete, cap", () => {
    const m = matchupFromProposal(p, info(10), "rankFirst", "A", 1);
    const a = upsertMatchup([], m, 5, "m1");
    expect(a.item).toMatchObject({ id: "m1", name: "A", savedAt: 5 });
    const b = upsertMatchup(a.list, { ...m, name: "a" }, 9, "zzz");
    expect(b.list).toHaveLength(1);
    expect(b.list[0]).toMatchObject({ id: "m1", name: "a", savedAt: 9 });
    expect(upsertMatchup(a.list, { ...m, name: "" }, 1).item).toBeNull();
    expect(upsertMatchup(a.list, { ...m, blue: m.blue.slice(0, 2), red: m.red.slice(0, 2) }, 1).item).toBeNull();
    const c = upsertMatchup(b.list, { ...m, name: "B" }, 10, "m2");
    expect(renameMatchup(c.list, "m2", "a")).toEqual(c.list);
    expect(renameMatchup(c.list, "m2", "C")[1]!.name).toBe("C");
    expect(deleteMatchup(c.list, "m1").map((x) => x.id)).toEqual(["m2"]);
    let list: SavedMatchup[] = [];
    for (let i = 0; i < 101; i++) list = upsertMatchup(list, { ...m, name: `M${i}` }, i + 1).list;
    expect(list).toHaveLength(100);
    expect(list.some((x) => x.name === "M0")).toBe(false);
  });
  it("sameMatchup ignores swapped sides and order, and sees other people or lanes", () => {
    const sw = { blue: [...p.red].reverse(), red: [...p.blue].reverse() };
    expect(sameMatchup(p, sw)).toBe(true);
    expect(sameMatchup(p, { blue: p.blue, red: p.red })).toBe(true);
    const lanes = { blue: p.blue.map((s, i) => ({ ...s, lane: p.blue[(i + 1) % 5]!.lane })), red: p.red };
    expect(sameMatchup(p, lanes)).toBe(false);
    const swapped = { blue: [{ ...p.blue[0]!, puuid: p.red[0]!.puuid }, ...p.blue.slice(1)], red: [{ ...p.red[0]!, puuid: p.blue[0]!.puuid }, ...p.red.slice(1)] };
    expect(sameMatchup(p, swapped)).toBe(false);
  });
  it("matchupDiscordText uses the saved name and labels", () => {
    const m = { ...matchupFromProposal(p, info(10), "rankFirst", "Friday 5v5", 1), id: "x" };
    const t = matchupDiscordText(m);
    expect(t).toContain("**Friday 5v5**");
    expect(t).toContain("Name3");
    expect(t).toContain("G3");
    expect(t).toContain("ランク差");
    expect(matchupDiscordText(m, { withRank: false })).not.toContain("G3");
  });
});
