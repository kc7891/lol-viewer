/**
 * Generates scenarios/teams-custom-lobby.jsonl (M-038): a synthetic custom lobby for the Teams tab.
 * Everything is made up (players are `player-N#tag-N`), from a fixed random seed, so the committed file
 * is reproducible: `pnpm make-teams-scenario` rewrites it, and a test checks that the file still matches.
 *
 * The lobby (t=300): blue player-1..5, red player-6..9 + one bot, spectators player-10 and player-11.
 * At t=2000 player-12 joins as a spectator. player-4 and player-9 are unranked (their rank is estimated
 * from the games they played), player-7 has only Flex. player-12..30 never appear in the lobby: they are
 * the co-players, friends and recently played people. Game dates are relative to REFERENCE_NOW; the E2E
 * test shifts them to the day it runs, because the cache only counts games from the last 60 days.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REFERENCE_NOW = Date.parse("2026-11-27T12:00:00Z");
const DAY = 86_400_000;
const POOL = 30;

const id = (n: number) => `player-${n}`;
const tag = (n: number) => `tag-${n}`;
const PSEUDO = 1_000_000;

/** Fixed-seed random numbers (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TIERS = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND"] as const;
const DIVISIONS = ["IV", "III", "II", "I"] as const;
const UNRANKED = new Set([4, 9]);
const FLEX_ONLY = new Set([7]);

type Lane = "top" | "jungle" | "middle" | "bottom" | "support";
const LANES: Lane[] = ["top", "jungle", "middle", "bottom", "support"];
const LANE_FIELDS: Record<Lane, { lane: string; role: string }> = {
  top: { lane: "TOP", role: "SOLO" },
  jungle: { lane: "JUNGLE", role: "NONE" },
  middle: { lane: "MIDDLE", role: "SOLO" },
  bottom: { lane: "BOTTOM", role: "CARRY" },
  support: { lane: "NONE", role: "SUPPORT" },
};

type Line = { t: number; uri: string; eventType: "Update"; data: unknown };

export function generateTeamsScenario(): string {
  const rand = rng(38);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const lines: Line[] = [];
  const add = (t: number, uri: string, data: unknown) => lines.push({ t, uri, eventType: "Update", data });

  // ── ranks ──
  const entry = (queueType: string, n: number, extra: Record<string, unknown> = {}) => {
    const tier = pick(TIERS);
    return {
      queueType,
      tier,
      division: pick(DIVISIONS),
      leaguePoints: Math.floor(rand() * 100),
      wins: 10 + n,
      losses: 8 + (n % 7),
      isProvisional: false,
      ...extra,
    };
  };
  const none = (queueType: string, extra: Record<string, unknown> = {}) => ({ queueType, tier: "", division: "NA", leaguePoints: 0, wins: 0, losses: 0, isProvisional: false, ...extra });
  const rankBody = (n: number) => {
    const prev = { previousSeasonEndTier: pick(TIERS), previousSeasonEndDivision: pick(DIVISIONS) };
    const solo = UNRANKED.has(n) || FLEX_ONLY.has(n) ? none("RANKED_SOLO_5x5", prev) : entry("RANKED_SOLO_5x5", n, prev);
    const flex = FLEX_ONLY.has(n) ? entry("RANKED_FLEX_SR", n) : n % 4 === 0 && !UNRANKED.has(n) ? entry("RANKED_FLEX_SR", n) : none("RANKED_FLEX_SR");
    return { puuid: id(n), queueMap: { RANKED_SOLO_5x5: solo, RANKED_FLEX_SR: flex } };
  };

  // ── the game lists and details ──
  const mainLane = (n: number): Lane => LANES[n % 5]!;
  const NORMALS = [400, 430, 480, 490];
  const OTHERS = [420, 420, 440, 450, 400];
  const participantOf = (n: number, lane: Lane, teamId: number, participantId: number) => ({
    participantId,
    teamId,
    championId: 1 + ((n * 7 + participantId) % 150),
    spell1Id: lane === "jungle" ? 11 : 4,
    spell2Id: lane === "jungle" ? 4 : 14,
    stats: { win: (n + participantId) % 2 === 0, kills: participantId, deaths: 3, assists: 5 },
    timeline: LANE_FIELDS[lane],
  });
  const identity = (n: number, participantId: number) => ({ participantId, player: { puuid: id(n), gameName: id(n), tagLine: tag(n) } });

  const lobbyPlayers = Array.from({ length: 11 }, (_, i) => i + 1);
  const detailLines: Line[] = [];
  for (const n of lobbyPlayers) {
    const count = UNRANKED.has(n) ? 5 : 5 + (n % 4);
    const rows: unknown[] = [];
    for (let i = 0; i < count; i++) {
      const gameId = 100_000 + n * 100 + i;
      const normal = UNRANKED.has(n) || i % 2 === 0;
      const queueId = normal ? NORMALS[(n + i) % NORMALS.length]! : pick(OTHERS);
      const lane = rand() < 0.7 ? mainLane(n) : pick(LANES);
      const gameCreation = REFERENCE_NOW - Math.round((0.6 + i * 1.3) * DAY);
      const base = { gameId, queueId, gameCreation, gameDuration: 1800, gameMode: "CLASSIC", gameType: "MATCHED_GAME", mapId: 11, platformId: "TEST" };
      rows.push({ ...base, participants: [participantOf(n, lane, 100, 1)], participantIdentities: [identity(n, 1)] });
      if (NORMALS.includes(queueId)) {
        // Nine co-players drawn from everyone else (some unranked: they count for nothing).
        const others = Array.from({ length: POOL }, (_, k) => k + 1).filter((k) => k !== n);
        for (let k = others.length - 1; k > 0; k--) {
          const j = Math.floor(rand() * (k + 1));
          [others[k], others[j]] = [others[j]!, others[k]!];
        }
        const nine = others.slice(0, 9);
        const everyone = [n, ...nine];
        detailLines.push({
          t: 0,
          uri: `/lol-match-history/v1/games/${gameId}`,
          eventType: "Update",
          data: {
            ...base,
            participants: everyone.map((p, k) => participantOf(p, p === n ? lane : LANES[k % 5]!, k < 5 ? 100 : 200, k + 1)),
            participantIdentities: everyone.map((p, k) => identity(p, k + 1)),
          },
        });
      }
    }
    add(0, `/lol-match-history/v1/products/lol/${id(n)}/matches?begIndex=0&endIndex=20`, {
      accountId: PSEUDO + n,
      games: { gameIndexBegin: 0, gameIndexEnd: rows.length, gameCount: rows.length, games: rows },
    });
  }

  // ── static client data (t=0) ──
  add(0, "/lol-gameflow/v1/gameflow-phase", "Lobby");
  add(0, "/lol-summoner/v1/current-summoner", {
    accountId: PSEUDO + 1,
    puuid: id(1),
    gameName: id(1),
    tagLine: tag(1),
    displayName: id(1),
    summonerId: PSEUDO + 2,
    summonerLevel: 100,
    profileIconId: PSEUDO + 3,
  });
  for (let n = 1; n <= POOL; n++) {
    add(0, `/lol-ranked/v1/ranked-stats/${id(n)}`, rankBody(n));
    add(0, `/lol-summoner/v2/summoners/puuid/${id(n)}`, { puuid: id(n), gameName: id(n), tagLine: tag(n), displayName: id(n), summonerLevel: 30 + n, accountId: PSEUDO + n });
  }
  lines.push(...detailLines);

  const FRIEND_IDS = [2, 3, 5, 6, 7, 8, 10, 12, 13, 14, 15, 16];
  const groupOf = (n: number) => (n <= 8 ? { groupId: 2, groupName: "Customs" } : n <= 13 ? { groupId: 1, groupName: "General" } : { groupId: 0, groupName: "**Default" });
  const groupMeta = (gid: number, name: string, meta: boolean, count: number) => ({ id: gid, name, collapsed: false, isMetaGroup: meta, priority: gid, totalCount: count });
  const countIn = (gid: number) => FRIEND_IDS.filter((n) => groupOf(n).groupId === gid).length;
  add(0, "/lol-chat/v1/friend-groups", [groupMeta(0, "**Default", true, countIn(0)), groupMeta(1, "General", false, countIn(1)), groupMeta(2, "Customs", false, countIn(2))]);
  add(
    0,
    "/lol-chat/v1/friends",
    FRIEND_IDS.map((n) => ({ puuid: id(n), gameName: id(n), gameTag: tag(n), ...groupOf(n), pid: "x", availability: n % 3 === 0 ? "chat" : "offline" })),
  );

  const RECENT = [12, 13, 20, 12, 14, 21, 15, 22, 16, 23, 17, 24];
  add(
    0,
    "/lol-match-history/v1/recently-played-summoners",
    RECENT.map((n, i) => ({
      puuid: id(n),
      gameName: id(n),
      tagLine: tag(n),
      gameId: 100_000 + n * 100,
      championId: 1 + n,
      teamId: i % 2 ? 200 : 100,
      gameCreationDate: new Date(REFERENCE_NOW - (i + 1) * DAY).toISOString(),
    })),
  );
  for (const n of [20, 21]) add(0, `/lol-summoner/v1/summoners?name=${id(n)}%23${tag(n)}`, { puuid: id(n), gameName: id(n), tagLine: tag(n), summonerLevel: 30 + n });

  // ── the lobby ──
  const member = (n: number, extra: Record<string, unknown> = {}) => ({ puuid: id(n), isBot: false, isLeader: n === 1, isSpectator: false, summonerId: PSEUDO + 100 + n, ...extra });
  const bot = { puuid: "", isBot: true, botChampionId: 22, botDifficulty: "MEDIUM", isSpectator: false, summonerId: 0 };
  const lobby = (spectators: number[]) => {
    const team100 = [1, 2, 3, 4, 5].map((n) => member(n));
    const team200 = [...[6, 7, 8, 9].map((n) => member(n)), bot];
    const specs = spectators.map((n) => member(n, { isSpectator: true }));
    return {
      canStartActivity: true,
      gameConfig: { gameMode: "CLASSIC", isCustom: true, queueId: 3100, mapId: 11, maxLobbySize: 10, customTeam100: team100, customTeam200: team200, customSpectators: specs },
      localMember: member(1),
      members: [...team100, ...team200.filter((m) => !m.isBot), ...specs],
    };
  };
  add(300, "/lol-lobby/v2/lobby", lobby([10, 11]));
  add(2000, "/lol-lobby/v2/lobby", lobby([10, 11, 12]));

  lines.sort((a, b) => a.t - b.t); // stable: the order inside one t is kept
  return ["// synthetic Teams scenario (M-038), generated by tools/fake-lcu/src/make-teams-scenario.ts; every identity is a pseudonym", ...lines.map((l) => JSON.stringify(l))].join("\n") + "\n";
}

export const TEAMS_SCENARIO_PATH = fileURLToPath(new URL("../../../scenarios/teams-custom-lobby.jsonl", import.meta.url));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync(TEAMS_SCENARIO_PATH, generateTeamsScenario());
  console.log(`wrote ${TEAMS_SCENARIO_PATH}`);
}
