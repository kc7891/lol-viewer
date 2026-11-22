import { describe, expect, it } from "vitest";
import { isAllowedViewUrl } from "@lol-viewer/protocol";
import { buildViewerUrl, viewerId } from "./urls.ts";

describe("buildViewerUrl", () => {
  it("builds build/counter/matchup URLs like constants.py", () => {
    expect(buildViewerUrl({ kind: "build", championId: 103 })).toBe("https://lolalytics.com/lol/ahri/build/");
    expect(buildViewerUrl({ kind: "counter", championId: 62 })).toBe("https://lolalytics.com/lol/wukong/counters/");
    expect(buildViewerUrl({ kind: "matchup", championId: 122, opponentId: 86, lane: "top" })).toBe(
      "https://lolalytics.com/lol/darius/vs/garen/build/?lane=top&vslane=top",
    );
  });

  it("returns null for unknown champions", () => {
    expect(buildViewerUrl({ kind: "build", championId: 999999 })).toBeNull();
  });

  it("produces only allow-listed URLs", () => {
    expect(isAllowedViewUrl(buildViewerUrl({ kind: "aram", championId: 103 })!)).toBe(true);
  });

  it("gives stable view ids", () => {
    expect(viewerId({ kind: "build", championId: 103 })).toBe("build:103");
    expect(viewerId({ kind: "matchup", championId: 122, opponentId: 86, lane: "top" })).toBe("matchup:122:86:top");
  });
});

describe("isAllowedViewUrl", () => {
  it.each([
    ["https://lolalytics.com/lol/ahri/build/", true],
    ["https://www.u.gg/lol", true],
    ["http://lolalytics.com/", false],
    ["https://evil-lolalytics.com/", false],
    ["https://lolalytics.com.evil.example/", false],
    ["javascript:alert(1)", false],
    ["file:///etc/passwd", false],
  ])("%s -> %s", (url, ok) => {
    expect(isAllowedViewUrl(url)).toBe(ok);
  });
});

describe("autoViewers", async () => {
  const { autoViewers } = await import("./viewers.ts");
  const { readFileSync } = await import("node:fs");
  const { parseScenario, scenarioEvents } = await import("./scenario.ts");
  const { reduceAll } = await import("./reducer.ts");
  const events = scenarioEvents(
    parseScenario(readFileSync(new URL("../../../scenarios/ranked-two-matches.jsonl", import.meta.url), "utf8")),
  );

  it("opens build + lane matchup for me and counters for enemies", () => {
    const end1 = events.findIndex((e) => e.type === "gameflow-phase" && e.phase === "EndOfGame");
    const ids = autoViewers(reduceAll(events.slice(0, end1))).map(viewerId);
    expect(ids).toEqual(["build:103", "matchup:103:238:middle", "counter:86", "counter:76", "counter:238", "counter:51", "counter:89"]);
  });
});

describe("defaultCooldownChampion", async () => {
  const { defaultCooldownChampion } = await import("./viewers.ts");
  const { initialMatchState, reduce } = await import("./reducer.ts");
  const cs = (my: number[], their: number[], local: number) =>
    reduce(initialMatchState(), {
      type: "champ-select-session",
      session: {
        localPlayerCellId: local,
        myTeam: my.map((championId, cellId) => ({ cellId, championId, assignedPosition: ["top", "jungle", "middle", "bottom", "utility"][cellId] })),
        theirTeam: their.map((championId, i) => ({ cellId: 5 + i, championId })),
      },
    });

  it("prefers my lane opponent", () => {
    expect(defaultCooldownChampion(cs([122, 64, 103], [86, 76, 238], 2))).toBe(238);
  });
  it("falls back to the first enemy pick", () => {
    expect(defaultCooldownChampion(cs([0, 0, 103], [86], 2))).toBe(86);
  });
  it("is null before any enemy pick", () => {
    expect(defaultCooldownChampion(cs([0, 0, 103], [], 2))).toBeNull();
  });
});
