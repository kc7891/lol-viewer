import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHAMPION_DATA, CHAMPIONS, getChampion } from "./champions.ts";
import { parseScenario, scenarioEvents } from "./scenario.ts";

describe("generated champion data", () => {
  it("covers the full roster with unique ids and slugs", () => {
    expect(CHAMPIONS.length).toBeGreaterThanOrEqual(170);
    expect(new Set(CHAMPIONS.map((c) => c.id)).size).toBe(CHAMPIONS.length);
    expect(new Set(CHAMPIONS.map((c) => c.slug)).size).toBe(CHAMPIONS.length);
    expect(CHAMPION_DATA.patch).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("has one cooldown per rank for every spell", () => {
    for (const c of CHAMPIONS) {
      expect(c.spells.map((s) => s.key)).toEqual(["Q", "W", "E", "R"]);
      for (const s of c.spells) expect(s.cooldown, `${c.name} ${s.key}`).toHaveLength(s.maxrank);
    }
  });

  it("knows every champion the scenarios pick", () => {
    const text = readFileSync(new URL("../../../scenarios/ranked-two-matches.jsonl", import.meta.url), "utf8");
    const ids = new Set<number>();
    for (const e of scenarioEvents(parseScenario(text))) {
      if (e.type !== "champ-select-session" || !e.session) continue;
      for (const p of [...e.session.myTeam, ...e.session.theirTeam]) if (p.championId > 0) ids.add(p.championId);
    }
    for (const id of ids) expect(getChampion(id), `champion ${id}`).toBeDefined();
  });

  it("uses the same URL names as the Python app's champions.json (except the Wukong fix)", () => {
    const py = JSON.parse(readFileSync(new URL("../../../../champions.json", import.meta.url), "utf8")) as Record<string, { id: string }>;
    const pySlugs = new Map(Object.entries(py).map(([slug, v]) => [v.id, slug]));
    const mismatches = CHAMPIONS.filter((c) => pySlugs.has(c.ddragonId) && pySlugs.get(c.ddragonId) !== c.slug).map(
      (c) => `${c.ddragonId}: ${pySlugs.get(c.ddragonId)} -> ${c.slug}`,
    );
    // lolalytics serves /lol/wukong/ (200) but not /lol/monkeyking/ (404), checked 2026-11.
    expect(mismatches).toEqual(["MonkeyKing: monkeyking -> wukong"]);
  });
});
