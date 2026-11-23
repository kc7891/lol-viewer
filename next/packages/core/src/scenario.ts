/**
 * Scenarios: recorded (or synthetic) LCU event streams, one JSON object per line.
 *
 *   {"t": 1500, "uri": "/lol-gameflow/v1/gameflow-phase", "eventType": "Update", "data": "ChampSelect"}
 *
 * The line shape is exactly the LCU WAMP `OnJsonApiEvent` payload plus a
 * millisecond offset `t`, so the same file feeds:
 *   - unit tests (reduceAll over toLcuEvent)
 *   - Storybook (MatchState at each step)
 *   - tools/fake-lcu (replayed over a real WebSocket for E2E)
 */
import {
  ChampSelectSessionSchema,
  CurrentSummonerSchema,
  GameflowSessionSchema,
  LiveClientPlayerSchema,
  type LcuEvent,
  type LivePlayerFact,
} from "@lol-viewer/protocol";
import { normalizeLivePlayer } from "./live.ts";
import { z } from "zod";

export const LcuApiEventSchema = z.object({
  uri: z.string(),
  eventType: z.enum(["Create", "Update", "Delete"]),
  data: z.unknown(),
});
export type LcuApiEvent = z.infer<typeof LcuApiEventSchema>;

export const ScenarioLineSchema = LcuApiEventSchema.extend({ t: z.number().nonnegative() });
export type ScenarioLine = z.infer<typeof ScenarioLineSchema>;

/**
 * The only LCU URIs the app subscribes to. Everything else is ignored.
 * (`/liveclientdata/playerlist` is the Live Client Data API, polled in game: M-025. Not a subscription.)
 */
export const SUBSCRIBED_URIS = [
  "/lol-gameflow/v1/gameflow-phase",
  "/lol-gameflow/v1/session",
  "/lol-champ-select/v1/session",
  "/lol-summoner/v1/current-summoner",
] as const;

/** Map a raw LCU JSON-API event to our domain event (or null if irrelevant/invalid). */
export function toLcuEvent(raw: LcuApiEvent): LcuEvent | null {
  const deleted = raw.eventType === "Delete";
  switch (raw.uri) {
    case "/lol-gameflow/v1/gameflow-phase":
      return typeof raw.data === "string" ? { type: "gameflow-phase", phase: raw.data } : null;
    case "/lol-gameflow/v1/session": {
      if (deleted) return { type: "gameflow-session", session: null };
      const parsed = GameflowSessionSchema.safeParse(raw.data);
      return parsed.success ? { type: "gameflow-session", session: parsed.data } : null;
    }
    case "/lol-champ-select/v1/session": {
      if (deleted) return { type: "champ-select-session", session: null };
      const parsed = ChampSelectSessionSchema.safeParse(raw.data);
      return parsed.success ? { type: "champ-select-session", session: parsed.data } : null;
    }
    case "/lol-summoner/v1/current-summoner": {
      if (deleted) return { type: "current-summoner", summoner: null };
      const parsed = CurrentSummonerSchema.safeParse(raw.data);
      return parsed.success ? { type: "current-summoner", summoner: parsed.data } : null;
    }
    case "/liveclientdata/playerlist": {
      if (deleted) return { type: "live-players", players: null };
      if (!Array.isArray(raw.data)) return null;
      const players: LivePlayerFact[] = [];
      for (const item of raw.data) {
        const p = LiveClientPlayerSchema.safeParse(item); // one broken player does not drop the others
        if (!p.success) continue;
        const fact = normalizeLivePlayer(p.data);
        if (fact) players.push(fact);
      }
      return { type: "live-players", players };
    }
    default:
      return null;
  }
}

export function parseScenario(jsonl: string): ScenarioLine[] {
  return jsonl
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("//"))
    .map((l, i) => {
      const r = ScenarioLineSchema.safeParse(JSON.parse(l));
      if (!r.success) throw new Error(`scenario line ${i + 1}: ${r.error.message}`);
      return r.data;
    });
}

export function scenarioEvents(lines: ScenarioLine[]): LcuEvent[] {
  return lines.flatMap((l) => {
    const e = toLcuEvent(l);
    return e ? [e] : [];
  });
}
