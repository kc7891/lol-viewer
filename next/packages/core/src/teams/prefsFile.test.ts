import { describe, expect, it } from "vitest";
import { applyPrefsImport, buildPrefsFile, exportPrefs, matchPrefsEntries, parsePrefsFile, PREFS_FILE_MAX_BYTES, rankFromLabel, rankToLabel } from "./prefsFile.ts";
import { rankPoints } from "./rank.ts";
import type { TeamPlayerPref } from "../settings.ts";

const NOW = Date.parse("2026-11-27T15:30:00Z");
const players = {
  p1: { gameName: "Player1", tagLine: "tag1" },
  p4: { gameName: "Player4", tagLine: "tag4" },
  p7: { gameName: "Player7", tagLine: "tag7" },
};
const file = (over: Record<string, unknown> = {}) => JSON.stringify({ kind: "lol-viewer/team-preferences", version: 1, exportedAt: "x", players: [], ...over });

describe("rank labels", () => {
  it("round trips every tier and division", () => {
    for (const tier of ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND"]) {
      for (const div of ["IV", "III", "II", "I"]) {
        const label = `${tier} ${div}`;
        const points = rankFromLabel(label)!;
        expect(points).toBe(rankPoints(tier, div, 0));
        expect(rankToLabel(points)).toBe(label);
      }
    }
  });
  it("Master and above carry LP", () => {
    expect(rankFromLabel("MASTER 120")).toBe(2920);
    expect(rankToLabel(2920)).toBe("MASTER 120");
    expect(rankToLabel(2800)).toBe("MASTER 0");
    expect(rankFromLabel("grandmaster 300")).toBe(3100);
    expect(rankFromLabel("Challenger")).toBe(2800);
  });
  it("reads any case and spacing, and refuses nonsense", () => {
    expect(rankFromLabel(" gold  ii ")).toBe(1400);
    expect(rankFromLabel("GOLD")).toBeNull();
    expect(rankFromLabel("GOLD V")).toBeNull();
    expect(rankFromLabel("COPPER I")).toBeNull();
    expect(rankFromLabel("MASTER lots")).toBeNull();
    expect(rankFromLabel(12)).toBeNull();
    expect(rankFromLabel("")).toBeNull();
  });
  it("drops the LP inside a division on the way out", () => {
    expect(rankToLabel(1450)).toBe("GOLD II");
    expect(rankToLabel(0)).toBe("IRON IV");
    expect(rankToLabel(-5)).toBe("IRON IV");
  });
});

describe("export", () => {
  const prefs: Record<string, TeamPlayerPref> = { p4: { mains: ["middle", "support"] }, p1: { lock: "jungle", mains: ["middle"], ng: ["support"], rankOverride: 1400 }, p7: {} };
  it("writes the people with a preference, sorted, in the documented shape", () => {
    const f = buildPrefsFile(prefs, players, NOW);
    expect(f).toEqual({
      kind: "lol-viewer/team-preferences",
      version: 1,
      exportedAt: "2026-11-27T15:30:00Z",
      players: [
        { riotId: "Player1#tag1", puuid: "p1", lock: "jungle", prefer: ["middle"], avoid: ["support"], rank: "GOLD II" },
        { riotId: "Player4#tag4", puuid: "p4", prefer: ["middle", "support"] },
      ],
    });
  });
  it("is two-space JSON, and writes a person with an unknown name by puuid only", () => {
    const text = exportPrefs({ zz: { ng: ["top"] } }, {}, NOW);
    expect(text).toContain('\n  "players": [\n    {\n      "puuid": "zz",');
    expect(JSON.parse(text).players[0]).toEqual({ puuid: "zz", avoid: ["top"] });
  });
  it("writes an empty list when nobody has a preference", () => {
    expect(buildPrefsFile({ p7: {} }, players, NOW).players).toEqual([]);
  });
  it("exports then parses to the same preferences", () => {
    const prefsIn: Record<string, TeamPlayerPref> = { p1: { lock: "jungle", mains: ["middle"], ng: ["support"], rankOverride: 1400 }, p4: { mains: ["top", "bottom"] } };
    const parsed = parsePrefsFile(exportPrefs(prefsIn, players, NOW));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const { matched, unresolved } = matchPrefsEntries(parsed.entries, players);
    expect(unresolved).toEqual([]);
    expect(Object.fromEntries(matched.map((m) => [m.puuid, m.pref]))).toEqual(prefsIn);
  });
});

describe("parsePrefsFile", () => {
  it("says why a broken file is refused", () => {
    expect(parsePrefsFile("not json")).toEqual({ ok: false, error: "json" });
    expect(parsePrefsFile("")).toEqual({ ok: false, error: "json" });
    expect(parsePrefsFile("[]")).toEqual({ ok: false, error: "kind" });
    expect(parsePrefsFile("null")).toEqual({ ok: false, error: "kind" });
    expect(parsePrefsFile(file({ kind: "other" }))).toEqual({ ok: false, error: "kind" });
    expect(parsePrefsFile(file({ version: 2 }))).toEqual({ ok: false, error: "version" });
    expect(parsePrefsFile(file({ version: "1" }))).toEqual({ ok: false, error: "version" });
  });
  it("refuses a file over 1 MB (counted in bytes)", () => {
    expect(parsePrefsFile("x".repeat(PREFS_FILE_MAX_BYTES + 1))).toEqual({ ok: false, error: "size" });
    // 3-byte characters: under the limit in characters, over it in bytes.
    expect(parsePrefsFile("あ".repeat(400_000))).toEqual({ ok: false, error: "size" });
    expect(parsePrefsFile(" ".repeat(PREFS_FILE_MAX_BYTES - 10) + file()).ok).toBe(false); // not too big, but the padding plus JSON is over
  });
  it("reads a file with a BOM, and a file with no players", () => {
    expect(parsePrefsFile("﻿" + file())).toEqual({ ok: true, entries: [] });
    expect(parsePrefsFile(file({ players: "no" }))).toEqual({ ok: true, entries: [] });
  });
  it("drops a broken player and broken fields, keeps the rest", () => {
    const r = parsePrefsFile(
      file({
        players: [
          { riotId: "A#1", lock: "jungle", prefer: ["middle", "nope", "middle", "top", "bottom"], avoid: ["support", 5], rank: "GOLD II" },
          "string",
          null,
          { lock: "jungle" }, // no name and no puuid
          { riotId: "B#2", lock: "mid", prefer: "top", rank: "COPPER I" }, // nothing usable
          { riotId: "C#3", puuid: 7, rank: "SILVER I" },
          { puuid: "px", avoid: ["top"] },
        ],
      }),
    );
    expect(r).toEqual({
      ok: true,
      entries: [
        { riotId: "A#1", pref: { lock: "jungle", mains: ["middle", "top"], ng: ["support"], rankOverride: 1400 } },
        { riotId: "C#3", pref: { rankOverride: 1100 } },
        { puuid: "px", pref: { ng: ["top"] } },
      ],
    });
  });
  it("keeps the lanes consistent: a locked lane is not starred or avoided, a starred lane is not avoided", () => {
    const r = parsePrefsFile(file({ players: [{ riotId: "A#1", lock: "top", prefer: ["top", "jungle"], avoid: ["top", "jungle", "support"] }] }));
    expect(r).toEqual({ ok: true, entries: [{ riotId: "A#1", pref: { lock: "top", mains: ["jungle"], ng: ["support"] } }] });
  });
  it("reads at most 500 players", () => {
    const many = Array.from({ length: 700 }, (_, i) => ({ riotId: `P${i}#t`, lock: "top" }));
    const r = parsePrefsFile(file({ players: many }));
    expect(r.ok && r.entries.length).toBe(500);
  });
});

describe("matchPrefsEntries", () => {
  const e = (o: { riotId?: string; puuid?: string }) => ({ ...o, pref: { lock: "top" as const } });
  it("matches the puuid first, even when the name changed", () => {
    const r = matchPrefsEntries([e({ puuid: "p1", riotId: "OldName#old" })], players);
    expect(r.matched.map((m) => m.puuid)).toEqual(["p1"]);
    expect(r.unresolved).toEqual([]);
  });
  it("falls back to the Riot ID, any case", () => {
    const r = matchPrefsEntries([e({ riotId: "PLAYER4#TAG4" }), e({ puuid: "unknown", riotId: "player7#Tag7" })], players);
    expect(r.matched.map((m) => m.puuid)).toEqual(["p4", "p7"]);
  });
  it("a puuid that belongs to somebody else wins over the name", () => {
    const r = matchPrefsEntries([e({ puuid: "p4", riotId: "Player1#tag1" })], players);
    expect(r.matched.map((m) => m.puuid)).toEqual(["p4"]);
  });
  it("lists people it cannot find (by Riot ID, else puuid)", () => {
    const r = matchPrefsEntries([e({ riotId: "Nobody#x" }), e({ puuid: "zzz" }), e({ puuid: "p1" })], players);
    expect(r.unresolved).toEqual(["Nobody#x", "zzz"]);
    expect(r.matched).toHaveLength(1);
  });
  it("one person named twice keeps the later entry", () => {
    const r = matchPrefsEntries([{ puuid: "p1", pref: { lock: "top" } }, { riotId: "player1#tag1", pref: { lock: "support" } }], players);
    expect(r.matched).toEqual([{ puuid: "p1", pref: { lock: "support" } }]);
  });
  it("skips saved people with no name", () => {
    expect(matchPrefsEntries([e({ riotId: "#" })], { x: { gameName: "", tagLine: "" } }).unresolved).toEqual(["#"]);
  });
});

describe("applyPrefsImport", () => {
  it("replaces the people in the file and leaves everybody else alone", () => {
    const current: Record<string, TeamPlayerPref> = { p1: { lock: "top", ng: ["support"], rankOverride: 100 }, p7: { mains: ["bottom"] } };
    const next = applyPrefsImport(current, [
      { puuid: "p1", pref: { mains: ["middle"] } },
      { puuid: "p4", pref: { lock: "jungle" } },
    ]);
    expect(next).toEqual({ p1: { mains: ["middle"] }, p4: { lock: "jungle" }, p7: { mains: ["bottom"] } });
    expect(current.p1!.lock).toBe("top");
  });
});
