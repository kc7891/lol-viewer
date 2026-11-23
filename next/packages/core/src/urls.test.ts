import { describe, expect, it } from "vitest";
import { CHAMPIONS, getChampion } from "./champions.ts";
import { DEFAULT_SETTINGS } from "./settings.ts";
import { liveGameUrl, viewerUrl } from "./urls.ts";
import type { Viewer } from "./workspace.ts";

const T = DEFAULT_SETTINGS.urls;
const id = (slug: string) => CHAMPIONS.find((c) => c.slug === slug)!.id;
const v = (p: Partial<Viewer>) => ({ championId: null, opponentId: null, lane: null, mode: "build" as const, ...p });

describe("viewerUrl", () => {
  const ahri = id("ahri");
  const zed = id("zed");
  const wukong = id("wukong");

  it.each([
    ["build", v({ championId: ahri }), "https://lolalytics.com/lol/ahri/build/"],
    ["build + lane", v({ championId: ahri, lane: "middle" }), "https://lolalytics.com/lol/ahri/build/?lane=middle"],
    ["matchup + lane", v({ championId: ahri, opponentId: zed, lane: "middle" }), "https://lolalytics.com/lol/ahri/vs/zed/build/?lane=middle&vslane=middle"],
    ["matchup without lane", v({ championId: ahri, opponentId: zed }), "https://lolalytics.com/lol/ahri/vs/zed/build/?lane=&vslane="],
    ["counter", v({ championId: ahri, mode: "counter" }), "https://lolalytics.com/lol/ahri/counters/"],
    ["counter + lane, opponent ignored", v({ championId: ahri, opponentId: zed, mode: "counter", lane: "top" }), "https://lolalytics.com/lol/ahri/counters/?lane=top"],
    ["aram ignores lane and opponent", v({ championId: ahri, opponentId: zed, mode: "aram", lane: "top" }), "https://u.gg/lol/champions/aram/ahri-aram"],
    // M-004: every path uses the slug, never MonkeyKing.
    ["wukong build", v({ championId: wukong }), "https://lolalytics.com/lol/wukong/build/"],
    ["wukong build + lane", v({ championId: wukong, lane: "top" }), "https://lolalytics.com/lol/wukong/build/?lane=top"],
    ["wukong as champion in matchup", v({ championId: wukong, opponentId: zed, lane: "top" }), "https://lolalytics.com/lol/wukong/vs/zed/build/?lane=top&vslane=top"],
    ["wukong as opponent", v({ championId: ahri, opponentId: wukong, lane: "middle" }), "https://lolalytics.com/lol/ahri/vs/wukong/build/?lane=middle&vslane=middle"],
    ["wukong counter", v({ championId: wukong, mode: "counter" }), "https://lolalytics.com/lol/wukong/counters/"],
    ["wukong aram", v({ championId: wukong, mode: "aram" }), "https://u.gg/lol/champions/aram/wukong-aram"],
  ])("%s", (_n, viewer, url) => {
    expect(viewerUrl(viewer, T)).toBe(url);
  });

  it("is null without a champion, and an unknown opponent falls back to the build page", () => {
    expect(viewerUrl(v({}), T)).toBeNull();
    expect(viewerUrl(v({ championId: 999999 }), T)).toBeNull();
    expect(viewerUrl(v({ championId: ahri, opponentId: 999999 }), T)).toBe("https://lolalytics.com/lol/ahri/build/");
  });

  it("never contains MonkeyKing for any champion in any mode", () => {
    for (const c of CHAMPIONS) {
      for (const mode of ["build", "counter", "aram"] as const) {
        expect(viewerUrl(v({ championId: c.id, opponentId: wukong, mode, lane: "top" }), T)!.toLowerCase()).not.toContain("monkeyking");
      }
    }
  });

  it("uses custom templates and joins lane with & when the template already has a query", () => {
    const t = { ...T, build: "https://example.test/{name}?x=1" };
    expect(viewerUrl(v({ championId: ahri, lane: "bottom" }), t)).toBe("https://example.test/ahri?x=1&lane=bottom");
  });

  it("every champion slug is lowercase alphanumeric", () => {
    for (const c of CHAMPIONS) expect(getChampion(c.id)!.slug).toMatch(/^[a-z0-9]+$/);
  });
});

describe("liveGameUrl", () => {
  it("returns the trimmed template", () => {
    expect(liveGameUrl(T)).toBe("https://u.gg/lol/lg-splash");
    expect(liveGameUrl({ ...T, liveGame: "  https://u.gg/x  " })).toBe("https://u.gg/x");
  });
});
