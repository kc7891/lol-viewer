import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  DEFAULT_URL_TEMPLATES,
  FEATURE_FLAGS,
  flagsAtDefaults,
  isFeatureOn,
  resetFeatureFlags,
  SettingsSchema,
  UI_SCALE,
  parseSettings,
  trimUrlTemplates,
  urlTemplateProblem,
  validateUrlTemplates,
} from "./settings.ts";

describe("defaults", () => {
  it("match the schema defaults", () => {
    expect(SettingsSchema.parse({})).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toMatchObject({ uiSize: "medium", qrButton: true, sidebarWidth: 300, featureFlags: {} });
    expect(DEFAULT_URL_TEMPLATES.liveGame).toBe("https://u.gg/lol/lg-splash");
    expect(DEFAULT_URL_TEMPLATES.matchup).toBe(
      "https://lolalytics.com/lol/{champion_name1}/vs/{champion_name2}/build/?lane={lane_name}&vslane={lane_name}",
    );
    expect(FEATURE_FLAGS.liveClientData.default).toBe(false);
    expect(isFeatureOn(DEFAULT_SETTINGS, "liveClientData")).toBe(false);
    expect(FEATURE_FLAGS.inGameOverlay.default).toBe(false);
    expect(isFeatureOn(DEFAULT_SETTINGS, "inGameOverlay")).toBe(false);
    expect(UI_SCALE).toEqual({ small: 0.9, medium: 1, large: 1.15 });
  });
});

describe("parseSettings", () => {
  it.each([undefined, null, 5, "x", [], {}])("%j gives the defaults", (input) => {
    expect(parseSettings(input)).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps good values", () => {
    const s = { urls: { ...DEFAULT_URL_TEMPLATES, build: "https://x.test/{name}" }, uiSize: "large", qrButton: false, sidebarWidth: 400, featureFlags: { a: true }, overlayPosition: { horizontal: "right", vertical: "top" }, teamPlayers: {}, teams: { discordWithRank: true, discordWithTag: false, lastGroupId: null }, teamRosters: [], teamMatchups: [] };
    expect(parseSettings(s)).toEqual(s);
  });

  it("repairs each broken item on its own", () => {
    const s = parseSettings({
      urls: { build: 5, matchup: "  ", counter: "https://c.test/{name}" },
      uiSize: "huge",
      qrButton: "yes",
      sidebarWidth: "wide",
      featureFlags: { ok: true, bad: 1 },
      overlayPosition: { horizontal: "middle", vertical: "top" },
      unknown: 1,
    });
    expect(s).toEqual({
      urls: { ...DEFAULT_URL_TEMPLATES, counter: "https://c.test/{name}" },
      uiSize: "medium",
      qrButton: true,
      sidebarWidth: 300,
      featureFlags: { ok: true },
      overlayPosition: { horizontal: "left", vertical: "top" },
      teamPlayers: {},
      teams: { discordWithRank: true, discordWithTag: false, lastGroupId: null },
      teamRosters: [],
      teamMatchups: [],
    });
  });

  it("overlayPosition: default is bottom-left; each field falls back on its own", () => {
    expect(DEFAULT_SETTINGS.overlayPosition).toEqual({ horizontal: "left", vertical: "bottom" });
    expect(parseSettings({ overlayPosition: "top" }).overlayPosition).toEqual(DEFAULT_SETTINGS.overlayPosition);
    expect(parseSettings({ overlayPosition: null }).overlayPosition).toEqual(DEFAULT_SETTINGS.overlayPosition);
    expect(parseSettings({ overlayPosition: { horizontal: "center" } }).overlayPosition).toEqual({ horizontal: "center", vertical: "bottom" });
    expect(parseSettings({ overlayPosition: { horizontal: 3, vertical: "top" } }).overlayPosition).toEqual({ horizontal: "left", vertical: "top" });
    expect(parseSettings({ overlayPosition: { horizontal: "right", vertical: "middle" } }).overlayPosition).toEqual({ horizontal: "right", vertical: "bottom" });
  });

  it.each([
    [100, 240],
    [9999, 480],
    [300.4, 300],
    [NaN, 300],
  ])("sidebarWidth %s -> %s", (w, want) => {
    expect(parseSettings({ sidebarWidth: w }).sidebarWidth).toBe(want);
  });

  it.each(["small", "medium", "large"])("accepts uiSize %s", (u) => {
    expect(parseSettings({ uiSize: u }).uiSize).toBe(u);
  });
});

describe("validateUrlTemplates", () => {
  it("returns the empty (after trim) items and accepts a full set", () => {
    expect(validateUrlTemplates(DEFAULT_SETTINGS.urls)).toEqual([]);
    expect(validateUrlTemplates({ ...DEFAULT_SETTINGS.urls, build: "", aram: "   ", liveGame: "\t" })).toEqual(["build", "aram", "liveGame"]);
  });
  it("rejects templates that would not load in the app (non-https); any https host is fine", () => {
    expect(urlTemplateProblem("https://lolalytics.com/lol/{name}/build/")).toBeNull();
    expect(urlTemplateProblem("https://www.u.gg/lol/{name}")).toBeNull();
    expect(urlTemplateProblem("http://lolalytics.com/lol/{name}/build/")).toBe("host");
    expect(urlTemplateProblem("https://op.gg/champions/{name}")).toBeNull();
    expect(urlTemplateProblem("https://example.com/{name}")).toBeNull();
    expect(urlTemplateProblem("javascript:alert(1)")).toBe("host");
    expect(urlTemplateProblem("lolalytics.com/{name}")).toBe("host");
    expect(urlTemplateProblem("  ")).toBe("empty");
    expect(validateUrlTemplates({ ...DEFAULT_SETTINGS.urls, counter: "http://op.gg/{name}" })).toEqual(["counter"]);
  });
  it("trims on save", () => {
    expect(trimUrlTemplates({ ...DEFAULT_SETTINGS.urls, build: "  https://a/{name}  " }).build).toBe("https://a/{name}");
  });
});

describe("feature flags (M-025)", () => {
  it("the stored value wins; reset keeps unknown keys", () => {
    const on = { ...DEFAULT_SETTINGS, featureFlags: { liveClientData: true } };
    expect(isFeatureOn(on, "liveClientData")).toBe(true);
    expect(flagsAtDefaults(on)).toBe(false);
    expect(flagsAtDefaults(DEFAULT_SETTINGS)).toBe(true);
    expect(resetFeatureFlags({ liveClientData: true, inGameOverlay: true, unknown: true })).toEqual({
      liveClientData: false,
      inGameOverlay: false,
      teamBalancer: false,
      unknown: true,
    });
    expect(flagsAtDefaults({ ...DEFAULT_SETTINGS, featureFlags: { inGameOverlay: true } })).toBe(false);
  });
});

describe("Teams settings (M-038)", () => {
  it("has the teamBalancer flag, off by default", () => {
    expect(FEATURE_FLAGS.teamBalancer.default).toBe(false);
    expect(FEATURE_FLAGS.teamBalancer.label).toBe("Teams (custom match balancer)");
    expect(isFeatureOn(DEFAULT_SETTINGS, "teamBalancer")).toBe(false);
    expect(DEFAULT_SETTINGS.teamPlayers).toEqual({});
    expect(DEFAULT_SETTINGS.teams).toEqual({ discordWithRank: true, discordWithTag: false, lastGroupId: null });
  });
  it("keeps good teamPlayers and teams", () => {
    const s = parseSettings({
      teamPlayers: { a: { lock: "jungle", mains: ["top", "middle"], ng: ["support"], rankOverride: 1450 } },
      teams: { discordWithRank: false, discordWithTag: true, lastGroupId: 3 },
    });
    expect(s.teamPlayers).toEqual({ a: { lock: "jungle", mains: ["top", "middle"], ng: ["support"], rankOverride: 1450 } });
    expect(s.teams).toEqual({ discordWithRank: false, discordWithTag: true, lastGroupId: 3 });
    expect(parseSettings(s)).toEqual(s);
  });
  it("drops only the broken parts of a person, and broken people", () => {
    const s = parseSettings({
      teamPlayers: {
        a: { lock: "mid", mains: ["top", "top", "x", "bottom", "support"], ng: "top", rankOverride: Number.NaN },
        b: { lock: "support", rankOverride: 12.6 },
        c: 5,
        d: {},
        e: null,
      },
      teams: { discordWithRank: "yes", lastGroupId: 1.5 },
    });
    expect(s.teamPlayers).toEqual({ a: { mains: ["top", "bottom"] }, b: { lock: "support", rankOverride: 13 } });
    expect(s.teams).toEqual({ discordWithRank: true, discordWithTag: false, lastGroupId: null });
    expect(parseSettings({ teamPlayers: [1], teams: "x" })).toMatchObject({ teamPlayers: {}, teams: { discordWithRank: true } });
  });
  it("keeps at most 500 people", () => {
    const many = Object.fromEntries(Array.from({ length: 600 }, (_, i) => [`p${i}`, { lock: "top" }]));
    expect(Object.keys(parseSettings({ teamPlayers: many }).teamPlayers)).toHaveLength(500);
  });
  it("matches the schema defaults", () => {
    expect(SettingsSchema.parse({}).teams).toEqual(DEFAULT_SETTINGS.teams);
  });
});

describe("saved rosters and matchups (M-042)", () => {
  const roster = { id: "r1", name: "Friday 8", puuids: ["a", "b", "c"], savedAt: 5 };
  const slots = (ids: string[], laned: boolean) => ids.map((puuid, i) => ({ puuid, lane: laned ? (["top", "jungle", "middle", "bottom", "support"] as const)[i]! : null }));
  const matchup = (over: Record<string, unknown> = {}) => ({
    id: "m1",
    name: "Good split",
    savedAt: 9,
    blue: slots(["a", "b", "c"], false),
    red: slots(["d", "e", "f"], false),
    people: Object.fromEntries(["a", "b", "c", "d", "e", "f"].map((p) => [p, { gameName: p.toUpperCase(), tagLine: "t", rankLabel: "G2" }])),
    priority: "laneFirst",
    ...over,
  });

  it("defaults to empty lists", () => {
    expect(DEFAULT_SETTINGS.teamRosters).toEqual([]);
    expect(DEFAULT_SETTINGS.teamMatchups).toEqual([]);
    expect(SettingsSchema.parse({}).teamRosters).toEqual([]);
    expect(parseSettings({ teamRosters: "x", teamMatchups: 3 })).toMatchObject({ teamRosters: [], teamMatchups: [] });
  });
  it("keeps good rosters and matchups, and parsing the result again changes nothing", () => {
    const s = parseSettings({ teamRosters: [roster], teamMatchups: [matchup()] });
    expect(s.teamRosters).toEqual([roster]);
    expect(s.teamMatchups).toEqual([matchup()]);
    expect(parseSettings(s)).toEqual(s);
  });
  it("drops only the broken rosters; trims the name; drops bad PUUIDs and repeats", () => {
    const s = parseSettings({
      teamRosters: [
        { ...roster, id: "1", name: "  Trim me  ", puuids: ["a", "a", "b c", 5, "d"] },
        { ...roster, id: "2", name: "   " },
        { ...roster, id: "3", name: "x".repeat(41) },
        { ...roster, id: "4", name: "Empty", puuids: [] },
        { ...roster, id: "5", name: "Too many", puuids: Array.from({ length: 21 }, (_, i) => `p${i}`) },
        { ...roster, id: "1", name: "Same id" },
        { ...roster, id: "6", name: "TRIM ME" },
        { ...roster, id: "", name: "No id" },
        5,
        null,
      ],
    });
    expect(s.teamRosters).toEqual([{ id: "1", name: "Trim me", puuids: ["a", "d"], savedAt: 5 }]);
  });
  it("keeps the newest 50 rosters and 100 matchups", () => {
    const rosters = Array.from({ length: 60 }, (_, i) => ({ ...roster, id: `r${i}`, name: `R${i}`, savedAt: i }));
    const kept = parseSettings({ teamRosters: rosters }).teamRosters;
    expect(kept).toHaveLength(50);
    expect(kept.map((r) => r.savedAt)).toEqual(Array.from({ length: 50 }, (_, i) => i + 10));
    const ms = Array.from({ length: 105 }, (_, i) => matchup({ id: `m${i}`, name: `M${i}`, savedAt: i }));
    expect(parseSettings({ teamMatchups: ms }).teamMatchups).toHaveLength(100);
  });
  it("drops broken matchups only", () => {
    const bad = [
      matchup({ id: "a1", name: "two a side", blue: slots(["a", "b"], false), red: slots(["d", "e"], false) }),
      matchup({ id: "a2", name: "uneven", red: slots(["d", "e", "f", "g"], false) }),
      matchup({ id: "a3", name: "twice", red: slots(["a", "e", "f"], false) }),
      matchup({ id: "a4", name: "mixed lanes", blue: slots(["a", "b", "c"], true) }),
      matchup({ id: "a5", name: "same lane", blue: [{ puuid: "a", lane: "top" }, { puuid: "b", lane: "top" }, { puuid: "c", lane: "mid" }] }),
      matchup({ id: "a6", name: "" }),
      matchup({ id: "a7", name: "bad puuid", blue: slots(["a", "b", "c d"], false) }),
      "x",
    ];
    expect(parseSettings({ teamMatchups: [...bad, matchup()] }).teamMatchups).toEqual([matchup()]);
  });
  it("repairs a broken person label and priority", () => {
    const m = parseSettings({ teamMatchups: [matchup({ priority: "x", people: { a: { gameName: 5 }, b: { gameName: "B", tagLine: "t", rankLabel: "S1", points: 900 } } })] }).teamMatchups[0]!;
    expect(m.priority).toBe("rankFirst");
    expect(m.people.a).toEqual({ gameName: "?", tagLine: "", rankLabel: "—" });
    expect(m.people.b).toEqual({ gameName: "B", tagLine: "t", rankLabel: "S1", points: 900 });
    expect(Object.keys(m.people).sort()).toEqual(["a", "b", "c", "d", "e", "f"]);
  });
});
