/**
 * User settings: schema, defaults, tolerant parsing and validation.
 * Stored by the renderer (localStorage, M-014); a broken value only resets that one item.
 */
import { z } from "zod";

/** Same defaults as the Python app (constants.py DEFAULT_*_URL). */
export const DEFAULT_URL_TEMPLATES = {
  build: "https://lolalytics.com/lol/{name}/build/",
  matchup:
    "https://lolalytics.com/lol/{champion_name1}/vs/{champion_name2}/build/?lane={lane_name}&vslane={lane_name}",
  counter: "https://lolalytics.com/lol/{name}/counters/",
  aram: "https://u.gg/lol/champions/aram/{name}-aram",
  liveGame: "https://u.gg/lol/lg-splash",
} as const;

export const UrlTemplatesSchema = z.object({
  build: z.string(),
  matchup: z.string(),
  counter: z.string(),
  aram: z.string(),
  liveGame: z.string(),
});
export type UrlTemplates = z.infer<typeof UrlTemplatesSchema>;
export type UrlTemplateKey = keyof UrlTemplates;
export const URL_TEMPLATE_KEYS = ["build", "matchup", "counter", "aram", "liveGame"] as const satisfies readonly UrlTemplateKey[];

export const UiSizeSchema = z.enum(["small", "medium", "large"]);
export type UiSize = z.infer<typeof UiSizeSchema>;

export const SIDEBAR_WIDTH_MIN = 240;
export const SIDEBAR_WIDTH_MAX = 480;

export const SettingsSchema = z.object({
  urls: UrlTemplatesSchema.default({ ...DEFAULT_URL_TEMPLATES }),
  uiSize: UiSizeSchema.default("medium"),
  qrButton: z.boolean().default(true),
  sidebarWidth: z.number().min(SIDEBAR_WIDTH_MIN).max(SIDEBAR_WIDTH_MAX).default(300),
  featureFlags: z.record(z.string(), z.boolean()).default({}),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  urls: { ...DEFAULT_URL_TEMPLATES },
  uiSize: "medium",
  qrButton: true,
  sidebarWidth: 300,
  featureFlags: {},
};

/** Feature flag definitions (none yet). Settings keeps the mechanism: name -> default. */
export const FEATURE_FLAGS: Readonly<Record<string, { default: boolean; description: string }>> = {};

/** `--ui-scale` for each UI size. */
export const UI_SCALE: Record<UiSize, number> = { small: 0.9, medium: 1, large: 1.15 };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Parse whatever was stored. Never throws: every broken or missing item falls back
 * to its default on its own (an unknown uiSize becomes "medium"), unknown keys are dropped.
 * A sidebarWidth outside 240-480 is clamped; a blank URL template falls back to its default.
 */
export function parseSettings(input: unknown): Settings {
  const raw = isObject(input) ? input : {};
  const rawUrls = isObject(raw.urls) ? raw.urls : {};
  const urls = { ...DEFAULT_URL_TEMPLATES } as UrlTemplates;
  for (const k of URL_TEMPLATE_KEYS) {
    const v = rawUrls[k];
    if (typeof v === "string" && v.trim() !== "") urls[k] = v;
  }
  const uiSize = UiSizeSchema.safeParse(raw.uiSize);
  const sidebarWidth =
    typeof raw.sidebarWidth === "number" && Number.isFinite(raw.sidebarWidth)
      ? Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(raw.sidebarWidth)))
      : DEFAULT_SETTINGS.sidebarWidth;
  const featureFlags: Record<string, boolean> = {};
  if (isObject(raw.featureFlags)) {
    for (const [k, v] of Object.entries(raw.featureFlags)) if (typeof v === "boolean") featureFlags[k] = v;
  }
  return {
    urls,
    uiSize: uiSize.success ? uiSize.data : DEFAULT_SETTINGS.uiSize,
    qrButton: typeof raw.qrButton === "boolean" ? raw.qrButton : DEFAULT_SETTINGS.qrButton,
    sidebarWidth,
    featureFlags,
  };
}

/** All five templates are required after trimming. Returns the names of the empty ones (empty array = valid). */
export function validateUrlTemplates(urls: UrlTemplates): UrlTemplateKey[] {
  return URL_TEMPLATE_KEYS.filter((k) => (urls[k] ?? "").trim() === "");
}

/** Trim every template (what gets saved after validateUrlTemplates passes). */
export function trimUrlTemplates(urls: UrlTemplates): UrlTemplates {
  return Object.fromEntries(URL_TEMPLATE_KEYS.map((k) => [k, urls[k].trim()])) as UrlTemplates;
}
