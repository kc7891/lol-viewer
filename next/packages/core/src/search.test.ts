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

  it("returns the roster for an empty query and nothing for nonsense", () => {
    expect(searchChampions("", 10)).toHaveLength(10);
    expect(searchChampions("zzzzqqq")).toEqual([]);
  });

  it("normalizes full-width input", () => {
    expect(normalizeSearch("ＡＨＲＩ")).toBe("ahri");
  });
});
