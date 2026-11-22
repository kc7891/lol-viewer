import { describe, expect, it } from "vitest";
import { ChampionDataSchema } from "@lol-viewer/protocol";
import { diff, format, slugFor, transform, type DDragonChampionFull } from "./index.ts";

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
