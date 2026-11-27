import { describe, expect, it } from "vitest";
import type { ProbeBuildArgs, ProbeResponse, ProbeRouteId } from "@lol-viewer/protocol";
import { formatProbeReport, runLcuProbe, shapeOf, type ProbeBuild } from "./lcu-probe.ts";

// Identities that must never show up in a report.
const SECRETS = ["SecretName0", "SecretName1", "secret-puuid-0", "secret-puuid-1", "secret-puuid-2", "Alice#JP1", "Alice", "JP1", "Bob#JP1"];

const SELF = "secret-puuid-0";
const FRIEND = "secret-puuid-1";
const timeline = { lane: "JUNGLE", role: "NONE" };
const participant = (i: number) => ({
  participantId: i,
  teamId: 100,
  championId: 10,
  summonerName: `SecretName${i}`,
  timeline,
  stats: { win: true, kills: 3 },
});
const game = (gameId: number, queueId: number, created: number) => ({
  gameId,
  queueId,
  gameCreation: created,
  gameVersion: "13.24.5.1",
  participants: [participant(1), participant(2)],
  participantIdentities: [{ participantId: 1, player: { puuid: SELF, gameName: "SecretName0", tagLine: "JP1", summonerName: "Alice" } }],
});
const day = 86_400_000;

type Route = (args: ProbeBuildArgs) => ProbeResponse | undefined;
const ok = (body: unknown, ms = 20): ProbeResponse => ({ status: 200, ms, body });

const routes: Partial<Record<ProbeRouteId, Route>> = {
  currentSummoner: () => ok({ puuid: SELF, gameName: "SecretName0", tagLine: "JP1", summonerLevel: 400, displayName: "Alice" }),
  lobby: () => ({ status: 404, ms: 5, body: { httpStatus: 404, errorCode: "RPC_ERROR", message: "No lobby for SecretName0" } }),
  friendGroups: () => ok([{ id: 0, name: "General", totalCount: 0 }, { id: 3, name: "Secret group", totalCount: 5 }]),
  friendGroupFriends: () => ok([{ puuid: FRIEND, gameName: "SecretName1", gameTag: "JP1" }]),
  friends: () =>
    ok([
      { puuid: FRIEND, gameName: "SecretName1", gameTag: "JP1", groupId: 0, groupName: "General", note: "Alice#JP1" },
      { puuid: "secret-puuid-2", gameName: "Bob", gameTag: "JP1", groupId: 0, groupName: "General" },
    ]),
  rankedStats: (a) => ok({ queueMap: { RANKED_SOLO_5x5: { tier: "GOLD", division: "II", leaguePoints: 40, puuid: a.params?.puuid } } }),
  rankedStatsBatch: (a) => {
    const q = a.query?.puuids as { list: string[]; style: string };
    // Only the "json" style works in this fake client.
    return q.style === "json" && q.list.length <= 10 ? ok(Object.fromEntries(q.list.map((p) => [p + "-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", { tier: "GOLD" }]))) : { status: 400, ms: 8, body: { httpStatus: 400, message: "bad SecretName0" } };
  },
  matches: (a) => {
    const beg = Number(a.query?.begIndex);
    return ok({ games: { gameCount: 20, gameIndexBegin: beg, games: [game(1001, 420, 10 * day), game(1002, 430, 1 * day), game(1003, 420, 5 * day)] } });
  },
  game: () => ok(game(1002, 430, 1 * day)),
  summonerByName: (a) => ok({ puuid: a.query?.name === "Alice#JP1" ? "secret-puuid-9" : SELF, gameName: "SecretName0" }),
  summonerByPuuid: () => ok({ puuid: FRIEND, displayName: "SecretName1", summonerLevel: 10 }),
  summonerByPuuidCached: () => ok({ puuid: FRIEND, displayName: "SecretName1" }),
  recentlyPlayed: () => ok([{ summonerName: "SecretName2", puuid: "secret-puuid-2" }]),
};

const build: ProbeBuild = (id, args = {}) => JSON.stringify({ id, args });

function harness(over: Partial<Record<ProbeRouteId, Route>> = {}) {
  let clock = 1_000_000;
  const log: { id: ProbeRouteId; args: ProbeBuildArgs; at: number }[] = [];
  const get = async (path: string): Promise<ProbeResponse> => {
    const { id, args } = JSON.parse(path) as { id: ProbeRouteId; args: ProbeBuildArgs };
    log.push({ id, args, at: clock });
    return ({ ...routes, ...over }[id]?.(args)) ?? { status: 404, ms: 1, body: { httpStatus: 404 } };
  };
  return {
    get,
    log,
    opts: { now: () => clock, sleep: async (ms: number) => void (clock += ms), appVersion: "0.1.0", platform: "win32" },
  };
}

describe("shapeOf", () => {
  it("shows keys and types but no string values", () => {
    const s = shapeOf({ puuid: "secret-puuid-0", gameName: "SecretName0", level: 4, ok: true, none: null, list: [{ a: "x" }, { a: "y" }], empty: [] });
    expect(s).toBe("{puuid:str(14), gameName:str(11), level:num, ok:true, none:null, list:[2]{a:str(1)}, empty:[0]}");
  });
  it("shows allow-listed values only when they look like codes", () => {
    expect(shapeOf({ queueId: 420, tier: "GOLD", lane: "JUNGLE", role: "NONE", gameVersion: "13.24.5.1", position: "Alice#JP1", division: "I want a long text here ok", teamId: 100 })).toBe(
      '{queueId:420, tier:"GOLD", lane:"JUNGLE", role:"NONE", gameVersion:"13.24.5.1", position:str(9), division:str(26), teamId:100}',
    );
    expect(shapeOf({ message: "SecretName0" })).toBe("{message:str(11)}");
    expect(shapeOf({ Tier: "gold", QUEUEID: 5 })).toBe('{Tier:"gold", QUEUEID:5}');
  });
  it("hides map keys that look like IDs, and odd keys", () => {
    const s = shapeOf({ ["a1".repeat(39)]: { tier: "GOLD" }, ["b-".repeat(39)]: { tier: "GOLD" }, "Alice #JP1": 1, "11111111-2222-3333-4444-555555555555": 2 });
    expect(s).toBe('{<id>:{tier:"GOLD"}, …+3}');
    expect(s).not.toContain("aaaa");
    expect(s).not.toContain("Alice");
  });
  it("keeps long letters-only field names, hides 30+ char keys with a digit or dash", () => {
    expect(shapeOf({ highestCurrentSeasonReachedTierSR: "GOLD", previousSeasonEndDivision: "I" })).toBe(
      "{highestCurrentSeasonReachedTierSR:str(4), previousSeasonEndDivision:str(1)}",
    );
    expect(shapeOf({ ["x1".repeat(15)]: 1 })).toBe("{<id>:num}");
    expect(shapeOf({ ["x-".repeat(15)]: 1 })).toBe("{<id>:num}");
  });
  it("hides map keys that are numeric account / summoner ids", () => {
    const s = shapeOf({ "2817461234": { tier: "GOLD" }, "123456": 1, "420": { tier: "SILVER" } });
    expect(s).toBe('{420:{tier:"SILVER"}, <id>:num, …+1}'); // integer keys come first, ascending
    expect(s).not.toContain("2817461234");
    expect(s).not.toContain("123456");
  });
  it("hides the keys of map-like objects (e.g. keyed by player name), but not queue names", () => {
    const byName = shapeOf({ Faker: { tier: "GOLD", wins: 1 }, Bob: { tier: "SILVER", wins: 2 }, alice: { tier: "IRON", wins: 3 } });
    expect(byName).toBe('{<key>:{tier:"GOLD", wins:num}, …+2}');
    for (const n of ["Faker", "Bob", "alice"]) expect(byName).not.toContain(n);
    const queues = shapeOf({ queueMap: { RANKED_SOLO_5x5: { tier: "GOLD" }, RANKED_FLEX_SR: { tier: "SILVER" } } });
    expect(queues).toBe('{queueMap:{RANKED_SOLO_5x5:{tier:"GOLD"}, RANKED_FLEX_SR:{tier:"SILVER"}}}');
    // A schema object with different children keeps its keys.
    expect(shapeOf({ gameConfig: { isCustom: true }, members: [] })).toBe("{gameConfig:{isCustom:true}, members:[0]}");
  });
  it("limits depth, keys and length", () => {
    expect(shapeOf({ a: { b: { c: { d: { e: 1 } } } } })).toBe("{a:{b:{c:{d:{…}}}}}");
    expect(shapeOf({ a: [[1]], b: [{ c: 1 }] }, { depth: 1 })).toBe("{a:[1], b:[1]}");
    const wide = Object.fromEntries(Array.from({ length: 45 }, (_, i) => [`k${i}`, i]));
    expect(shapeOf(wide)).toMatch(/…\+5\}$/);
    expect(shapeOf(wide, { maxChars: 20 }).length).toBe(20);
  });
});

describe("runLcuProbe", () => {
  it("runs the whole sequence, spaced >= 200 ms, with progress", async () => {
    const h = harness();
    const progress: [number, number][] = [];
    const report = await runLcuProbe(h.get, build, { ...h.opts, riotId: "Alice#JP1" }, (d, t) => progress.push([d, t]));
    expect(progress.at(-1)).toEqual([20, 20]);
    expect(progress).toHaveLength(20);
    for (let i = 1; i < h.log.length; i++) expect(h.log[i]!.at - h.log[i - 1]!.at, `request ${i}`).toBeGreaterThanOrEqual(200);

    const by = (n: number) => report.steps.filter((s) => s.n === n);
    expect(by(1)[0]).toMatchObject({ name: "current-summoner", status: 200 });
    expect(by(2)[0]).toMatchObject({ status: 404, note: "not in a lobby" });
    expect(by(4)[0]!.facts).toEqual({ count: 1 });
    // the first friend group with a positive count is chosen
    expect(h.log.find((l) => l.id === "friendGroupFriends")!.args.params).toEqual({ id: 3 });
    expect(by(5)[0]!.facts).toMatchObject({ count: 2, puuid: "yes", gameName: "yes", gameTag: "yes", groupId: "yes", groupName: "yes", displayGroupId: "no" });
    expect(by(8).map((s) => [s.name, s.status])).toEqual([
      ["ranked-stats batch json", 200],
      ["ranked-stats batch comma", 400],
      ["ranked-stats batch repeat", 400],
    ]);
    expect(by(8)[0]!.facts).toEqual({ returned: 2 });
    // sizes use the working style, capped at the available people (self + 2 friends = 3)
    expect(by(9).map((s) => s.name)).toEqual(["ranked-stats batch size 1", "ranked-stats batch size 3"]);
    expect(by(10)[0]!.facts).toMatchObject({ games: 3, gameCount: 20, queues: "420x2 430x1", spanDays: 9, lane: "JUNGLE", role: "NONE" });
    expect(by(14)[0]).toMatchObject({ status: 200, facts: { participants: 2, identities: 1, identityHasPuuid: "yes", lane: "JUNGLE" } });
    expect(h.log.filter((l) => l.id === "game").map((l) => l.args.params)).toEqual([{ gameId: 1002 }, { gameId: 1002 }]); // normal queue preferred
    expect(by(16)[0]!.facts).toEqual({ puuid: "match" });
    expect(by(17)[0]!.facts).toEqual({ hasPuuid: "yes" });
    expect(by(20)[0]!.facts).toEqual({ count: 1 });
    expect(report.rate).toBeUndefined();
  });

  it("skips steps whose inputs are missing, with fixed reasons, and keeps going", async () => {
    const h = harness({ currentSummoner: () => ({ status: 500, ms: 3, body: null }), friends: () => ok([]) });
    const report = await runLcuProbe(h.get, build, h.opts);
    const skipped = report.steps.filter((s) => s.status === "skipped");
    expect(skipped.map((s) => s.n)).toEqual(expect.arrayContaining([6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]));
    expect(skipped.find((s) => s.n === 17)!.note).toBe("no Riot ID entered");
    expect(report.steps.find((s) => s.n === 20)!.status).toBe(200);
    expect(report.steps.find((s) => s.n === 1)!.status).toBe(500);
  });

  it("step 16 says unknown (not mismatch) when step 1 had no usable PUUID", async () => {
    const h = harness({ currentSummoner: () => ok({ puuid: "not a puuid!", gameName: "SecretName0", tagLine: "JP1" }) });
    const report = await runLcuProbe(h.get, build, h.opts);
    expect(report.steps.find((s) => s.n === 16)!.facts).toEqual({ puuid: "unknown" });
  });

  it("reports timeouts and network errors without values", async () => {
    const h = harness({ lobby: () => ({ status: 0, ms: 10_000, body: null, error: "timeout" }) });
    const report = await runLcuProbe(h.get, build, h.opts);
    expect(report.steps.find((s) => s.n === 2)).toMatchObject({ status: 0, note: "timeout" });
    expect(formatProbeReport(report)).toContain("err");
  });

  it("throws before any request for an invalid Riot ID", async () => {
    const h = harness();
    await expect(runLcuProbe(h.get, build, { ...h.opts, riotId: "no-tag" })).rejects.toThrow();
    await expect(runLcuProbe(h.get, build, { ...h.opts, riotId: "a#b#c" })).rejects.toThrow();
    expect(h.log).toHaveLength(0);
  });

  it("rate test: 40 requests (20 sequential, 20 in groups of 4), no spacing, counts 429 and Retry-After", async () => {
    let n = 0;
    const h = harness({
      rankedStats: () => {
        n++;
        return n > 1 && n % 10 === 0 ? { status: 429, ms: 100, body: null, retryAfter: true } : ok({}, 30 + n);
      },
    });
    const progress: number[] = [];
    const report = await runLcuProbe(h.get, build, { ...h.opts, rateTest: true }, (d, t) => {
      expect(t).toBe(21);
      progress.push(d);
    });
    expect(progress.at(-1)).toBe(21);
    const rateRequests = h.log.slice(-40);
    expect(rateRequests.every((l) => l.id === "rankedStats")).toBe(true);
    expect(new Set(rateRequests.slice(0, 20).map((l) => l.at)).size).toBe(1); // no sleeping in between
    expect(report.rate).toMatchObject({ requests: 40, retryAfter: true });
    expect(report.rate!.statusCounts["200"]! + report.rate!.statusCounts["429"]!).toBe(40);
    expect(report.rate!.minMs).toBeLessThanOrEqual(report.rate!.medianMs);
    expect(report.rate!.medianMs).toBeLessThanOrEqual(report.rate!.maxMs);
    expect(formatProbeReport(report)).toMatch(/21 rate test \(40\) .*429 ×\d+ .*retry-after: yes/);
  });
});

describe("formatProbeReport", () => {
  it("contains none of the names, PUUIDs or Riot IDs from the responses", async () => {
    const h = harness();
    const report = await runLcuProbe(h.get, build, { ...h.opts, riotId: "Alice#JP1", rateTest: true });
    const text = formatProbeReport(report);
    for (const s of SECRETS) expect(text, s).not.toContain(s);
    expect(JSON.stringify(report)).not.toMatch(/Secret|secret-|Alice|JP1/);
    expect(text.startsWith("```\nLoL Viewer LCU check · app 0.1.0 · win32 · ")).toBe(true);
    expect(text).toContain("current-summoner");
    expect(text).toMatch(/ 2 lobby +404 +5ms +not in a lobby/);
    expect(text).toContain("puuid=yes gameName=yes gameTag=yes groupId=yes groupName=yes displayGroupId=no");
    expect(text).toContain("returned=2");
    expect(text.endsWith("\n```")).toBe(true);
  });

  it("keeps a huge report under 30,000 characters by shortening shapes", () => {
    const shape = "{" + "k:num, ".repeat(500) + "}";
    const steps = Array.from({ length: 30 }, (_, i) => ({ n: i + 1, name: `step ${i}`, route: "friends" as const, status: 200, ms: 5, shape }));
    const text = formatProbeReport({ startedAt: "2026-11-27T12:34:56.000Z", appVersion: "1", platform: "win32", steps });
    expect(text.length).toBeLessThanOrEqual(30_000);
    expect(text).toContain("…");
  });
  it("keeps both code fences when even the shortest shapes do not fit", () => {
    const steps = Array.from({ length: 400 }, (_, i) => ({ n: i + 1, name: `step ${i}`, route: "friends" as const, status: 200, ms: 5, note: "x".repeat(100) }));
    const text = formatProbeReport({ startedAt: "2026-11-27T12:34:56.000Z", appVersion: "1", platform: "win32", steps });
    expect(text.length).toBeLessThanOrEqual(30_000);
    expect(text.startsWith("```\n")).toBe(true);
    expect(text.endsWith("\n```")).toBe(true);
  });
});
