import { describe, expect, it } from "vitest";
import { ChampionDataSchema } from "@lol-viewer/protocol";
import { readFileSync } from "node:fs";
import { diff, format, parseLaneCsv, slugFor, transform, transformItems, itemDiffLine, unknownLaneNames, type DDragonChampionFull } from "./index.ts";

const spells = (prefix: string, cds: number[][]) =>
  cds.map((cooldown, i) => ({ id: `${prefix}${i}`, name: `${prefix} spell ${i}`, maxrank: cooldown.length, cooldown }));

function full(version: string, ja = false, ahriW = [9, 8, 7, 6, 5]): DDragonChampionFull {
  const n = (en: string, j: string) => (ja ? j : en);
  return {
    version,
    data: {
      MonkeyKing: {
        id: "MonkeyKing",
        key: "62",
        name: n("Wukong", "ウーコン"),
        spells: spells(n("W", "ウ"), [[8, 7.5, 7, 6.5, 6], [22, 20.5, 19, 17.5, 16], [10, 9.5, 9, 8.5, 8], [120, 105, 90]]),
      },
      Ahri: {
        id: "Ahri",
        key: "103",
        name: n("Ahri", "アーリ"),
        spells: spells(n("A", "ア"), [[7, 7, 7, 7, 7], ahriW, [12, 12, 12, 12, 12], [140, 120, 100]]),
      },
    },
  };
}

describe("slugFor", () => {
  it("lowercases Data Dragon ids and applies overrides", () => {
    expect(slugFor("Ahri")).toBe("ahri");
    expect(slugFor("KSante")).toBe("ksante");
    expect(slugFor("MonkeyKing")).toBe("wukong");
  });
});

describe("transform", () => {
  const data = transform(full("16.23.1"), full("16.23.1", true));

  it("produces schema-valid data sorted by English name", () => {
    expect(() => ChampionDataSchema.parse(data)).not.toThrow();
    expect(data.champions.map((c) => c.name)).toEqual(["Ahri", "Wukong"]);
  });

  it("maps numeric ids, slugs, both locales and Q/W/E/R cooldowns", () => {
    const ahri = data.champions[0]!;
    expect(ahri).toMatchObject({ id: 103, ddragonId: "Ahri", slug: "ahri", nameJa: "アーリ" });
    expect(ahri.spells.map((s) => s.key)).toEqual(["Q", "W", "E", "R"]);
    expect(ahri.spells[1]).toMatchObject({ nameJa: "ア spell 1", maxrank: 5, cooldown: [9, 8, 7, 6, 5] });
    expect(data.champions[1]!.slug).toBe("wukong");
  });

  it("rejects mismatched locale versions", () => {
    expect(() => transform(full("16.23.1"), full("16.22.1", true))).toThrow(/mismatch/);
  });
});

describe("format", () => {
  it("keeps number arrays on one line and round-trips", () => {
    const data = transform(full("16.23.1"), full("16.23.1", true));
    const text = format(data);
    expect(text).toContain('"cooldown": [9, 8, 7, 6, 5]');
    expect(JSON.parse(text)).toEqual(data);
  });
});

describe("diff", () => {
  it("lists cooldown changes as a Markdown table", () => {
    const before = transform(full("16.22.1"), full("16.22.1", true));
    const after = transform(full("16.23.1", false, [9, 8, 7, 6, 4]), full("16.23.1", true));
    const md = diff(before, after);
    expect(md).toContain("`16.22.1` → `16.23.1`");
    expect(md).toContain("| Ahri | W ア spell 1 | 9 / 8 / 7 / 6 / 5 | 9 / 8 / 7 / 6 / 4 |");
  });

  it("reports when nothing changed", () => {
    const d = transform(full("16.23.1"), full("16.23.1", true));
    expect(diff(d, d)).toContain("No cooldown or roster changes.");
  });
});

describe("lane scores (champion_lane.csv)", () => {
  const csv = "name,top,jg,mid,bot,sup\nahri,4,0,5,0,0\nwukong,5,1,0,0,0\nnobody,1,1,1,1,1\n";
  const lanes = parseLaneCsv(csv);
  const data = transform(full("16.23.1"), full("16.23.1", true), lanes);

  it("merges by slug: Wukong (MonkeyKing in Data Dragon) gets the `wukong` row", () => {
    const wukong = data.champions.find((c) => c.name === "Wukong")!;
    expect(wukong).toMatchObject({ slug: "wukong", ddragonId: "MonkeyKing" });
    expect(wukong.lanes).toEqual({ top: 5, jungle: 1, middle: 0, bottom: 0, support: 0 });
    expect(data.champions.find((c) => c.name === "Ahri")!.lanes).toEqual({ top: 4, jungle: 0, middle: 5, bottom: 0, support: 0 });
  });

  it("gives 0 to champions missing from the CSV and warns about unknown CSV names", () => {
    const none = transform(full("16.23.1"), full("16.23.1", true), parseLaneCsv("name,top,jg,mid,bot,sup\nahri,4,0,5,0,0\n"));
    expect(none.champions.find((c) => c.slug === "wukong")!.lanes).toEqual({ top: 0, jungle: 0, middle: 0, bottom: 0, support: 0 });
    expect(unknownLaneNames(data, lanes)).toEqual(["nobody"]);
  });

  it.each([
    ["bad header", "name,top\nahri,1"],
    ["out of range", "name,top,jg,mid,bot,sup\nahri,6,0,0,0,0"],
    ["missing column", "name,top,jg,mid,bot,sup\nahri,1,0,0,0"],
  ])("rejects a malformed CSV: %s", (_n, text) => {
    expect(() => parseLaneCsv(text)).toThrow();
  });

  it("the committed CSV parses and every row matches the generated roster", () => {
    const real = parseLaneCsv(readFileSync(new URL("../champion_lane.csv", import.meta.url), "utf8"));
    expect(real.get("wukong")).toMatchObject({ top: 0, jungle: 5 }); // M-024
    expect(real.has("monkeyking")).toBe(false);
  });
});

describe("transformItems", () => {
  const file = {
    version: "16.23.1",
    data: {
      "3340": { name: "Stealth Ward", gold: { total: 0 } },
      "3031": { name: "Infinity Edge", gold: { total: 3500 } },
      "2003": { name: "Health Potion", gold: { total: 50 }, consumed: true },
      "2031": { name: "Refillable Potion", gold: { total: 150 } },
      "abc": { name: "junk", gold: { total: 1 } },
    },
  };
  it("counts gold.total, zeroes consumed items, drops non-numeric ids, sorts by id", () => {
    const d = transformItems(file);
    expect(Object.keys(d.items)).toEqual(["2003", "2031", "3031", "3340"]);
    expect(d.items).toMatchObject({ "2003": 0, "2031": 150, "3031": 3500, "3340": 0 });
    expect(d.patch).toBe("16.23.1");
  });
  it("summarises changes", () => {
    const a = transformItems(file);
    const b = transformItems({ ...file, data: { ...file.data, "3031": { name: "IE", gold: { total: 3400 } } } });
    expect(itemDiffLine(null, a)).toBe("Items: 4");
    expect(itemDiffLine(a, b)).toBe("Items: 4 (1 changed)");
  });
});
