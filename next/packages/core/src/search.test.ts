import { describe, expect, it } from "vitest";
import { normalizeSearch, searchChampions } from "./search.ts";

const names = (q: string) => searchChampions(q, 5).map((c) => c.name);

describe("searchChampions", () => {
  it("matches English names case-insensitively", () => {
    expect(names("ahri")[0]).toBe("Ahri");
    expect(names("AHR")[0]).toBe("Ahri");
  });

  it("matches Japanese names in katakana and hiragana", () => {
    expect(names("アーリ")[0]).toBe("Ahri");
    expect(names("あーり")[0]).toBe("Ahri");
    expect(names("ウーコン")[0]).toBe("Wukong");
  });

  it("ignores punctuation and spaces", () => {
    expect(names("kaisa")[0]).toBe("Kai'Sa");
    expect(names("lee sin")[0]).toBe("Lee Sin");
    expect(names("leesin")[0]).toBe("Lee Sin");
  });

  it("finds Wukong by Data Dragon id and URL name", () => {
    expect(names("monkeyking")[0]).toBe("Wukong");
    expect(names("wukong")[0]).toBe("Wukong");
  });

  it("ranks prefix matches before substring matches", () => {
    const r = names("ga");
    expect(r[0]!.toLowerCase().startsWith("ga")).toBe(true);
  });

  it("lists prefix matches (English, slug, Japanese) before substring matches", () => {
    const all = searchChampions("an", 200);
    const isPrefix = (c: (typeof all)[number]) => [c.name, c.slug, c.nameJa].some((k) => normalizeSearch(k).startsWith("an"));
    const firstInner = all.findIndex((c) => !isPrefix(c));
    expect(firstInner).toBeGreaterThan(0);
    expect(all.slice(firstInner).some(isPrefix)).toBe(false);
  });

  it("finds Wukong through every spelling", () => {
    for (const q of ["wukong", "Wukong", "monkeyking", "ウーコン", "うーこん", "wuk"]) expect(names(q)[0], q).toBe("Wukong");
  });

  it("returns the roster for an empty query and nothing for nonsense", () => {
    expect(searchChampions("", 10)).toHaveLength(10);
    expect(searchChampions("zzzzqqq")).toEqual([]);
  });

  it("normalizes full-width input", () => {
    expect(normalizeSearch("ＡＨＲＩ")).toBe("ahri");
  });
});
