/**
 * MatchState fixtures derived from the real scenario through the real reducer,
 * so stories always show states the app can actually reach.
 */
import { initialMatchState, parseScenario, reduceAll, scenarioEvents } from "@lol-viewer/core";
import type { LcuEvent, MatchState } from "@lol-viewer/protocol";
import scenarioText from "../../../scenarios/ranked-two-matches.jsonl?raw";

const events: LcuEvent[] = scenarioEvents(parseScenario(scenarioText));
const connected = (s: MatchState): MatchState => ({ ...s, connection: "connected" });
const upTo = (pred: (e: LcuEvent) => boolean, offset = 0): MatchState =>
  connected(reduceAll(events.slice(0, events.findIndex(pred) + 1 + offset)));

export const fixtures = {
  disconnected: { ...initialMatchState(), connection: "disconnected" } as MatchState,
  idle: connected(initialMatchState()),
  champSelectStart: upTo((e) => e.type === "champ-select-session"),
  champSelectPartial: upTo((e) => e.type === "champ-select-session" && (e.session?.myTeam[2]?.championId ?? 0) > 0),
  champSelectComplete: upTo((e) => e.type === "champ-select-session" && (e.session?.theirTeam[4]?.championId ?? 0) > 0),
  inGame: upTo((e) => e.type === "gameflow-phase" && e.phase === "InProgress"),
  secondMatch: connected(reduceAll(events)),
} satisfies Record<string, MatchState>;

export type FixtureName = keyof typeof fixtures;
