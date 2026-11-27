import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateTeamsScenario, TEAMS_SCENARIO_PATH } from "./make-teams-scenario.ts";

describe("teams-custom-lobby scenario", () => {
  const text = generateTeamsScenario();
  const lines = text.split("\n").filter((l) => l.trim() && !l.startsWith("//")).map((l) => JSON.parse(l) as { t: number; uri: string; data: any });

  it("is what the generator makes (run `pnpm make-teams-scenario` after changing it)", () => {
    expect(readFileSync(TEAMS_SCENARIO_PATH, "utf8")).toBe(text);
    expect(generateTeamsScenario()).toBe(text);
  });

  it("holds a custom lobby with a bot and two spectators, and a later update with a third", () => {
    const lobbies = lines.filter((l) => l.uri === "/lol-lobby/v2/lobby");
    expect(lobbies.map((l) => l.t)).toEqual([300, 2000]);
    const cfg = lobbies[0]!.data.gameConfig;
    expect(cfg.isCustom).toBe(true);
    expect(cfg.customTeam100).toHaveLength(5);
    expect(cfg.customTeam200).toHaveLength(5);
    expect(cfg.customTeam200.filter((m: any) => m.isBot)).toHaveLength(1);
    expect(cfg.customSpectators).toHaveLength(2);
    expect(lobbies[1]!.data.gameConfig.customSpectators).toHaveLength(3);
  });

  it("answers every request the fetcher makes for a lobby player", () => {
    const uris = new Set(lines.map((l) => l.uri));
    for (const n of [1, 4, 9, 11]) {
      expect(uris.has(`/lol-ranked/v1/ranked-stats/player-${n}`)).toBe(true);
      expect(uris.has(`/lol-summoner/v2/summoners/player-${n}`) || uris.has(`/lol-summoner/v2/summoners/puuid/player-${n}`)).toBe(true);
      expect(uris.has(`/lol-match-history/v1/products/lol/player-${n}/matches?begIndex=0&endIndex=20`)).toBe(true);
    }
    expect(uris.has("/lol-summoner/v1/summoners?name=player-20%23tag-20")).toBe(true);
  });
});
