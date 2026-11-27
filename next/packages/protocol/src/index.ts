/**
 * @lol-viewer/protocol — the single contract shared by every layer.
 *
 * - LCU payload subsets (what we read from the League Client)
 * - LcuEvent (what the LCU adapter hands to core)
 * - MatchState (what the Hub publishes; what every UI renders)
 * - External view commands (renderer -> main, validated at the IPC boundary)
 *
 * Every boundary (IPC, WebSocket, fixtures) parses with these schemas, so a
 * malformed message is rejected at the edge instead of crashing a reducer.
 */
import { z } from "zod";

export const PROTOCOL_VERSION = 3 as const;

// ── Shared primitives ──────────────────────────────────────────────

export const LaneSchema = z.enum(["top", "jungle", "middle", "bottom", "support"]);
export type Lane = z.infer<typeof LaneSchema>;
/** Row order of the matchup table (Top, Jungle, Mid, Bot, Support). */
export const LANES: readonly Lane[] = LaneSchema.options;

export const ConnectionStatusSchema = z.enum(["connecting", "connected", "disconnected"]);
export type ConnectionStatus = z.infer<typeof ConnectionStatusSchema>;

/** Gameflow phases we care about; anything else is kept as a plain string. */
export const GamePhaseSchema = z.string();
export type GamePhase = z.infer<typeof GamePhaseSchema>;

/** Summoner ids are numbers in the LCU; recordings replace them with pseudonym strings. */
const PlayerIdSchema = z.union([z.number(), z.string()]);

// ── LCU payload subsets (read-only views of what the client sends) ─

export const ChampSelectPlayerSchema = z.looseObject({
  cellId: z.number(),
  championId: z.number().default(0),
  championPickIntent: z.number().optional(),
  assignedPosition: z.string().optional(),
  summonerId: PlayerIdSchema.optional(),
  puuid: z.string().optional(),
});

export const ChampSelectSessionSchema = z.looseObject({
  gameId: z.number().optional(),
  localPlayerCellId: z.number(),
  myTeam: z.array(ChampSelectPlayerSchema).default([]),
  theirTeam: z.array(ChampSelectPlayerSchema).default([]),
});
export type ChampSelectSession = z.infer<typeof ChampSelectSessionSchema>;

export const GameflowTeamMemberSchema = z.looseObject({
  championId: z.number().optional(),
  summonerId: PlayerIdSchema.optional(),
  puuid: z.string().optional(),
});

export const GameflowSessionSchema = z.looseObject({
  phase: z.string().optional(),
  gameData: z
    .looseObject({
      gameId: z.number().optional(),
      /** The client has sent a bare number, `{id}` and `{queueId}` here; core normalizes it. */
      queue: z.unknown().optional(),
      gameMode: z.string().optional(),
      teamOne: z.array(GameflowTeamMemberSchema).optional(),
      teamTwo: z.array(GameflowTeamMemberSchema).optional(),
    })
    .optional(),
});
export type GameflowSession = z.infer<typeof GameflowSessionSchema>;

export const CurrentSummonerSchema = z.looseObject({
  summonerId: PlayerIdSchema.optional(),
  puuid: z.string().optional(),
});
export type CurrentSummoner = z.infer<typeof CurrentSummonerSchema>;

// ── Live Client Data API payload subsets (in-game, 127.0.0.1:2999) ──

export const LiveClientItemSchema = z.looseObject({
  itemID: z.number(),
  count: z.number().optional(),
  /** Meaning not documented (own price vs. combine cost); only a fallback for unknown items (M-026). */
  price: z.number().optional(),
  consumable: z.boolean().optional(),
});

export const LiveClientSpellSchema = z.looseObject({
  displayName: z.string().optional(),
  rawDisplayName: z.string().optional(),
  rawDescription: z.string().optional(),
});

export const LiveClientPlayerSchema = z.looseObject({
  championName: z.string().optional(),
  /** "game_character_displayname_<Data Dragon id>", e.g. "..._MonkeyKing". */
  rawChampionName: z.string().optional(),
  /** "ORDER" | "CHAOS" (anything else is ignored). */
  team: z.string().optional(),
  /** "TOP" | "JUNGLE" | "MIDDLE" | "BOTTOM" | "UTILITY" | "" (blind, ARAM, custom). */
  position: z.string().optional(),
  level: z.number().optional(),
  items: z.array(LiveClientItemSchema).optional(),
  summonerSpells: z
    .looseObject({ summonerSpellOne: LiveClientSpellSchema.optional(), summonerSpellTwo: LiveClientSpellSchema.optional() })
    .optional(),
});
export type LiveClientPlayer = z.infer<typeof LiveClientPlayerSchema>;

// ── LcuEvent: adapter -> core ──────────────────────────────────────

/** One player of /liveclientdata/playerlist, reduced to facts (no names). Built by core.toLcuEvent. */
export const LivePlayerFactSchema = z.object({
  championId: z.number().int().positive(),
  team: z.enum(["ORDER", "CHAOS"]),
  /** From `position`; when that is empty, Smite => "jungle"; otherwise null. */
  lane: LaneSchema.nullable(),
  level: z.number().int().nonnegative(),
  /** Estimated gold: sum of item values (M-026). */
  itemGold: z.number().int().nonnegative(),
});
export type LivePlayerFact = z.infer<typeof LivePlayerFactSchema>;

export const LcuEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("connection"), status: ConnectionStatusSchema }),
  z.object({ type: z.literal("gameflow-phase"), phase: GamePhaseSchema }),
  z.object({ type: z.literal("gameflow-session"), session: GameflowSessionSchema.nullable() }),
  z.object({ type: z.literal("champ-select-session"), session: ChampSelectSessionSchema.nullable() }),
  z.object({ type: z.literal("current-summoner"), summoner: CurrentSummonerSchema.nullable() }),
  /** Live Client Data API (in game). null = the list is gone (Delete / flag turned off). */
  z.object({ type: z.literal("live-players"), players: z.array(LivePlayerFactSchema).nullable() }),
]);
export type LcuEvent = z.infer<typeof LcuEventSchema>;

// ── MatchState: Hub -> every UI ────────────────────────────────────
//
// MatchState carries what the League Client tells us, nothing the user did.
// The matchup table, the viewer list and the pending enemy picks are the
// renderer's Workspace (packages/core/src/workspace.ts), derived from a
// sequence of MatchState snapshots plus user actions.

export const AllySchema = z.object({
  championId: z.number().int().positive(),
  /** Assigned position from champ select; null in blind pick, ARAM and in-game data. */
  lane: LaneSchema.nullable(),
});
export type Ally = z.infer<typeof AllySchema>;

export const SelfPickSchema = z.object({
  championId: z.number().int().positive(),
  lane: LaneSchema.nullable(),
});
export type SelfPick = z.infer<typeof SelfPickSchema>;

export const LivePlayerSchema = z.object({
  championId: z.number().int().positive(),
  /** Relative to me (M-029). */
  team: z.enum(["ally", "enemy"]),
  lane: LaneSchema.nullable(),
  level: z.number().int().nonnegative(),
  itemGold: z.number().int().nonnegative(),
});
export type LivePlayer = z.infer<typeof LivePlayerSchema>;

export const MatchStateSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  connection: ConnectionStatusSchema,
  phase: GamePhaseSchema,
  /**
   * Increments every time a new match starts (ChampSelect entered from another
   * phase, or the champ-select gameId changes). UIs close every viewer on change (M-001).
   */
  matchSeq: z.number().int().nonnegative(),
  gameId: z.number().nullable(),
  queueId: z.number().nullable(),
  gameMode: z.string().nullable(),
  /** ARAM / ARAM: Mayhem queue or gameMode "ARAM": my pick opens the ARAM page. */
  isAram: z.boolean(),
  /**
   * My champion (hover included, M-002) and assigned lane. Kept when championId
   * drops back to 0; cleared on a new match and in None/Lobby.
   */
  self: SelfPickSchema.nullable(),
  /** Picked allies in myTeam order (in game: from gameflow teams, lane null). */
  allies: z.array(AllySchema),
  /** Picked enemies in theirTeam (= pick) order (in game: from gameflow teams). */
  enemies: z.array(z.number().int().positive()),
  /**
   * In game only (phase InProgress) and only while the liveClientData feature flag is on:
   * every player of the Live Client player list, in its order. null otherwise, and when my
   * team could not be told (M-029). No names.
   */
  live: z.array(LivePlayerSchema).nullable().default(null),
});
export type MatchState = z.infer<typeof MatchStateSchema>;

// ── Hub wire messages (WebSocket / IPC push) ───────────────────────

export const HubMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("snapshot"), state: MatchStateSchema }),
]);
export type HubMessage = z.infer<typeof HubMessageSchema>;

// ── External views (renderer -> main) ──────────────────────────────

export const RectSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
});
export type Rect = z.infer<typeof RectSchema>;

export const ViewIdSchema = z.string().regex(/^[a-z0-9:_-]{1,64}$/);

/**
 * Any https URL may be loaded in-app (the user chooses the Analytics URLs in Settings).
 * External views are sandboxed with no preload / Node, so the host is not restricted;
 * only the scheme is (no http:, file:, javascript:, ...).
 */
export function isAllowedViewUrl(raw: string): boolean {
  try {
    return new URL(raw).protocol === "https:";
  } catch {
    return false;
  }
}

/** Analytics sites that are always trusted to navigate inside a view (besides the view's own site). */
export const KNOWN_VIEW_HOSTS = ["lolalytics.com", "u.gg", "op.gg"] as const;

function sameSite(host: string, base: string): boolean {
  return host === base || host.endsWith(`.${base}`) || base.endsWith(`.${host}`);
}

/**
 * Whether a link click / redirect inside a view that was opened at `homeUrl` may stay in the
 * view. Everything else is handed to the user's browser.
 */
export function isTrustedNavigation(homeUrl: string, target: string): boolean {
  if (!isAllowedViewUrl(target)) return false;
  const host = new URL(target).hostname;
  if (KNOWN_VIEW_HOSTS.some((h) => sameSite(host, h))) return true;
  try {
    return sameSite(host, new URL(homeUrl).hostname);
  } catch {
    return false;
  }
}

export const ViewUrlSchema = z.string().refine(isAllowedViewUrl, "URL host is not allow-listed");

export const ViewCommandSchema = z.discriminatedUnion("type", [
  /** Show the view at bounds and load url. Same url is not reloaded unless force (re-open, M-008 nav). */
  z.object({
    type: z.literal("attach"),
    viewId: ViewIdSchema,
    url: ViewUrlSchema,
    bounds: RectSchema,
    force: z.boolean().optional(),
  }),
  z.object({ type: z.literal("setBounds"), viewId: ViewIdSchema, bounds: RectSchema }),
  z.object({ type: z.literal("setVisible"), viewId: ViewIdSchema, visible: z.boolean() }),
  z.object({ type: z.literal("detach"), viewId: ViewIdSchema }),
  z.object({
    type: z.literal("navigate"),
    viewId: ViewIdSchema,
    action: z.enum(["back", "forward", "reload", "openExternal"]),
  }),
]);
export type ViewCommand = z.infer<typeof ViewCommandSchema>;

export const ViewStatusSchema = z.object({
  viewId: ViewIdSchema,
  status: z.enum(["loading", "ready", "error"]),
  /** Current URL, including in-page navigation inside the third-party site. */
  url: z.string(),
  title: z.string(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
});
export type ViewStatus = z.infer<typeof ViewStatusSchema>;

// ── Bridge: what the UI talks to (Electron preload, mock, or Hub WebSocket) ──

export interface ViewsApi {
  command(cmd: ViewCommand): void;
  onStatus(cb: (s: ViewStatus) => void): () => void;
}

export interface LolViewerBridge {
  readonly kind: "electron" | "mock" | "hub";
  onState(cb: (s: MatchState) => void): () => void;
  /** Present only where native external views exist (Electron). */
  readonly views?: ViewsApi;
  /** Present only in the desktop app. */
  readonly recorder?: RecorderApi;
  /** Present only where a real LCU connector runs (desktop app). */
  readonly lcu?: LcuControlApi;
  /** Present only in the desktop app. */
  readonly app?: AppApi;
  /** Present only in the desktop app. */
  readonly updates?: UpdatesApi;
  /** Present only in the desktop app. */
  readonly live?: LiveClientControlApi;
  /** Present only in the desktop app. */
  readonly overlay?: OverlayControlApi;
  /** Present only in the desktop app (Teams, M-038). */
  readonly teams?: TeamsApi;
}

/** Matchup rows the in-game overlay draws: champion ids in lane order (top, jungle, middle, bottom, support). */
export const OverlayRowsSchema = z
  .array(z.object({ ally: z.number().int().nullable(), enemy: z.number().int().nullable() }))
  .length(5);
export type OverlayRows = z.infer<typeof OverlayRowsSchema>;

/** Where the in-game overlay sits on the game window (M-036). */
export const OverlayPositionSchema = z.object({
  horizontal: z.enum(["left", "center", "right"]),
  vertical: z.enum(["top", "bottom"]),
});
export type OverlayPosition = z.infer<typeof OverlayPositionSchema>;

export interface OverlayControlApi {
  /** Feature flags liveClientData AND inGameOverlay (M-034): main reads the Tab key only while this is true, in a game, on Windows. */
  setEnabled(enabled: boolean): void;
  /** The matchup table as the main window shows it (after the lane correction and the user's swaps). */
  setRows(rows: OverlayRows): void;
  /** Where the table sits on the game window (M-036); main moves the overlay at once when it is visible. */
  setPosition(pos: OverlayPosition): void;
}

/** What the overlay window's own preload exposes: receive-only, nothing to send. */
export interface LolOverlayBridge {
  onState(cb: (s: MatchState) => void): () => void;
  onRows(cb: (rows: OverlayRows) => void): () => void;
}

export interface LiveClientControlApi {
  /** Feature flag liveClientData (M-025): main polls the Live Client Data API only while this is true and a game is in progress. */
  setEnabled(enabled: boolean): void;
}

export interface LcuControlApi {
  /** Settings "Reconnect": drop the connection, rediscover credentials now, reset backoff. */
  reconnect(): void;
  /** Matchup "Refresh": re-read every subscribed path (GET) and dispatch it again. */
  resync(): void;
  /** Settings "LCU check" (M-039): GET the probe routes once each; the text holds no names or IDs. Desktop only. */
  probe?(opts: LcuProbeOptions): Promise<LcuProbeResult>;
  /** Progress of a running probe (steps done / total). */
  onProbeProgress?(cb: (p: LcuProbeProgress) => void): () => void;
}

// ── LCU check (Settings; M-039) ──

/** GET-only routes the LCU check may read. The path templates live in packages/lcu (PROBE_ROUTES). */
export const PROBE_ROUTE_IDS = [
  "currentSummoner",
  "lobby",
  "friendGroups",
  "friendGroupFriends",
  "friends",
  "rankedStats",
  "rankedStatsBatch",
  "matches",
  "game",
  "recentlyPlayed",
  "summonerByName",
  "summonerByPuuid",
  "summonerByPuuidCached",
] as const;
export type ProbeRouteId = (typeof PROBE_ROUTE_IDS)[number];

/** How a list of PUUIDs is put into the query string (the LCU's real format is not known; the check tries all three). */
export type ProbeListStyle = "json" | "comma" | "repeat";
export type ProbeQueryValue = string | number | { list: string[]; style: ProbeListStyle };
export type ProbeBuildArgs = { params?: Record<string, string | number>; query?: Record<string, ProbeQueryValue> };

/** Result of one probe GET. status 0 = no HTTP response (see error). */
export type ProbeResponse = {
  status: number;
  ms: number;
  body: unknown | null;
  error?: "timeout" | "network" | "bad-json";
  /** The response had a Retry-After header (rate test). */
  retryAfter?: boolean;
};

/** PUUID as the LCU sends it (78 chars of [A-Za-z0-9_-]); fake scenarios use `player-<n>`. */
export const PROBE_PUUID_RE = /^[A-Za-z0-9_-]{1,100}$/;

/** `name#tag`: name 1-32 chars, tag 1-8 chars, exactly one `#`, no control characters. */
export function isValidRiotId(s: string): boolean {
  if (/[\u0000-\u001f\u007f]/.test(s)) return false;
  const parts = s.split("#");
  if (parts.length !== 2) return false;
  const [name, tag] = parts as [string, string];
  return name.length >= 1 && name.length <= 32 && tag.length >= 1 && tag.length <= 8;
}

export const LcuProbeOptionsSchema = z.object({
  riotId: z
    .string()
    .max(48)
    .refine((s) => s === "" || isValidRiotId(s), "invalid Riot ID")
    .optional(),
  rateTest: z.boolean().default(false),
});
export type LcuProbeOptions = z.input<typeof LcuProbeOptionsSchema>;

export type ProbeFactValue = string | number | boolean;
export type ProbeStep = {
  n: number;
  name: string;
  route: ProbeRouteId;
  status: number | "skipped";
  ms: number;
  /** Fixed wording only (a skip reason, "not in a lobby"); never a value from the client. */
  note?: string;
  /** Structure of the JSON (keys and types, no personal values). */
  shape?: string;
  /** Counts, yes/no and allow-listed values. */
  facts?: Record<string, ProbeFactValue>;
};
export type ProbeRate = {
  requests: number;
  /** HTTP status (or "err") -> how many. */
  statusCounts: Record<string, number>;
  minMs: number;
  medianMs: number;
  maxMs: number;
  retryAfter: boolean;
};
export type LcuProbeReport = {
  startedAt: string;
  appVersion: string;
  platform: string;
  steps: ProbeStep[];
  rate?: ProbeRate;
};
export type LcuProbeProgress = { done: number; total: number };
export type LcuProbeResult = { text: string; report: LcuProbeReport };

export const AppInfoSchema = z.object({
  version: z.string(),
  platform: z.string(),
});
export type AppInfo = z.infer<typeof AppInfoSchema>;

export interface AppApi {
  info(): Promise<AppInfo>;
}

// ── Updates (desktop only; electron-updater, see docs/spec/new-app-design.md §6) ──

export const UpdateStatusSchema = z.object({
  state: z.enum([
    /** Not packaged, E2E, or LOL_VIEWER_DISABLE_UPDATES: updates are never checked. */
    "unsupported",
    "idle",
    "checking",
    "not-available",
    "available",
    "downloading",
    "downloaded",
    "error",
  ]),
  currentVersion: z.string(),
  /** Known once a check succeeded. */
  latestVersion: z.string().nullable(),
  /** 0-100 while downloading. */
  percent: z.number().min(0).max(100).nullable(),
  /** Short, plain-text message for "error". */
  error: z.string().nullable(),
});
export type UpdateStatus = z.infer<typeof UpdateStatusSchema>;

export interface UpdatesApi {
  status(): Promise<UpdateStatus>;
  onStatus(cb: (s: UpdateStatus) => void): () => void;
  check(): void;
  download(): void;
  /** Quit, run the installer and restart. Only meaningful in "downloaded". */
  install(): void;
}

// ── Static champion data (generated from Data Dragon; see tools/champion-data) ──

export const SpellKeySchema = z.enum(["Q", "W", "E", "R"]);
export type SpellKey = z.infer<typeof SpellKeySchema>;

export const ChampionSpellSchema = z.object({
  key: SpellKeySchema,
  name: z.string().min(1),
  nameJa: z.string().min(1),
  maxrank: z.number().int().min(1).max(6),
  /** Base cooldown (seconds) per rank; length === maxrank. No ability haste applied. */
  cooldown: z.array(z.number().nonnegative()),
});
export type ChampionSpell = z.infer<typeof ChampionSpellSchema>;

const LaneScoreSchema = z.number().int().min(0).max(5);

export const ChampionEntrySchema = z.object({
  /** Numeric id the League Client uses (Data Dragon `key`). */
  id: z.number().int().positive(),
  /** Data Dragon id, also the image name (e.g. "MonkeyKing"). */
  ddragonId: z.string().min(1),
  /** URL name used by lolalytics / u.gg (e.g. "wukong"). */
  slug: z.string().regex(/^[a-z0-9]+$/),
  name: z.string().min(1),
  nameJa: z.string().min(1),
  /**
   * Lane suitability 0-5 from champion_lane.csv (0 for champions missing from the CSV).
   * Used to place enemies / lane-less allies into matchup rows.
   */
  lanes: z.object({
    top: LaneScoreSchema,
    jungle: LaneScoreSchema,
    middle: LaneScoreSchema,
    bottom: LaneScoreSchema,
    support: LaneScoreSchema,
  }),
  spells: z.array(ChampionSpellSchema).length(4),
});
export type ChampionEntry = z.infer<typeof ChampionEntrySchema>;

export const ChampionDataSchema = z.object({
  source: z.literal("Data Dragon"),
  /** Data Dragon version, e.g. "16.23.1". */
  patch: z.string().regex(/^\d+\.\d+\.\d+$/),
  champions: z.array(ChampionEntrySchema).min(1),
});
export type ChampionData = z.infer<typeof ChampionDataSchema>;

// ── Static item data (generated from Data Dragon item.json; see tools/champion-data) ──
export const ItemDataSchema = z.object({
  source: z.literal("Data Dragon"),
  patch: z.string().regex(/^\d+\.\d+\.\d+$/),
  /** item id (string key) -> gold counted for the item (gold.total; 0 when consumed on use). */
  items: z.record(z.string().regex(/^\d+$/), z.number().int().nonnegative()),
});
export type ItemData = z.infer<typeof ItemDataSchema>;

// ── Session recorder (desktop only) ────────────────────────────────

export const RecorderStatusSchema = z.object({
  recording: z.boolean(),
  /** File being written (while recording) or the last finished file. */
  file: z.string().nullable(),
  lines: z.number().int().nonnegative(),
  startedAt: z.number().nullable(),
  folder: z.string(),
});
export type RecorderStatus = z.infer<typeof RecorderStatusSchema>;

export interface RecorderApi {
  start(): Promise<RecorderStatus>;
  stop(): Promise<RecorderStatus>;
  status(): Promise<RecorderStatus>;
  openFolder(): void;
  onStatus(cb: (s: RecorderStatus) => void): () => void;
}

// ── Teams (custom match balancer; M-038) ──

export const RankEntrySchema = z.object({ tier: z.string(), division: z.string(), lp: z.number().int(), points: z.number() });
export type RankEntry = z.infer<typeof RankEntrySchema>;
export const PlayerRankSchema = z.object({
  solo: RankEntrySchema.nullable(),
  flex: RankEntrySchema.nullable(),
  prevSeason: RankEntrySchema.nullable(),
  fetchedAt: z.number(),
});
export type PlayerRank = z.infer<typeof PlayerRankSchema>;
export const LaneProfileSchema = z.object({
  /** Counted games per lane. */
  counts: z.record(LaneSchema, z.number().int().nonnegative()),
  games: z.number().int().nonnegative(),
  fetchedAt: z.number(),
});
export type LaneProfile = z.infer<typeof LaneProfileSchema>;
export const RankEstimateSchema = z.object({
  /** null = too little data. */
  points: z.number().nullable(),
  samples: z.number().int(),
  games: z.number().int(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  perGame: z.array(z.object({ at: z.number(), queueId: z.number().int(), median: z.number().nullable(), samples: z.number().int() })),
  fetchedAt: z.number(),
});
export type RankEstimate = z.infer<typeof RankEstimateSchema>;
export const TeamPlayerSchema = z.object({
  puuid: z.string(),
  gameName: z.string(),
  tagLine: z.string(),
  nameSeenAt: z.number(),
  /** "name#tag", newest first, at most 3. */
  previousNames: z.array(z.string()).default([]),
  addedBy: z.enum(["lobby", "friend", "riotId", "recent"]).optional(),
  rank: PlayerRankSchema.nullable(),
  lanes: LaneProfileSchema.nullable(),
  estimate: RankEstimateSchema.nullable(),
  /** Last failure (fixed wording). */
  error: z.string().nullable().default(null),
});
export type TeamPlayer = z.infer<typeof TeamPlayerSchema>;
export const CustomLobbySchema = z.object({
  team100: z.array(z.string()),
  team200: z.array(z.string()),
  spectators: z.array(z.string()),
});
export type CustomLobby = z.infer<typeof CustomLobbySchema>;
export const PrefetchStatusSchema = z.object({
  running: z.boolean(),
  done: z.number().int(),
  total: z.number().int(),
  /** PUUID being fetched. */
  current: z.string().nullable(),
  failed: z.number().int(),
  pausedUntil: z.number().nullable(),
  rate: z.object({ requests: z.number().int(), throttled: z.number().int(), avgMs: z.number(), perSec: z.number() }),
});
export type PrefetchStatus = z.infer<typeof PrefetchStatusSchema>;
export const TeamsStateSchema = z.object({
  enabled: z.boolean(),
  /** null when not in a custom lobby. */
  lobby: CustomLobbySchema.nullable(),
  players: z.record(z.string(), TeamPlayerSchema),
  fetching: z.array(z.string()),
  prefetch: PrefetchStatusSchema,
});
export type TeamsState = z.infer<typeof TeamsStateSchema>;
export const FriendEntrySchema = z.object({ puuid: z.string(), gameName: z.string(), tagLine: z.string(), groupId: z.number().int(), groupName: z.string() });
export type FriendEntry = z.infer<typeof FriendEntrySchema>;
export const FriendGroupSchema = z.object({ id: z.number().int(), name: z.string() });
export type FriendGroup = z.infer<typeof FriendGroupSchema>;
export const RecentPlayerSchema = z.object({ puuid: z.string(), gameName: z.string(), tagLine: z.string(), lastPlayedAt: z.number() });
export type RecentPlayer = z.infer<typeof RecentPlayerSchema>;
export const RiotIdResultSchema = z.object({
  input: z.string(),
  puuid: z.string().nullable(),
  error: z.enum(["format", "not-found", "failed"]).nullable(),
});
export type RiotIdResult = z.infer<typeof RiotIdResultSchema>;

export interface TeamsApi {
  getState(): Promise<TeamsState>;
  onState(cb: (s: TeamsState) => void): () => void;
  /** Feature flag teamBalancer (from the renderer's settings). */
  setEnabled(enabled: boolean): void;
  friends(): Promise<{ groups: FriendGroup[]; friends: FriendEntry[]; self: { puuid: string; gameName: string; tagLine: string } | null }>;
  /** Deduplicated, newest first. */
  recentPlayers(): Promise<RecentPlayer[]>;
  /** At most 30 lines. Resolved people join `players` with addedBy "riotId". */
  resolveRiotIds(lines: string[]): Promise<RiotIdResult[]>;
  /** At most 60 people. */
  prefetch(req: { puuids: string[]; mode: "stale" | "all"; addedBy?: "friend" | "recent" | "lobby" }): void;
  cancelPrefetch(): void;
  /** Fetch this person again (the estimate too). */
  refresh(puuid: string): void;
  forget(puuid: string): void;
  clearCache(): void;
}
