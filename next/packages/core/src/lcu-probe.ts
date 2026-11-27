/**
 * Settings "LCU check" (M-039): the probe sequence, the JSON shape summary and the report text.
 *
 * Pure and injectable (get / build / sleep / now), so the unit tests need no client. core does not
 * depend on @lol-viewer/lcu: the caller passes buildProbePath in.
 *
 * Privacy rule: no string value from the client ever reaches the report, except values of the
 * allow-listed keys (queue, tier, lane ...). Names, PUUIDs and IDs are only used as inputs to later requests.
 */
import {
  isValidRiotId,
  PROBE_PUUID_RE,
  type LcuProbeReport,
  type ProbeBuildArgs,
  type ProbeFactValue,
  type ProbeListStyle,
  type ProbeRate,
  type ProbeResponse,
  type ProbeRouteId,
  type ProbeStep,
} from "@lol-viewer/protocol";

export type ProbeGet = (path: string) => Promise<ProbeResponse>;
export type ProbeBuild = (id: ProbeRouteId, args?: ProbeBuildArgs) => string;
export type ProbeOptions = {
  /** Optional `name#tag` to look up (step 17). */
  riotId?: string;
  rateTest?: boolean;
  appVersion?: string;
  platform?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

// ── shapeOf ────────────────────────────────────────────────────────

/** Keys whose values may appear in a report (matched case-insensitively). Nothing here identifies a person. */
export const PROBE_VALUE_KEYS: ReadonlySet<string> = new Set(
  [
    "queueId", "queueType", "tier", "division", "lane", "role", "position", "teamId", "gameMode", "gameType", "mapId",
    "isCustom", "type", "spell1Id", "spell2Id", "highestTier", "previousSeasonEndTier", "previousSeasonHighestTier",
    "ratedTier", "httpStatus", "errorCode", "gameVersion", "platformId", "isMetaGroup", "priority", "collapsed", "availability",
  ].map((k) => k.toLowerCase()),
);

const SAFE_STRING = /^[A-Z0-9_.]{1,24}$/i; // "." so that gameVersion (13.24.1) is readable
const ID_LIKE_KEY = /^[A-Za-z0-9_-]{30,}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLAIN_KEY = /^[A-Za-z0-9_.$-]{1,40}$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A key as shown: ID-like keys (maps keyed by PUUID) and odd keys are hidden. */
function shownKey(k: string): string {
  if (ID_LIKE_KEY.test(k)) return "<id>";
  return PLAIN_KEY.test(k) ? k : "<key>";
}

/** A value that may be shown for an allow-listed key; undefined for everything else. */
function allowedValue(key: string | null, v: unknown): string | number | boolean | undefined {
  if (key === null || !PROBE_VALUE_KEYS.has(key.toLowerCase())) return undefined;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "boolean") return v;
  if (typeof v === "string" && SAFE_STRING.test(v)) return v;
  return undefined;
}

/** Describe a JSON value's structure without its personal values. */
export function shapeOf(value: unknown, opts: { depth?: number; maxKeys?: number; maxChars?: number } = {}): string {
  const maxKeys = opts.maxKeys ?? 40;
  const out = shape(value, null, opts.depth ?? 4, maxKeys);
  const cap = opts.maxChars ?? 4000;
  return out.length > cap ? out.slice(0, Math.max(0, cap - 1)) + "…" : out;
}

function shape(v: unknown, key: string | null, depth: number, maxKeys: number): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return String(v);
  if (typeof v === "number") {
    const shown = allowedValue(key, v);
    return shown === undefined ? "num" : String(shown);
  }
  if (typeof v === "string") {
    const shown = allowedValue(key, v);
    return shown === undefined ? `str(${v.length})` : JSON.stringify(shown);
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return "[0]";
    return depth <= 0 ? `[${v.length}]` : `[${v.length}]${shape(v[0], null, depth - 1, maxKeys)}`;
  }
  if (isObj(v)) {
    if (depth <= 0) return "{…}";
    const parts: string[] = [];
    let hidden = 0;
    let idShown = false;
    for (const [k, child] of Object.entries(v)) {
      const name = shownKey(k);
      if (name.startsWith("<")) {
        // Keys that look like IDs all collapse into one entry.
        if (idShown) {
          hidden++;
          continue;
        }
        idShown = true;
      }
      if (parts.length >= maxKeys) {
        hidden++;
        continue;
      }
      parts.push(`${name}:${shape(child, k, depth - 1, maxKeys)}`);
    }
    if (hidden > 0) parts.push(`…+${hidden}`);
    return `{${parts.join(", ")}}`;
  }
  return "?";
}

// ── helpers for reading responses ──────────────────────────────────

const at = (v: unknown, ...path: string[]): unknown => {
  let cur = v;
  for (const k of path) {
    if (!isObj(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
};
const asArray = (v: unknown): unknown[] | null => (Array.isArray(v) ? v : null);
const asString = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const yesNo = (b: boolean) => (b ? "yes" : "no");
const hasKey = (v: unknown, k: string) => isObj(v) && k in v && v[k] !== null && v[k] !== undefined;
const okBody = (r: ProbeResponse | null): unknown => (r && r.status >= 200 && r.status < 300 ? r.body : null);

/** A fact value is a count, a boolean, a finite number, or an allow-list-safe string. */
function safeFact(v: unknown): ProbeFactValue | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && SAFE_STRING.test(v)) return v;
  return undefined;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)]! : 0;
};

/** First participant's timeline lane / role (allow-listed values). */
function laneRole(participants: unknown): Record<string, ProbeFactValue> {
  const t = at(asArray(participants)?.[0], "timeline");
  const out: Record<string, ProbeFactValue> = {};
  const lane = safeFact(at(t, "lane"));
  const role = safeFact(at(t, "role"));
  if (lane !== undefined) out.lane = lane;
  if (role !== undefined) out.role = role;
  return out;
}

const NORMAL_QUEUES = new Set([400, 430, 480, 490]);
const GAME_ID = (g: unknown): number | undefined => {
  const id = at(g, "gameId");
  return typeof id === "number" && Number.isSafeInteger(id) && id >= 0 ? id : undefined;
};

function pickGameId(games: unknown[]): number | undefined {
  const normal = games.find((g) => NORMAL_QUEUES.has(at(g, "queueId") as number) && GAME_ID(g) !== undefined);
  return GAME_ID(normal) ?? GAME_ID(games[0]) ?? games.map(GAME_ID).find((x) => x !== undefined);
}

function matchFacts(body: unknown, withDetails: boolean): Record<string, ProbeFactValue> {
  const facts: Record<string, ProbeFactValue> = {};
  const games = asArray(at(body, "games", "games"));
  if (!games) return facts;
  facts.games = games.length;
  const container = at(body, "games");
  if (isObj(container)) {
    for (const [k, v] of Object.entries(container)) {
      if (typeof v === "number" && Number.isFinite(v) && /count|index|begin|end|total/i.test(k) && PLAIN_KEY.test(k)) facts[k] = v;
    }
  }
  if (!withDetails) return facts;
  const queues = new Map<number, number>();
  const created: number[] = [];
  for (const g of games) {
    const q = at(g, "queueId");
    if (typeof q === "number") queues.set(q, (queues.get(q) ?? 0) + 1);
    const c = at(g, "gameCreation");
    if (typeof c === "number" && Number.isFinite(c)) created.push(c);
  }
  if (queues.size) {
    facts.queues = [...queues.entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, 8)
      .map(([q, n]) => `${q}x${n}`)
      .join(" ");
  }
  if (created.length >= 2) facts.spanDays = Math.round(((Math.max(...created) - Math.min(...created)) / 86_400_000) * 10) / 10;
  Object.assign(facts, laneRole(at(games[0], "participants")));
  return facts;
}

function gameFacts(body: unknown): Record<string, ProbeFactValue> {
  const facts: Record<string, ProbeFactValue> = {};
  const participants = asArray(at(body, "participants"));
  const identities = asArray(at(body, "participantIdentities"));
  if (participants) facts.participants = participants.length;
  if (identities) {
    facts.identities = identities.length;
    facts.identityHasPuuid = yesNo(hasKey(at(identities[0], "player"), "puuid"));
  }
  Object.assign(facts, laneRole(participants));
  return facts;
}

// ── runLcuProbe ────────────────────────────────────────────────────

const MIN_GAP_MS = 200;
const FRIEND_FIELDS = ["puuid", "gameName", "gameTag", "groupId", "groupName", "displayGroupId"] as const;
const LIST_STYLES: ProbeListStyle[] = ["json", "comma", "repeat"];

/**
 * Run the fixed probe sequence (design §4). A failing step never stops the run: steps whose inputs are
 * missing are reported as skipped with a fixed reason. Requests are at least 200 ms apart (except the rate test).
 * Throws before any request when `opts.riotId` is not a valid Riot ID.
 */
export async function runLcuProbe(
  get: ProbeGet,
  build: ProbeBuild,
  opts: ProbeOptions = {},
  onProgress?: (done: number, total: number) => void,
): Promise<LcuProbeReport> {
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const riotId = opts.riotId?.trim() || undefined;
  if (riotId && !isValidRiotId(riotId)) throw new Error("invalid Riot ID");

  const total = opts.rateTest ? 21 : 20;
  const steps: ProbeStep[] = [];
  const startedAt = new Date(now()).toISOString();
  let lastStart = -Infinity;
  let doneSteps = 0;

  const finishStep = () => onProgress?.(++doneSteps, total);

  /** One GET, spaced from the previous one. null = the parameters were invalid (nothing requested). */
  const req = async (route: ProbeRouteId, args?: ProbeBuildArgs): Promise<ProbeResponse | null> => {
    let path: string;
    try {
      path = build(route, args);
    } catch {
      return null;
    }
    const wait = lastStart + MIN_GAP_MS - now();
    if (wait > 0) await sleep(wait);
    lastStart = now();
    try {
      return await get(path);
    } catch {
      return { status: 0, ms: 0, body: null, error: "network" };
    }
  };

  const skip = (n: number, name: string, route: ProbeRouteId, note: string) => {
    steps.push({ n, name, route, status: "skipped", ms: 0, note });
  };
  type Detail = { note?: string; facts?: Record<string, ProbeFactValue>; shape?: boolean | number };
  /** Record a response. `shape`: true = default depth, number = depth; failed responses always show the error body's shape. */
  const record = (n: number, name: string, route: ProbeRouteId, r: ProbeResponse | null, d: Detail = {}) => {
    if (!r) return skip(n, name, route, "invalid parameter");
    const ok = r.status >= 200 && r.status < 300;
    const step: ProbeStep = { n, name, route, status: r.status, ms: Math.round(r.ms) };
    const note = r.error ? { timeout: "timeout", network: "network error", "bad-json": "unreadable body" }[r.error] : d.note;
    if (note) step.note = note;
    if (r.body !== null && r.body !== undefined && (d.shape || !ok)) {
      step.shape = shapeOf(r.body, { depth: typeof d.shape === "number" ? d.shape : 4 });
    }
    if (ok && d.facts && Object.keys(d.facts).length) step.facts = d.facts;
    steps.push(step);
  };

  // Fail on a bad Riot ID before the first request.
  if (riotId) build("summonerByName", { query: { name: riotId } });

  // 1 current-summoner
  const r1 = await req("currentSummoner");
  record(1, "current-summoner", "currentSummoner", r1, { shape: true });
  const b1 = okBody(r1);
  const selfPuuid = (() => {
    const p = asString(at(b1, "puuid"));
    return p && PROBE_PUUID_RE.test(p) ? p : undefined;
  })();
  const gameName = asString(at(b1, "gameName"));
  const tagLine = asString(at(b1, "tagLine"));
  finishStep();

  // 2 lobby
  const r2 = await req("lobby");
  const b2 = okBody(r2);
  const lobbyFacts: Record<string, ProbeFactValue> = {};
  const isCustom = at(b2, "gameConfig", "isCustom");
  if (typeof isCustom === "boolean") lobbyFacts.isCustom = isCustom;
  for (const [k, label] of [["customTeam100", "team100"], ["customTeam200", "team200"], ["customSpectators", "spectators"]] as const) {
    const a = asArray(at(b2, "gameConfig", k));
    if (a) lobbyFacts[label] = a.length;
  }
  const members = asArray(at(b2, "members"));
  if (members) lobbyFacts.members = members.length;
  record(2, "lobby", "lobby", r2, { shape: 6, facts: lobbyFacts, ...(r2?.status === 404 ? { note: "not in a lobby" } : {}) });
  finishStep();

  // 3 friend-groups
  const r3 = await req("friendGroups");
  const groups = asArray(okBody(r3));
  record(3, "friend-groups", "friendGroups", r3, { shape: true, facts: groups ? { count: groups.length } : {} });
  const groupId = (() => {
    const ids = (groups ?? []).filter((g) => typeof at(g, "id") === "number" && Number.isSafeInteger(at(g, "id")) && (at(g, "id") as number) >= 0);
    const counted = ids.find((g) => isObj(g) && Object.entries(g).some(([k, v]) => /count|size|total/i.test(k) && typeof v === "number" && v > 0));
    return at(counted ?? ids[0], "id") as number | undefined;
  })();
  finishStep();

  // 4 friend-group-friends
  if (groupId === undefined) skip(4, "friend-group-friends", "friendGroupFriends", "no friend group id");
  else {
    const r4 = await req("friendGroupFriends", { params: { id: groupId } });
    const a = asArray(okBody(r4));
    record(4, "friend-group-friends", "friendGroupFriends", r4, { shape: true, facts: a ? { count: a.length } : {} });
  }
  finishStep();

  // 5 friends
  const r5 = await req("friends");
  const friends = asArray(okBody(r5));
  const friendFacts: Record<string, ProbeFactValue> = {};
  if (friends) {
    friendFacts.count = friends.length;
    for (const f of FRIEND_FIELDS) friendFacts[f] = yesNo(hasKey(friends[0], f));
  }
  record(5, "friends", "friends", r5, { shape: true, facts: friendFacts });
  const friendPuuids = (friends ?? [])
    .map((f) => asString(at(f, "puuid")))
    .filter((p): p is string => !!p && PROBE_PUUID_RE.test(p) && p !== selfPuuid)
    .slice(0, 19);
  const friend = friendPuuids[0];
  finishStep();

  // 6 ranked-stats (self)
  if (!selfPuuid) skip(6, "ranked-stats (self)", "rankedStats", "no own puuid");
  else record(6, "ranked-stats (self)", "rankedStats", await req("rankedStats", { params: { puuid: selfPuuid } }), { shape: 6 });
  finishStep();

  // 7 ranked-stats (friend)
  if (!friend) skip(7, "ranked-stats (friend)", "rankedStats", "no friend puuid");
  else record(7, "ranked-stats (friend)", "rankedStats", await req("rankedStats", { params: { puuid: friend } }), { shape: 6 });
  finishStep();

  // 8 ranked-stats batch, three list styles
  const batch = async (list: string[], style: ProbeListStyle) => req("rankedStatsBatch", { query: { puuids: { list, style } } });
  const returned = (body: unknown): ProbeFactValue | undefined =>
    Array.isArray(body) ? body.length : isObj(body) ? Object.keys(body).length : undefined;
  let workingStyle: ProbeListStyle | undefined;
  if (!selfPuuid) {
    for (const s of LIST_STYLES) skip(8, `ranked-stats batch ${s}`, "rankedStatsBatch", "no own puuid");
  } else {
    const list = [selfPuuid, ...(friend ? [friend] : [])];
    for (const style of LIST_STYLES) {
      const r = await batch(list, style);
      const n = returned(okBody(r));
      record(8, `ranked-stats batch ${style}`, "rankedStatsBatch", r, { facts: n === undefined ? {} : { returned: n } });
      if (!workingStyle && r && r.status === 200 && n !== undefined) workingStyle = style;
    }
  }
  finishStep();

  // 9 ranked-stats batch size
  if (!workingStyle || !selfPuuid) skip(9, "ranked-stats batch size", "rankedStatsBatch", "no batch format worked");
  else {
    const pool = [selfPuuid, ...friendPuuids];
    const sizes = [...new Set([1, 5, 10, 20].map((s) => Math.min(s, pool.length)))];
    for (const size of sizes) {
      const r = await batch(pool.slice(0, size), workingStyle);
      const n = returned(okBody(r));
      record(9, `ranked-stats batch size ${size}`, "rankedStatsBatch", r, { facts: n === undefined ? {} : { returned: n } });
    }
  }
  finishStep();

  const matchesOf = async (puuid: string, beg: number, end: number) =>
    req("matches", { params: { puuid }, query: { begIndex: beg, endIndex: end } });

  // 10 matches (self, 0-20)
  let selfGames: unknown[] = [];
  if (!selfPuuid) skip(10, "matches (self, 0-20)", "matches", "no own puuid");
  else {
    const r = await matchesOf(selfPuuid, 0, 20);
    selfGames = asArray(at(okBody(r), "games", "games")) ?? [];
    record(10, "matches (self, 0-20)", "matches", r, { shape: 6, facts: matchFacts(okBody(r), true) });
  }
  finishStep();

  // 11, 12 more ranges
  for (const [n, beg, end] of [[11, 0, 100], [12, 20, 40]] as const) {
    const name = `matches (self, ${beg}-${end})`;
    if (!selfPuuid) skip(n, name, "matches", "no own puuid");
    else {
      const r = await matchesOf(selfPuuid, beg, end);
      record(n, name, "matches", r, { facts: matchFacts(okBody(r), false) });
    }
    finishStep();
  }

  // 13 matches (friend)
  let friendGames: unknown[] = [];
  if (!friend) skip(13, "matches (friend)", "matches", "no friend puuid");
  else {
    const r = await matchesOf(friend, 0, 20);
    friendGames = asArray(at(okBody(r), "games", "games")) ?? [];
    record(13, "matches (friend)", "matches", r, { facts: matchFacts(okBody(r), false) });
  }
  finishStep();

  // 14 game (detail), 15 game (friend's)
  for (const [n, name, games] of [[14, "game (detail)", selfGames], [15, "game (friend's)", friendGames]] as const) {
    const gameId = pickGameId(games);
    if (gameId === undefined) skip(n, name, "game", n === 14 ? "no game id in step 10" : "no game id in step 13");
    else {
      const r = await req("game", { params: { gameId } });
      record(n, name, "game", r, { shape: 6, facts: gameFacts(okBody(r)) });
    }
    finishStep();
  }

  // 16 summoners?name (self)
  if (!gameName || !tagLine) skip(16, "summoners?name (self)", "summonerByName", "no Riot ID in step 1");
  else {
    const r = await req("summonerByName", { query: { name: `${gameName}#${tagLine}` } });
    const got = asString(at(okBody(r), "puuid"));
    const same = !got ? "none" : got === selfPuuid ? "match" : "mismatch";
    record(16, "summoners?name (self)", "summonerByName", r, { facts: { puuid: same } });
  }
  finishStep();

  // 17 summoners?name (input)
  if (!riotId) skip(17, "summoners?name (input)", "summonerByName", "no Riot ID entered");
  else {
    const r = await req("summonerByName", { query: { name: riotId } });
    record(17, "summoners?name (input)", "summonerByName", r, { facts: { hasPuuid: yesNo(hasKey(okBody(r), "puuid")) } });
  }
  finishStep();

  // 18, 19 summoner by puuid
  for (const [n, name, route] of [[18, "summoner by puuid", "summonerByPuuid"], [19, "summoner by puuid (cached)", "summonerByPuuidCached"]] as const) {
    if (!friend) skip(n, name, route, "no friend puuid");
    else record(n, name, route, await req(route, { params: { puuid: friend } }), { shape: true });
    finishStep();
  }

  // 20 recently-played
  const r20 = await req("recentlyPlayed");
  const recent = asArray(okBody(r20));
  record(20, "recently-played", "recentlyPlayed", r20, { shape: true, facts: recent ? { count: recent.length } : {} });
  finishStep();

  // 21 rate test (optional): 20 sequential, then 5 rounds of 4 concurrent, no spacing
  let rate: ProbeRate | undefined;
  if (opts.rateTest) {
    if (!selfPuuid) skip(21, "rate test", "rankedStats", "no own puuid");
    else {
      let path: string | null = null;
      try {
        path = build("rankedStats", { params: { puuid: selfPuuid } });
      } catch {
        path = null;
      }
      if (path === null) skip(21, "rate test", "rankedStats", "invalid parameter");
      else {
        const p = path;
        const all: ProbeResponse[] = [];
        const one = async () => {
          try {
            all.push(await get(p));
          } catch {
            all.push({ status: 0, ms: 0, body: null, error: "network" });
          }
        };
        for (let i = 0; i < 20; i++) await one();
        for (let i = 0; i < 5; i++) await Promise.all([one(), one(), one(), one()]);
        const statusCounts: Record<string, number> = {};
        for (const r of all) {
          const k = r.status ? String(r.status) : "err";
          statusCounts[k] = (statusCounts[k] ?? 0) + 1;
        }
        const ms = all.map((r) => r.ms);
        rate = {
          requests: all.length,
          statusCounts,
          minMs: Math.round(Math.min(...ms)),
          medianMs: Math.round(median(ms)),
          maxMs: Math.round(Math.max(...ms)),
          retryAfter: all.some((r) => r.retryAfter),
        };
      }
    }
    finishStep();
  }

  steps.sort((a, b) => a.n - b.n); // stable: sub-rows of one step keep their order
  return { startedAt, appVersion: opts.appVersion ?? "dev", platform: opts.platform ?? "unknown", steps, ...(rate ? { rate } : {}) };
}

// ── formatProbeReport ──────────────────────────────────────────────

const MAX_REPORT_CHARS = 30_000;

function line(step: ProbeStep, shapeCap: number): string[] {
  const status = step.status === "skipped" ? "skip" : step.status === 0 ? "err" : String(step.status);
  const ms = step.status === "skipped" ? "" : `${step.ms}ms`;
  const head = `${String(step.n).padStart(2)} ${step.name.padEnd(26)} ${status.padStart(4)} ${ms.padStart(7)}  `;
  const indent = " ".repeat(head.length);
  const facts = step.facts ? Object.entries(step.facts).map(([k, v]) => `${k}=${String(v)}`).join(" ") : "";
  let shape = step.shape ?? "";
  if (shape.length > shapeCap) shape = shape.slice(0, Math.max(0, shapeCap - 1)) + "…";
  const first = [step.note, shape].filter(Boolean).join(" · ");
  if (first) return [head + first, ...(facts ? [indent + facts] : [])];
  return [head + facts];
}

function render(report: LcuProbeReport, shapeCap: number): string {
  const lines = [`LoL Viewer LCU check · app ${report.appVersion} · ${report.platform} · ${report.startedAt.replace(/\.\d+Z$/, "Z")}`];
  for (const s of report.steps) lines.push(...line(s, shapeCap).map((l) => l.trimEnd()));
  if (report.rate) {
    const r = report.rate;
    const counts = Object.entries(r.statusCounts)
      .map(([k, n]) => `${k} ×${n}`)
      .join(" · ");
    const has429 = "429" in r.statusCounts ? "" : " · 429 ×0";
    lines.push(`21 rate test (${r.requests}) ${counts}${has429} · ms min ${r.minMs} / median ${r.medianMs} / max ${r.maxMs} · retry-after: ${r.retryAfter ? "yes" : "no"}`);
  }
  return "```\n" + lines.join("\n") + "\n```";
}

/** The report as a code-fenced text block (at most 30,000 characters; shapes are shortened until it fits). */
export function formatProbeReport(report: LcuProbeReport): string {
  for (const cap of [4000, 1500, 600, 250, 100]) {
    const text = render(report, cap);
    if (text.length <= MAX_REPORT_CHARS) return text;
  }
  return render(report, 0).slice(0, MAX_REPORT_CHARS);
}
