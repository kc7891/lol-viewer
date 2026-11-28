/**
 * User settings: schema, defaults, tolerant parsing and validation.
 * Stored by the renderer (localStorage, M-014); a broken value only resets that one item.
 */
import { z } from "zod";
import { isAllowedViewUrl, LaneSchema, OverlayPositionSchema, PROBE_PUUID_RE, type Lane, type OverlayPosition } from "@lol-viewer/protocol";

/** Default URL templates (carried over from the legacy app's defaults). */
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

export { OverlayPositionSchema, type OverlayPosition };
/** Default overlay position: bottom-left (M-035, M-036). */
export const DEFAULT_OVERLAY_POSITION: OverlayPosition = { horizontal: "left", vertical: "bottom" };

export const SIDEBAR_WIDTH_MIN = 240;
export const SIDEBAR_WIDTH_MAX = 480;

/** Manual settings for one person in Teams (M-038), keyed by PUUID. */
export const TeamPlayerPrefSchema = z.object({
  lock: LaneSchema.optional(),
  /** At most 2. */
  mains: z.array(LaneSchema).max(2).optional(),
  ng: z.array(LaneSchema).optional(),
  /** Rank points (see rankPoints). */
  rankOverride: z.number().optional(),
});
export type TeamPlayerPref = z.infer<typeof TeamPlayerPrefSchema>;
export const TEAM_PLAYERS_MAX = 500;

export const TeamsSettingsSchema = z.object({
  discordWithRank: z.boolean().default(true),
  discordWithTag: z.boolean().default(false),
  lastGroupId: z.number().int().nullable().default(null),
});
export type TeamsSettings = z.infer<typeof TeamsSettingsSchema>;
export const DEFAULT_TEAMS_SETTINGS: TeamsSettings = { discordWithRank: true, discordWithTag: false, lastGroupId: null };

/** Saved sets of people and saved team splits (Teams, M-042). */
/** The longest saved name, in characters as a person counts them: Unicode code points (an emoji is 1), not UTF-16 units. */
export const SAVED_NAME_MAX = 40;
/** Characters of a name by that rule (`SAVED_NAME_MAX` is the limit). */
export const nameLength = (name: string): number => Array.from(name).length;
const SavedNameSchema = z
  .string()
  .min(1)
  .max(SAVED_NAME_MAX * 2) // 40 code points are at most 80 UTF-16 units
  .refine((n) => nameLength(n) <= SAVED_NAME_MAX);
export const ROSTER_PUUIDS_MAX = 20;
export const ROSTERS_MAX = 50;
export const MATCHUPS_MAX = 100;

/** The people ticked in Match, saved under a name. Names are unique (any case). */
export const SavedRosterSchema = z.object({
  id: z.string().min(1).max(64),
  name: SavedNameSchema,
  puuids: z.array(z.string().regex(PROBE_PUUID_RE)).min(1).max(ROSTER_PUUIDS_MAX),
  savedAt: z.number(),
});
export type SavedRoster = z.infer<typeof SavedRosterSchema>;

const SavedSlotSchema = z.object({ puuid: z.string().regex(PROBE_PUUID_RE), lane: LaneSchema.nullable() });
/** What is shown for a person when the cache has forgotten them; `points` lets Copy for Discord work out the average. */
export const SavedPersonSchema = z.object({
  gameName: z.string().max(64),
  tagLine: z.string().max(32),
  rankLabel: z.string().max(32),
  points: z.number().nullable().optional(),
});
export type SavedPerson = z.infer<typeof SavedPersonSchema>;
export const SavedMatchupSchema = z.object({
  id: z.string().min(1).max(64),
  name: SavedNameSchema,
  savedAt: z.number(),
  blue: z.array(SavedSlotSchema).min(3).max(5),
  red: z.array(SavedSlotSchema).min(3).max(5),
  people: z.record(z.string(), SavedPersonSchema),
  priority: z.enum(["rankFirst", "laneFirst"]),
});
export type SavedMatchup = z.infer<typeof SavedMatchupSchema>;

export const SettingsSchema = z.object({
  urls: UrlTemplatesSchema.default({ ...DEFAULT_URL_TEMPLATES }),
  uiSize: UiSizeSchema.default("medium"),
  qrButton: z.boolean().default(true),
  sidebarWidth: z.number().min(SIDEBAR_WIDTH_MIN).max(SIDEBAR_WIDTH_MAX).default(300),
  featureFlags: z.record(z.string(), z.boolean()).default({}),
  overlayPosition: OverlayPositionSchema.default({ ...DEFAULT_OVERLAY_POSITION }),
  teamPlayers: z.record(z.string(), TeamPlayerPrefSchema).default({}),
  teams: TeamsSettingsSchema.default({ ...DEFAULT_TEAMS_SETTINGS }),
  teamRosters: z.array(SavedRosterSchema).max(ROSTERS_MAX).default([]),
  teamMatchups: z.array(SavedMatchupSchema).max(MATCHUPS_MAX).default([]),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  urls: { ...DEFAULT_URL_TEMPLATES },
  uiSize: "medium",
  qrButton: true,
  sidebarWidth: 300,
  featureFlags: {},
  overlayPosition: { ...DEFAULT_OVERLAY_POSITION },
  teamPlayers: {},
  teams: { ...DEFAULT_TEAMS_SETTINGS },
  teamRosters: [],
  teamMatchups: [],
};

export type FeatureFlagDef = { label: string; description: string; default: boolean };

/** Feature flag definitions. Settings > Feature flags lists them; the stored value wins over the default. */
export const FEATURE_FLAGS = {
  liveClientData: {
    label: "Live game data",
    description:
      "During a game, read the game's Live Client Data API on this PC (127.0.0.1:2999) every 2 seconds: " +
      "item gold differences in the matchup, and rows moved to the real lanes. Off: no requests are made.",
    default: false,
  },
  inGameOverlay: {
    label: "In-game overlay (hold Tab)",
    description:
      "While you hold Tab in a game, show the matchup's item gold differences over the game window. " +
      "Needs Live game data, Windows, and League's Window Mode set to Windowed or Borderless (not shown over Full Screen). " +
      "Off: the key is never read.",
    default: false,
  },
  teamBalancer: {
    label: "Teams (custom match balancer)",
    description:
      "Split the members of a custom lobby into teams by rank and preferred lanes. " +
      "On: reads ranks and match history from the League Client and caches them on this PC. Off: nothing is read or stored.",
    default: false,
  },
} as const satisfies Record<string, FeatureFlagDef>;
export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;
export const FEATURE_FLAG_KEYS = Object.keys(FEATURE_FLAGS) as FeatureFlagKey[];

export function isFeatureOn(s: Settings, key: FeatureFlagKey): boolean {
  return s.featureFlags[key] ?? FEATURE_FLAGS[key].default;
}
/** Every defined flag back to its default; unknown stored keys are kept (M-016). */
export function resetFeatureFlags(flags: Record<string, boolean>): Record<string, boolean> {
  return { ...flags, ...Object.fromEntries(FEATURE_FLAG_KEYS.map((k) => [k, FEATURE_FLAGS[k].default])) };
}
export const flagsAtDefaults = (s: Settings): boolean => FEATURE_FLAG_KEYS.every((k) => isFeatureOn(s, k) === FEATURE_FLAGS[k].default);

/** `--ui-scale` for each UI size. */
export const UI_SCALE: Record<UiSize, number> = { small: 0.9, medium: 1, large: 1.15 };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const uniqueLanes = (v: unknown, max: number): Lane[] => {
  if (!Array.isArray(v)) return [];
  const out: Lane[] = [];
  for (const x of v) {
    const r = LaneSchema.safeParse(x);
    if (r.success && !out.includes(r.data)) out.push(r.data);
  }
  return out.slice(0, max);
};

/** Tolerant parse of `teamPlayers`: a broken field or person is dropped on its own; at most 500 people. */
export function parseTeamPlayers(input: unknown): Record<string, TeamPlayerPref> {
  const out: Record<string, TeamPlayerPref> = {};
  if (!isObject(input)) return out;
  for (const [id, v] of Object.entries(input)) {
    if (Object.keys(out).length >= TEAM_PLAYERS_MAX) break;
    if (id === "" || id.length > 100 || !isObject(v)) continue;
    const pref: TeamPlayerPref = {};
    const lock = LaneSchema.safeParse(v.lock);
    if (lock.success) pref.lock = lock.data;
    const mains = uniqueLanes(v.mains, 2);
    if (mains.length) pref.mains = mains;
    const ng = uniqueLanes(v.ng, 5);
    if (ng.length) pref.ng = ng;
    if (typeof v.rankOverride === "number" && Number.isFinite(v.rankOverride)) pref.rankOverride = Math.max(0, Math.round(v.rankOverride));
    if (Object.keys(pref).length) out[id] = pref;
  }
  return out;
}

/** Keep the newest `max` items (by savedAt), in their stored order. */
function capNewest<T extends { savedAt: number }>(list: T[], max: number): T[] {
  if (list.length <= max) return list;
  const keep = new Set([...list].sort((a, b) => b.savedAt - a.savedAt).slice(0, max));
  return list.filter((x) => keep.has(x));
}

/** A saved name: trimmed, 1-40 characters (code points); null when it is not. */
const goodName = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length >= 1 && nameLength(t) <= SAVED_NAME_MAX ? t : null;
};

/** Shared by both lists: a unique id and a unique name (any case); the first one wins. */
function uniqueIdName<T extends { id: string; name: string }>(list: T[]): T[] {
  const ids = new Set<string>();
  const names = new Set<string>();
  return list.filter((x) => {
    const n = x.name.toLowerCase();
    if (ids.has(x.id) || names.has(n)) return false;
    ids.add(x.id);
    names.add(n);
    return true;
  });
}

/** Tolerant parse of `teamRosters`: a broken roster is dropped on its own; at most 50 (the oldest go first). */
export function parseTeamRosters(input: unknown): SavedRoster[] {
  if (!Array.isArray(input)) return [];
  const out: SavedRoster[] = [];
  for (const v of input) {
    if (!isObject(v) || !Array.isArray(v.puuids)) continue;
    const name = goodName(v.name);
    const puuids = [...new Set(v.puuids.filter((p): p is string => typeof p === "string" && PROBE_PUUID_RE.test(p)))];
    if (name === null || puuids.length < 1 || puuids.length > ROSTER_PUUIDS_MAX) continue;
    const r = SavedRosterSchema.safeParse({ id: v.id, name, puuids, savedAt: typeof v.savedAt === "number" && Number.isFinite(v.savedAt) ? v.savedAt : 0 });
    if (r.success) out.push(r.data);
  }
  return capNewest(uniqueIdName(out), ROSTERS_MAX);
}

function parseSlots(v: unknown): { puuid: string; lane: Lane | null }[] | null {
  if (!Array.isArray(v)) return null;
  const out: { puuid: string; lane: Lane | null }[] = [];
  for (const s of v) {
    if (!isObject(s) || typeof s.puuid !== "string" || !PROBE_PUUID_RE.test(s.puuid)) return null;
    const lane = s.lane === null || s.lane === undefined ? null : LaneSchema.safeParse(s.lane);
    if (lane !== null && !lane.success) return null;
    out.push({ puuid: s.puuid, lane: lane === null ? null : lane.data });
  }
  return out;
}

/**
 * Tolerant parse of `teamMatchups`: a broken matchup is dropped on its own (3-5 people a side, the same number on both sides,
 * nobody twice, lanes all set and different in a team or all null); a broken person label becomes `?` / `—`; at most 100.
 */
export function parseTeamMatchups(input: unknown): SavedMatchup[] {
  if (!Array.isArray(input)) return [];
  const out: SavedMatchup[] = [];
  for (const v of input) {
    if (!isObject(v)) continue;
    const name = goodName(v.name);
    const blue = parseSlots(v.blue);
    const red = parseSlots(v.red);
    if (name === null || !blue || !red || blue.length < 3 || blue.length > 5 || blue.length !== red.length) continue;
    const all = [...blue, ...red];
    if (new Set(all.map((s) => s.puuid)).size !== all.length) continue;
    const laned = all.every((s) => s.lane !== null);
    if (!laned && all.some((s) => s.lane !== null)) continue;
    if (laned && [blue, red].some((t) => new Set(t.map((s) => s.lane)).size !== t.length)) continue;
    const rawPeople = isObject(v.people) ? v.people : {};
    const people: Record<string, SavedPerson> = {};
    for (const s of all) {
      const p = rawPeople[s.puuid];
      const o = isObject(p) ? p : {};
      const str = (x: unknown, fallback: string, max: number) => (typeof x === "string" ? x.slice(0, max) : fallback);
      people[s.puuid] = {
        gameName: str(o.gameName, "?", 64),
        tagLine: str(o.tagLine, "", 32),
        rankLabel: str(o.rankLabel, "—", 32),
        ...(typeof o.points === "number" && Number.isFinite(o.points) ? { points: o.points } : o.points === null ? { points: null } : {}),
      };
    }
    const r = SavedMatchupSchema.safeParse({
      id: v.id,
      name,
      savedAt: typeof v.savedAt === "number" && Number.isFinite(v.savedAt) ? v.savedAt : 0,
      blue,
      red,
      people,
      priority: v.priority === "laneFirst" ? "laneFirst" : "rankFirst",
    });
    if (r.success) out.push(r.data);
  }
  return capNewest(uniqueIdName(out), MATCHUPS_MAX);
}

function parseTeamsSettings(input: unknown): TeamsSettings {
  const raw = isObject(input) ? input : {};
  return {
    discordWithRank: typeof raw.discordWithRank === "boolean" ? raw.discordWithRank : DEFAULT_TEAMS_SETTINGS.discordWithRank,
    discordWithTag: typeof raw.discordWithTag === "boolean" ? raw.discordWithTag : DEFAULT_TEAMS_SETTINGS.discordWithTag,
    lastGroupId: typeof raw.lastGroupId === "number" && Number.isInteger(raw.lastGroupId) ? raw.lastGroupId : null,
  };
}

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
  const rawPos = isObject(raw.overlayPosition) ? raw.overlayPosition : {};
  const horizontal = OverlayPositionSchema.shape.horizontal.safeParse(rawPos.horizontal);
  const vertical = OverlayPositionSchema.shape.vertical.safeParse(rawPos.vertical);
  const overlayPosition: OverlayPosition = {
    horizontal: horizontal.success ? horizontal.data : DEFAULT_OVERLAY_POSITION.horizontal,
    vertical: vertical.success ? vertical.data : DEFAULT_OVERLAY_POSITION.vertical,
  };
  return {
    urls,
    uiSize: uiSize.success ? uiSize.data : DEFAULT_SETTINGS.uiSize,
    qrButton: typeof raw.qrButton === "boolean" ? raw.qrButton : DEFAULT_SETTINGS.qrButton,
    sidebarWidth,
    featureFlags,
    overlayPosition,
    teamPlayers: parseTeamPlayers(raw.teamPlayers),
    teams: parseTeamsSettings(raw.teams),
    teamRosters: parseTeamRosters(raw.teamRosters),
    teamMatchups: parseTeamMatchups(raw.teamMatchups),
  };
}

/** All five templates are required after trimming. Returns the names of the empty ones (empty array = valid). */
export type UrlTemplateProblem = "empty" | "host";

/**
 * What is wrong with one template: empty, or (with sample values substituted) not an https URL.
 * Any host is accepted; the desktop app refuses non-https pages, so saving one would leave
 * every viewer blank (M-016).
 */
export function urlTemplateProblem(template: string): UrlTemplateProblem | null {
  const t = (template ?? "").trim();
  if (t === "") return "empty";
  const sample = t
    .replaceAll("{champion_name1}", "ahri")
    .replaceAll("{champion_name2}", "zed")
    .replaceAll("{name}", "ahri")
    .replaceAll("{lane_name}", "middle");
  return isAllowedViewUrl(sample) ? null : "host";
}

/** Keys whose template has a problem (see urlTemplateProblem). Empty list = savable. */
export function validateUrlTemplates(urls: UrlTemplates): UrlTemplateKey[] {
  return URL_TEMPLATE_KEYS.filter((k) => urlTemplateProblem(urls[k]) != null);
}

/** Trim every template (what gets saved after validateUrlTemplates passes). */
export function trimUrlTemplates(urls: UrlTemplates): UrlTemplates {
  return Object.fromEntries(URL_TEMPLATE_KEYS.map((k) => [k, urls[k].trim()])) as UrlTemplates;
}
