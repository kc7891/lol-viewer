import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { LivePlayerFact } from "@lol-viewer/protocol";
import {
  buildLivePlayers,
  championIdFromLive,
  formatGoldDiff,
  formatLevelDiff,
  goldTrend,
  hasSmite,
  itemGold,
  itemValue,
  normalizeLivePlayer,
  resolveMyTeam,
} from "./live.ts";

describe("itemValue / itemGold (M-026)", () => {
  it("counts gold.total x count; consumed items and trinkets are 0", () => {
    expect(itemValue({ itemID: 3031 })).toBe(3500);
    expect(itemValue({ itemID: 2003, count: 3 })).toBe(0);
    expect(itemValue({ itemID: 2055 })).toBe(0);
    expect(itemValue({ itemID: 3340 })).toBe(0);
    expect(itemValue({ itemID: 2031 })).toBe(150);
    expect(itemValue({ itemID: 1001, count: 2 })).toBe(600);
  });
  it("never uses price for known ids; falls back to price for unknown ids", () => {
    expect(itemValue({ itemID: 3031, price: 725 })).toBe(3500);
    expect(itemValue({ itemID: 999999, price: 100, count: 2 })).toBe(200);
    expect(itemValue({ itemID: 999999, price: 100, consumable: true })).toBe(0);
    expect(itemValue({ itemID: 999999, price: 100 })).toBe(100);
  });
  it("sums", () => {
    expect(itemGold([{ itemID: 3031 }, { itemID: 1001, count: 2 }, { itemID: 2003 }])).toBe(4100);
  });
});

describe("championIdFromLive", () => {
  it("reads the Data Dragon id, then English / Japanese / loose names", () => {
    expect(championIdFromLive({ rawChampionName: "game_character_displayname_MonkeyKing" })).toBe(62);
    expect(championIdFromLive({ championName: "ウーコン" })).toBe(62);
    expect(championIdFromLive({ championName: "Kai'Sa" })).toBe(145);
    expect(championIdFromLive({ championName: "kaisa" })).toBe(145);
    expect(championIdFromLive({})).toBeNull();
    expect(championIdFromLive({ championName: "Nobody" })).toBeNull();
  });
});

describe("hasSmite", () => {
  const spell = (rawDescription: string) => ({ rawDescription });
  it("finds Smite in either slot", () => {
    const smite = spell("GeneratedTip_SummonerSpell_SummonerSmite_Description");
    expect(hasSmite({ summonerSpells: { summonerSpellOne: spell("x"), summonerSpellTwo: smite } })).toBe(true);
    expect(hasSmite({ summonerSpells: { summonerSpellOne: { displayName: "スマイト" } } })).toBe(true);
    expect(hasSmite({ summonerSpells: { summonerSpellOne: spell("GeneratedTip_SummonerSpell_SummonerFlash_Description") } })).toBe(false);
    expect(hasSmite({})).toBe(false);
  });
});

describe("normalizeLivePlayer", () => {
  const base = { rawChampionName: "game_character_displayname_Ahri", team: "ORDER", level: 3 };
  const smite = { summonerSpellOne: { rawDescription: "GeneratedTip_SummonerSpell_SummonerSmite_Description" } };
  it("lane from position, else Smite, position first", () => {
    expect(normalizeLivePlayer({ ...base, position: "UTILITY" })?.lane).toBe("support");
    expect(normalizeLivePlayer({ ...base, position: "MIDDLE" })?.lane).toBe("middle");
    expect(normalizeLivePlayer({ ...base, position: "", summonerSpells: smite })?.lane).toBe("jungle");
    expect(normalizeLivePlayer({ ...base, position: "" })?.lane).toBeNull();
    expect(normalizeLivePlayer({ ...base, position: "TOP", summonerSpells: smite })?.lane).toBe("top");
  });
  it("drops unknown teams and champions", () => {
    expect(normalizeLivePlayer({ ...base, team: "NEUTRAL" })).toBeNull();
    expect(normalizeLivePlayer({ ...base, rawChampionName: "game_character_displayname_Nope" })).toBeNull();
  });
  it("leaves no name in the result", () => {
    const r = normalizeLivePlayer({ ...base, riotId: "Secret#JP1", summonerName: "Secret#JP1", championName: "Ahri" });
    expect(JSON.stringify(r)).not.toContain("Secret");
    expect(r).toEqual({ championId: 103, team: "ORDER", lane: null, level: 3, itemGold: 0 });
  });
});

const f = (championId: number, team: "ORDER" | "CHAOS"): LivePlayerFact => ({ championId, team, lane: null, level: 1, itemGold: 0 });
describe("resolveMyTeam / buildLivePlayers (M-029)", () => {
  const players = [f(1, "ORDER"), f(2, "ORDER"), f(3, "CHAOS"), f(4, "CHAOS")];
  const m = (self: number | null, allies: number[], enemies: number[]) => ({
    self: self ? { championId: self, lane: null } : null,
    allies: allies.map((championId) => ({ championId, lane: null })),
    enemies,
  });
  it("uses my champion when only one team has it", () => {
    expect(resolveMyTeam(players, m(3, [], []))).toBe("CHAOS");
  });
  it("mirror or no self: falls back to ally / enemy overlap", () => {
    expect(resolveMyTeam([f(1, "ORDER"), f(1, "CHAOS"), f(2, "ORDER"), f(3, "CHAOS")], m(1, [2], [3]))).toBe("ORDER");
    expect(resolveMyTeam(players, m(null, [1], [3]))).toBe("ORDER");
    expect(resolveMyTeam(players, m(null, [], []))).toBeNull();
    expect(resolveMyTeam(players, m(null, [1], [2]))).toBeNull();
  });
  it("builds ally / enemy lists; rejects odd shapes", () => {
    expect(buildLivePlayers(players, m(3, [], []))?.map((p) => p.team)).toEqual(["enemy", "enemy", "ally", "ally"]);
    expect(buildLivePlayers([], m(3, [], []))).toBeNull();
    const six = Array.from({ length: 6 }, (_, i) => f(i + 1, "ORDER"));
    expect(buildLivePlayers(six, m(1, [], []))).toBeNull();
  });
});

describe("formatting (§5.7)", () => {
  it.each([
    [0, "0"], [49, "0"], [50, "+50"], [-150, "-150"], [999, "+999"], [1000, "+1.0k"], [1400, "+1.4k"],
    [-12345, "-12k"], [9949, "+9.9k"], [9950, "+10k"],
  ])("formatGoldDiff(%s) = %s", (d, s) => expect(formatGoldDiff(d)).toBe(s));
  it("trend and level", () => {
    expect(goldTrend(49)).toBe("even");
    expect(goldTrend(50)).toBe("ahead");
    expect(goldTrend(-50)).toBe("behind");
    expect(formatLevelDiff(1)).toBe("Lv+1");
    expect(formatLevelDiff(-2)).toBe("Lv-2");
    expect(formatLevelDiff(0)).toBeNull();
  });
});

describe("scenario file has no names", () => {
  it("only player-N / tag-N in name keys", () => {
    const text = readFileSync(new URL("../../../scenarios/live-ingame.jsonl", import.meta.url), "utf8");
    expect(text).not.toMatch(/"displayName"|"rawDisplayName"/);
  });
});
