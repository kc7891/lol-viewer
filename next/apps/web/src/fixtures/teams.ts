/**
 * Teams fixtures (M-038): twelve made-up people (Player1#tag1 ...) in the same shapes main sends
 * (TeamsState). Mixed ranks: two unranked (one with a rank estimate, one with too little data), one with
 * Flex only, one whose data is a few days old. Nothing here is a real person.
 */
import type { CustomLobby, FriendEntry, FriendGroup, PrefetchStatus, RecentPlayer, RiotIdResult, TeamPlayer, TeamsApi, TeamsState } from "@lol-viewer/protocol";
import { effectiveRank, rankLabel, type SavedMatchup, type SavedRoster, type TeamPlayerPref } from "@lol-viewer/core";
import { LANES } from "@lol-viewer/protocol";
import { isValidRiotId } from "@lol-viewer/protocol";

const DAY = 86_400_000;
export const fx = (n: number) => `fx-${n}`;
export const fxName = (n: number) => `Player${n}`;

type Tier = [tier: string, division: string, lp: number];
const POINTS: Record<string, number> = { IRON: 0, BRONZE: 400, SILVER: 800, GOLD: 1200, PLATINUM: 1600, EMERALD: 2000, DIAMOND: 2400 };
const DIV: Record<string, number> = { IV: 0, III: 100, II: 200, I: 300 };
const entry = ([tier, division, lp]: Tier) => ({ tier, division, lp, points: POINTS[tier]! + DIV[division]! + lp });

type Spec = { nameOnly?: boolean; error?: string; solo?: Tier; flex?: Tier; prev?: Tier; lanes: Partial<Record<"top" | "jungle" | "middle" | "bottom" | "support", number>>; estimate?: { points: number | null; samples: number; games: number }; ageDays?: number };
const SPECS: Record<number, Spec> = {
  1: { solo: ["GOLD", "II", 40], lanes: { top: 9, jungle: 2, middle: 1 } },
  2: { solo: ["SILVER", "I", 75], lanes: { jungle: 10, middle: 2 } },
  3: { solo: ["PLATINUM", "IV", 10], lanes: { middle: 7, top: 3, bottom: 2 } },
  4: { lanes: { middle: 6, support: 2, jungle: 1 }, prev: ["SILVER", "II", 0], estimate: { points: 1350, samples: 22, games: 8 } },
  5: { solo: ["GOLD", "IV", 5], lanes: { bottom: 8, support: 4 } },
  6: { solo: ["EMERALD", "III", 60], lanes: { support: 9, bottom: 3 } },
  7: { flex: ["SILVER", "II", 30], lanes: { top: 6, jungle: 4, middle: 1 } },
  8: { solo: ["GOLD", "I", 88], lanes: { jungle: 7, top: 2, support: 1 } },
  9: { lanes: { top: 1, middle: 1, bottom: 1 }, estimate: { points: null, samples: 8, games: 3 } },
  10: { solo: ["PLATINUM", "II", 22], lanes: { bottom: 8, middle: 3 } },
  11: { solo: ["DIAMOND", "IV", 0], lanes: { middle: 9, jungle: 2 } },
  12: { solo: ["SILVER", "IV", 14], lanes: { support: 6, bottom: 4 }, ageDays: 6 },
  /** Saved from a friend group, only the name is known. */
  13: { nameOnly: true, lanes: {} },
  /** The last fetch failed, and the old data is past the limit for use. */
  14: { solo: ["GOLD", "III", 20], lanes: { top: 5, jungle: 5 }, ageDays: 20, error: "League Client did not answer" },
};

export function fixturePlayer(n: number, now = Date.now()): TeamPlayer {
  const s = SPECS[n]!;
  const at = now - (s.ageDays ?? 0.3) * DAY;
  const games = Object.values(s.lanes).reduce((a, b) => a + b, 0);
  return {
    puuid: fx(n),
    gameName: fxName(n),
    tagLine: `tag${n}`,
    nameSeenAt: at,
    previousNames: n === 5 ? ["OldFive#tag5"] : [],
    addedBy: n <= 12 ? "lobby" : "friend",
    rank: { solo: s.solo ? entry(s.solo) : null, flex: s.flex ? entry(s.flex) : null, prevSeason: s.prev ? entry(s.prev) : null, fetchedAt: at },
    lanes: { counts: { top: 0, jungle: 0, middle: 0, bottom: 0, support: 0, ...s.lanes }, games, fetchedAt: at },
    ...(s.nameOnly ? { rank: null, lanes: null } : {}),
    estimate: s.estimate
      ? {
          points: s.estimate.points,
          samples: s.estimate.samples,
          games: s.estimate.games,
          min: s.estimate.points === null ? null : s.estimate.points - 600,
          max: s.estimate.points === null ? null : s.estimate.points + 700,
          perGame: Array.from({ length: s.estimate.games }, (_, i) => ({
            at: now - (i + 1) * 1.4 * DAY,
            queueId: [400, 430, 480, 490][i % 4]!,
            median: s.estimate!.points === null ? null : s.estimate!.points + ((i % 3) - 1) * 150,
            samples: Math.floor(s.estimate!.samples / s.estimate!.games) + (i % 2),
          })),
          fetchedAt: at,
        }
      : null,
    error: s.error ?? null,
  };
}

export const IDLE_PREFETCH: PrefetchStatus = { running: false, done: 0, total: 0, current: null, failed: 0, pausedUntil: null, rate: { requests: 312, throttled: 0, avgMs: 180, perSec: 5 } };

export type LobbyShape = "none" | "ten" | "eight" | "nine";
const LOBBIES: Record<LobbyShape, CustomLobby | null> = {
  none: null,
  /** 10 in the team slots (player 9 is unranked with too little data), 2 spectators. */
  ten: { team100: [1, 2, 3, 4, 5].map(fx), team200: [6, 7, 8, 9, 10].map(fx), spectators: [11, 12].map(fx) },
  /** 8 in the team slots, 4 spectators. */
  eight: { team100: [1, 2, 3, 4].map(fx), team200: [6, 7, 8, 10].map(fx), spectators: [5, 9, 11, 12].map(fx) },
  /** 9 in the team slots: one short of an even number. */
  nine: { team100: [1, 2, 3, 4, 5].map(fx), team200: [6, 7, 8, 10].map(fx), spectators: [9, 11, 12].map(fx) },
};

export type TeamsFixture = { lobby?: LobbyShape; players?: number[]; fetching?: number[]; prefetch?: Partial<PrefetchStatus>; now?: number };

export function teamsState(o: TeamsFixture = {}): TeamsState {
  const now = o.now ?? Date.now();
  const ids = o.players ?? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const players: Record<string, TeamPlayer> = {};
  for (const n of ids) players[fx(n)] = fixturePlayer(n, now);
  // Someone who just joined: the name is known, nothing else yet.
  for (const n of o.fetching ?? []) players[fx(n)] = { ...players[fx(n)]!, rank: null, lanes: null, estimate: null };
  return { enabled: true, lobby: LOBBIES[o.lobby ?? "ten"], players, fetching: (o.fetching ?? []).map(fx), prefetch: { ...IDLE_PREFETCH, ...o.prefetch } };
}

/** Manual settings used by the stories: three players locked to the same lane (the balancer cannot keep that). */
export const JUNGLE_CLASH: Record<string, TeamPlayerPref> = { [fx(2)]: { lock: "jungle" }, [fx(8)]: { lock: "jungle" }, [fx(5)]: { lock: "jungle" } };
/** Every chip state: stars (two on one player), a lock, avoided lanes, and a rank set by hand (Player9 is unranked, Player6 has a better one). */
export const CHIP_STATES: Record<string, TeamPlayerPref> = {
  [fx(1)]: { mains: ["top", "jungle"] },
  [fx(2)]: { lock: "jungle", ng: ["support", "top"] },
  [fx(3)]: { lock: "middle" },
  [fx(5)]: { mains: ["bottom"], ng: ["middle"] },
  [fx(6)]: { ng: ["bottom"], mains: ["support"], rankOverride: 2100 },
  [fx(9)]: { rankOverride: 1700 },
};
/** One locked player and one who avoids a lane. */
export const SOME_PREFS: Record<string, TeamPlayerPref> = { [fx(3)]: { lock: "middle", mains: ["middle"] }, [fx(6)]: { ng: ["bottom"] } };

export const FIXTURE_GROUPS: FriendGroup[] = [
  { id: 2, name: "Customs" },
  { id: 1, name: "General" },
  { id: 0, name: "**Default" },
];
const group = (n: number) => (n <= 8 ? FIXTURE_GROUPS[0]! : n <= 12 ? FIXTURE_GROUPS[1]! : FIXTURE_GROUPS[2]!);
export const FIXTURE_FRIENDS: FriendEntry[] = Array.from({ length: 16 }, (_, i) => i + 1)
  .filter((n) => n !== 1)
  .map((n) => ({ puuid: fx(n), gameName: fxName(n), tagLine: `tag${n}`, groupId: group(n).id, groupName: group(n).name }));
export const FIXTURE_SELF = { puuid: fx(1), gameName: fxName(1), tagLine: "tag1" };
export const FIXTURE_RECENT: RecentPlayer[] = [20, 13, 21, 14, 22, 15, 23, 16, 24, 17].map((n, i) => ({
  puuid: fx(n),
  gameName: fxName(n),
  tagLine: `tag${n}`,
  lastPlayedAt: Date.parse("2026-11-26T12:00:00Z") - i * DAY,
}));
/** Riot IDs the fixture client knows: Player20#tag20 and Player21#tag21. */
const KNOWN_IDS = new Set(["Player20#tag20", "Player21#tag21"]);

/** A TeamsApi pinned to `state` (stories, Storybook E2E): the lookups answer from the fixtures, the rest does nothing. */
export function fixtureTeamsApi(state: TeamsState, overrides: Partial<TeamsApi> = {}): TeamsApi {
  return {
    getState: async () => state,
    onState: (cb) => (cb(state), () => {}),
    setEnabled() {},
    friends: async () => ({ groups: FIXTURE_GROUPS, friends: FIXTURE_FRIENDS, self: FIXTURE_SELF }),
    recentPlayers: async () => FIXTURE_RECENT,
    resolveRiotIds: async (lines): Promise<RiotIdResult[]> =>
      lines.map((input) => {
        if (!isValidRiotId(input)) return { input, puuid: null, error: "format" };
        return KNOWN_IDS.has(input) ? { input, puuid: `fx-${input.split("#")[1]!.replace("tag", "")}`, error: null } : { input, puuid: null, error: "not-found" };
      }),
    prefetch() {},
    cancelPrefetch() {},
    refresh() {},
    forget() {},
    clearCache() {},
    exportPrefs: async () => ({ saved: true }),
    ...overrides,
  };
}

// ── Saved rosters and matchups (M-042) ──
const roster = (id: string, name: string, ids: number[], daysAgo: number): SavedRoster => ({ id, name, puuids: ids.map(fx), savedAt: Date.now() - daysAgo * DAY });
/** Three rosters: the usual ten, a Friday eight, and one with a guest (Player99) who is not in People. */
export const FIXTURE_ROSTERS: SavedRoster[] = [
  roster("ro-usual", "The usual 10", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 1),
  roster("ro-friday", "Friday 8", [1, 2, 3, 5, 6, 8, 10, 11], 3),
  roster("ro-guest", "Weekend with guest", [1, 2, 3, 4, 5, 6, 7, 8, 99], 9),
];

/**
 * A saved split of the fixture people, the labels they had when it was saved. Lanes go top → support in the order given
 * (none for 6 or 8 people). `was` changes the label of a person ("it was G2 then"), `gone` are people who are not in People any more.
 */
export function fixtureMatchup(id: string, name: string, blue: number[], red: number[], o: { daysAgo?: number; priority?: "rankFirst" | "laneFirst"; was?: Record<number, string> } = {}): SavedMatchup {
  const laned = blue.length === 5;
  const slot = (n: number, i: number) => ({ puuid: fx(n), lane: laned ? LANES[i]! : null });
  const people: SavedMatchup["people"] = {};
  for (const n of [...blue, ...red]) {
    const p = SPECS[n] ? fixturePlayer(n) : undefined;
    const eff = effectiveRank(p, undefined, Date.now());
    people[fx(n)] = { gameName: fxName(n), tagLine: `tag${n}`, rankLabel: o.was?.[n] ?? (eff ? rankLabel(eff.points, eff.source) : "—"), points: eff?.points ?? null };
  }
  return { id, name, savedAt: Date.now() - (o.daysAgo ?? 0) * DAY, blue: blue.map(slot), red: red.map(slot), people, priority: o.priority ?? "rankFirst" };
}
/** Three matchups: ten people (Player3 was Gold 2 when it was saved), eight people without lanes, and six people with a guest (Player99) who is gone. */
export const FIXTURE_MATCHUPS: SavedMatchup[] = [
  fixtureMatchup("mu-ten", "Friday 5v5", [1, 7, 3, 5, 6], [2, 8, 11, 10, 12], { daysAgo: 1, was: { 3: "G2" } }),
  fixtureMatchup("mu-eight", "Quick 4v4", [11, 6, 2, 12], [3, 8, 1, 7], { daysAgo: 4, priority: "laneFirst" }),
  fixtureMatchup("mu-guest", "With a guest", [1, 3, 99], [2, 4, 5], { daysAgo: 12 }),
];
