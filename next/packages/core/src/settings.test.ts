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
    expect(UI_SCALE).toEqual({ small: 0.9, medium: 1, large: 1.15 });
  });
});

describe("parseSettings", () => {
  it.each([undefined, null, 5, "x", [], {}])("%j gives the defaults", (input) => {
    expect(parseSettings(input)).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps good values", () => {
    const s = { urls: { ...DEFAULT_URL_TEMPLATES, build: "https://x.test/{name}" }, uiSize: "large", qrButton: false, sidebarWidth: 400, featureFlags: { a: true } };
    expect(parseSettings(s)).toEqual(s);
  });

  it("repairs each broken item on its own", () => {
    const s = parseSettings({
      urls: { build: 5, matchup: "  ", counter: "https://c.test/{name}" },
      uiSize: "huge",
      qrButton: "yes",
      sidebarWidth: "wide",
      featureFlags: { ok: true, bad: 1 },
      unknown: 1,
    });
    expect(s).toEqual({
      urls: { ...DEFAULT_URL_TEMPLATES, counter: "https://c.test/{name}" },
      uiSize: "medium",
      qrButton: true,
      sidebarWidth: 300,
      featureFlags: { ok: true },
    });
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
    expect(resetFeatureFlags({ liveClientData: true, unknown: true })).toEqual({ liveClientData: false, unknown: true });
  });
});
