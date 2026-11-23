import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHAMPION_DATA, CHAMPIONS, championIconUrl, getChampion } from "./champions.ts";
import { parseScenario, scenarioEvents } from "./scenario.ts";

describe("generated champion data", () => {
  it("covers the full roster with unique ids and slugs", () => {
    expect(CHAMPIONS.length).toBeGreaterThanOrEqual(170);
    expect(new Set(CHAMPIONS.map((c) => c.id)).size).toBe(CHAMPIONS.length);
    expect(new Set(CHAMPIONS.map((c) => c.slug)).size).toBe(CHAMPIONS.length);
    expect(CHAMPION_DATA.patch).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("Wukong: slug wukong, Data Dragon id MonkeyKing, jungle 5 (M-004, M-015, M-024)", () => {
    const w = CHAMPIONS.find((c) => c.name === "Wukong")!;
    expect(w).toMatchObject({ id: 62, slug: "wukong", ddragonId: "MonkeyKing" });
    expect(w.lanes).toMatchObject({ top: 0, jungle: 5 });
    expect(championIconUrl(w)).toMatch(/\/img\/champion\/MonkeyKing\.png$/);
  });

  it("every entry has lane scores 0-5, and most champions have at least one lane", () => {
    for (const c of CHAMPIONS) {
      for (const n of Object.values(c.lanes)) expect(Number.isInteger(n) && n >= 0 && n <= 5).toBe(true);
    }
    const withLane = CHAMPIONS.filter((c) => Object.values(c.lanes).some((n) => n > 0));
    expect(withLane.length).toBeGreaterThan(CHAMPIONS.length * 0.9);
    expect(getChampion(103)!.lanes).toMatchObject({ top: 4, middle: 5 });
  });

  it("has one cooldown per rank for every spell", () => {
    for (const c of CHAMPIONS) {
      expect(c.spells.map((s) => s.key)).toEqual(["Q", "W", "E", "R"]);
      for (const s of c.spells) expect(s.cooldown, `${c.name} ${s.key}`).toHaveLength(s.maxrank);
    }
  });

  it.each(["ranked-two-matches", "aram-match", "blind-dodge-ingame"])("knows every champion the %s scenario picks", (name) => {
    const text = readFileSync(new URL(`../../../scenarios/${name}.jsonl`, import.meta.url), "utf8");
    const ids = new Set<number>();
    for (const e of scenarioEvents(parseScenario(text))) {
      if (e.type !== "champ-select-session" || !e.session) continue;
      for (const p of [...e.session.myTeam, ...e.session.theirTeam]) if (p.championId > 0) ids.add(p.championId);
    }
    for (const id of ids) expect(getChampion(id), `champion ${id}`).toBeDefined();
  });

  it("uses the same URL names as the Python app's champions.json", () => {
    const py = JSON.parse(readFileSync(new URL("../../../../champions.json", import.meta.url), "utf8")) as Record<string, { id: string }>;
    const pySlugs = new Map(Object.entries(py).map(([slug, v]) => [v.id, slug]));
    const mismatches = CHAMPIONS.filter((c) => pySlugs.has(c.ddragonId) && pySlugs.get(c.ddragonId) !== c.slug).map(
      (c) => `${c.ddragonId}: ${pySlugs.get(c.ddragonId)} -> ${c.slug}`,
    );
    // Both apps key Wukong as "wukong" (lolalytics serves /lol/wukong/, not /lol/monkeyking/).
    expect(mismatches).toEqual([]);
  });
});
