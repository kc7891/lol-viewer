import { describe, expect, it } from "vitest";
import type { ProbeResponse } from "@lol-viewer/protocol";
import { lookupRiotId, parseRiotIdLines } from "./riotId.ts";
import { parseCustomLobby } from "./lobby.ts";

describe("parseRiotIdLines", () => {
  it("splits on lines and commas, trims, drops blanks and repeats", () => {
    expect(parseRiotIdLines(" Alice#JP1 ,Bob#JP1\r\n\nalice#jp1\n  \nCarol#0000, ")).toEqual([
      { input: "Alice#JP1", valid: true },
      { input: "Bob#JP1", valid: true },
      { input: "Carol#0000", valid: true },
    ]);
  });
  it("flags lines that are not a Riot ID", () => {
    expect(parseRiotIdLines("NoTag\nA#B#C\n#tag\nname#")).toEqual([
      { input: "NoTag", valid: false },
      { input: "A#B#C", valid: false },
      { input: "#tag", valid: false },
      { input: "name#", valid: false },
    ]);
  });
  it("keeps at most 30 lines", () => {
    const text = Array.from({ length: 40 }, (_, i) => `P${i}#t`).join("\n");
    expect(parseRiotIdLines(text)).toHaveLength(30);
  });
  it("is empty for empty input", () => {
    expect(parseRiotIdLines("")).toEqual([]);
  });
});

describe("lookupRiotId", () => {
  const PUUID = "11111111-2222-3333-4444-555555555555";
  const req = (r: ProbeResponse | Error) => async () => {
    if (r instanceof Error) throw r;
    return r;
  };
  it("returns the person found", async () => {
    const out = await lookupRiotId(req({ status: 200, ms: 5, body: { puuid: PUUID, gameName: "Alice", tagLine: "JP1" } }), "alice#jp1");
    expect(out.result).toEqual({ input: "alice#jp1", puuid: PUUID, error: null });
    expect(out.found).toEqual({ puuid: PUUID, gameName: "Alice", tagLine: "JP1" });
  });
  it("sends the Riot ID through the summonerByName route", async () => {
    let seen: unknown;
    await lookupRiotId(async (route, args) => { seen = { route, args }; return { status: 404, ms: 1, body: null }; }, "Alice#JP1");
    expect(seen).toEqual({ route: "summonerByName", args: { query: { name: "Alice#JP1" } } });
  });
  it("tells format, not-found and failed apart", async () => {
    expect((await lookupRiotId(req({ status: 200, ms: 1, body: {} }), "nope")).result.error).toBe("format");
    expect((await lookupRiotId(req({ status: 404, ms: 1, body: null }), "A#b")).result.error).toBe("not-found");
    expect((await lookupRiotId(req({ status: 200, ms: 1, body: {} }), "A#b")).result.error).toBe("not-found");
    expect((await lookupRiotId(req({ status: 500, ms: 1, body: null }), "A#b")).result.error).toBe("failed");
    expect((await lookupRiotId(req({ status: 0, ms: 0, body: null, error: "timeout" }), "A#b")).result.error).toBe("failed");
    expect((await lookupRiotId(req(new Error("x")), "A#b")).result.error).toBe("failed");
  });
});

describe("parseCustomLobby", () => {
  const m = (puuid: string, isBot = false) => ({ puuid, isBot });
  it("reads the three slot lists and drops bots and members without a PUUID", () => {
    const lobby = {
      gameConfig: {
        isCustom: true,
        customTeam100: [m("p1"), m("", true), m("p2")],
        customTeam200: [m("p3"), { puuid: "bot", isBot: true }, {}],
        customSpectators: [m("p4"), m("p1")],
      },
    };
    expect(parseCustomLobby(lobby)).toEqual({ team100: ["p1", "p2"], team200: ["p3"], spectators: ["p4", "p1"] });
  });
  it("is null when it is not a custom lobby or unreadable", () => {
    expect(parseCustomLobby({ gameConfig: { isCustom: false, customTeam100: [m("p1")] } })).toBeNull();
    for (const x of [null, undefined, 1, "x", [], {}, { gameConfig: null }]) expect(parseCustomLobby(x)).toBeNull();
  });
  it("tolerates missing lists", () => {
    expect(parseCustomLobby({ gameConfig: { isCustom: true } })).toEqual({ team100: [], team200: [], spectators: [] });
  });
});
