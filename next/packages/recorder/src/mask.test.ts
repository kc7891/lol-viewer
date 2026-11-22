import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createMasker, findUnmaskedPii, isPiiKey } from "./mask.ts";

describe("createMasker", () => {
  const raw = {
    gameId: 1001,
    localPlayerCellId: 2,
    myTeam: [
      { cellId: 0, championId: 122, assignedPosition: "top", summonerId: 98765, puuid: "abc-123", gameName: "Faker", tagLine: "KR1" },
      { cellId: 1, championId: 64, assignedPosition: "jungle", summonerId: 0, puuid: "", gameName: "", tagLine: "" },
    ],
    gameData: { teamOne: [{ summonerId: 98765, summonerName: "Faker", championId: 122, profileIconId: 4567 }] },
  };

  it("replaces identities with pseudonyms and keeps game data", () => {
    const m = createMasker()(raw);
    expect(m.myTeam[0]).toMatchObject({ cellId: 0, championId: 122, assignedPosition: "top" });
    expect(m.myTeam[0]!.gameName).toMatch(/^player-\d+$/);
    expect(m.myTeam[0]!.tagLine).toMatch(/^tag-\d+$/);
    expect(m.myTeam[0]!.summonerId).toBeGreaterThanOrEqual(1_000_000);
    expect(m.myTeam[0]!.puuid).toMatch(/^player-\d+$/);
    expect(JSON.stringify(m)).not.toContain("Faker");
    expect(JSON.stringify(m)).not.toContain("abc-123");
    expect(m.gameId).toBe(1001);
  });

  it("keeps pseudonyms stable inside one recording (relationships survive)", () => {
    const m = createMasker()(raw);
    expect(m.gameData.teamOne[0]!.summonerId).toBe(m.myTeam[0]!.summonerId);
  });

  it("leaves empty markers alone", () => {
    const m = createMasker()(raw);
    expect(m.myTeam[1]).toMatchObject({ summonerId: 0, puuid: "", gameName: "", tagLine: "" });
  });

  it("does not mutate its input", () => {
    const copy = structuredClone(raw);
    createMasker()(raw);
    expect(raw).toEqual(copy);
  });
});

describe("findUnmaskedPii", () => {
  it("flags raw identities and accepts masked output", () => {
    expect(findUnmaskedPii({ a: [{ puuid: "abc" }], riotId: "Faker#KR1" })).toEqual(["$.a[0].puuid", "$.riotId"]);
    expect(findUnmaskedPii(createMasker()({ a: [{ puuid: "abc" }], riotId: "Faker#KR1" }))).toEqual([]);
  });

  it("knows the identity keys used by LCU and the Live Client API", () => {
    for (const k of ["puuid", "summonerId", "summonerName", "gameName", "tagLine", "riotId", "riotIdGameName", "riotIdTagLine", "profileIconId"]) {
      expect(isPiiKey(k), k).toBe(true);
    }
    for (const k of ["championId", "championName", "cellId", "assignedPosition", "gameId"]) expect(isPiiKey(k), k).toBe(false);
  });
});

describe("committed scenarios", () => {
  const dir = new URL("../../../scenarios/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));

  it.each(files)("%s contains no unmasked personal data", (f) => {
    const lines = readFileSync(new URL(f, dir), "utf8")
      .split("\n")
      .filter((l) => l.trim() && !l.startsWith("//"));
    const leaks = lines.flatMap((l, i) => findUnmaskedPii(JSON.parse(l)).map((p) => `line ${i + 1}: ${p}`));
    expect(leaks).toEqual([]);
  });
});
