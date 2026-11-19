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

export const PROTOCOL_VERSION = 1 as const;

// ── Shared primitives ──────────────────────────────────────────────

export const LaneSchema = z.enum(["top", "jungle", "middle", "bottom", "support"]);
export type Lane = z.infer<typeof LaneSchema>;
export const LANES: readonly Lane[] = LaneSchema.options;

export const ConnectionStatusSchema = z.enum(["connecting", "connected", "disconnected"]);
export type ConnectionStatus = z.infer<typeof ConnectionStatusSchema>;

/** Gameflow phases we care about; anything else is kept as a plain string. */
export const GamePhaseSchema = z.string();
export type GamePhase = z.infer<typeof GamePhaseSchema>;

// ── LCU payload subsets (read-only views of what the client sends) ─

export const ChampSelectPlayerSchema = z.looseObject({
  cellId: z.number(),
  championId: z.number().default(0),
  championPickIntent: z.number().optional(),
  assignedPosition: z.string().optional(),
});

export const ChampSelectSessionSchema = z.looseObject({
  gameId: z.number().optional(),
  localPlayerCellId: z.number(),
  myTeam: z.array(ChampSelectPlayerSchema).default([]),
  theirTeam: z.array(ChampSelectPlayerSchema).default([]),
});
export type ChampSelectSession = z.infer<typeof ChampSelectSessionSchema>;

export const GameflowSessionSchema = z.looseObject({
  phase: z.string().optional(),
  gameData: z
    .looseObject({
      gameId: z.number().optional(),
      queue: z.looseObject({ id: z.number().optional() }).optional(),
    })
    .optional(),
});
export type GameflowSession = z.infer<typeof GameflowSessionSchema>;

// ── LcuEvent: adapter -> core ──────────────────────────────────────

export const LcuEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("connection"), status: ConnectionStatusSchema }),
  z.object({ type: z.literal("gameflow-phase"), phase: GamePhaseSchema }),
  z.object({ type: z.literal("gameflow-session"), session: GameflowSessionSchema.nullable() }),
  z.object({ type: z.literal("champ-select-session"), session: ChampSelectSessionSchema.nullable() }),
]);
export type LcuEvent = z.infer<typeof LcuEventSchema>;

// ── MatchState: Hub -> every UI ────────────────────────────────────

export const AllyPickSchema = z.object({
  cellId: z.number(),
  championId: z.number().nullable(),
  /** Hover / pick intent before lock-in (championId is still 0 then). */
  intentChampionId: z.number().nullable(),
  lane: LaneSchema.nullable(),
  isSelf: z.boolean(),
});
export type AllyPick = z.infer<typeof AllyPickSchema>;

export const EnemyPickSchema = z.object({
  cellId: z.number(),
  championId: z.number().nullable(),
});
export type EnemyPick = z.infer<typeof EnemyPickSchema>;

export const MatchupRowSchema = z.object({
  lane: LaneSchema,
  allyChampionId: z.number().nullable(),
  enemyChampionId: z.number().nullable(),
});
export type MatchupRow = z.infer<typeof MatchupRowSchema>;

export const MatchStateSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  connection: ConnectionStatusSchema,
  phase: GamePhaseSchema,
  /** Increments every time a new champ select starts. UIs reset on change. */
  matchSeq: z.number().int().nonnegative(),
  gameId: z.number().nullable(),
  queueId: z.number().nullable(),
  self: z.object({ championId: z.number(), lane: LaneSchema.nullable() }).nullable(),
  allies: z.array(AllyPickSchema),
  /** In pick order (theirTeam order). */
  enemies: z.array(EnemyPickSchema),
  matchups: z.array(MatchupRowSchema).length(5),
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

/** Only https URLs on allow-listed analytics hosts may be loaded in-app. */
export const ALLOWED_VIEW_HOSTS = ["lolalytics.com", "u.gg"] as const;

export function isAllowedViewUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  return ALLOWED_VIEW_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
}

export const ViewUrlSchema = z.string().refine(isAllowedViewUrl, "URL host is not allow-listed");

export const ViewCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("attach"), viewId: ViewIdSchema, url: ViewUrlSchema, bounds: RectSchema }),
  z.object({ type: z.literal("setBounds"), viewId: ViewIdSchema, bounds: RectSchema }),
  z.object({ type: z.literal("setVisible"), viewId: ViewIdSchema, visible: z.boolean() }),
  z.object({ type: z.literal("detach"), viewId: ViewIdSchema }),
]);
export type ViewCommand = z.infer<typeof ViewCommandSchema>;

export const ViewStatusSchema = z.object({
  viewId: ViewIdSchema,
  status: z.enum(["loading", "ready", "error"]),
  url: z.string(),
  title: z.string(),
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
}
