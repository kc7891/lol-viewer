/**
 * TeamFetcher (Teams, M-038): reads rank, match list, names and game details from the League Client with
 * a priority queue, rate limiting and the cache file. All I/O is injected (get, build, now, sleep), so the
 * tests need no client and no timers.
 *
 * Tasks per person: "light" (name, ranked stats, match list) and "estimate" (game details and co-players'
 * ranks, then the median). Priority: lobby light > lobby estimate > prefetch (light then estimate, one person at a time).
 * Nothing here logs or exposes names; failures are stored as fixed wording in `TeamPlayer.error`.
 */
import {
  PROBE_PUUID_RE,
  type PrefetchStatus,
  type ProbeBuildArgs,
  type ProbeResponse,
  type ProbeRouteId,
  type TeamPlayer,
} from "@lol-viewer/protocol";
import type { ProbeBuild } from "../lcu-probe.ts";
import { freshness, MAX_PLAYER_GAMES, type PlayerGame, type TeamCacheFile } from "./cache.ts";
import { coRankPoints, ESTIMATE_MAX_SAMPLES, estimateGameIds, estimateRank } from "./estimate.ts";
import { laneOf, laneProfileFromGames } from "./lanes.ts";
import { parseRankedStats } from "./rank.ts";
import { RateLimiter } from "./rateLimiter.ts";

export type TeamFetcherOptions = {
  get: (path: string) => Promise<ProbeResponse>;
  build: ProbeBuild;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** The cache (changed in place). */
  file: TeamCacheFile;
  /** Called after every change with the file and the status. main saves it (about once a second) and tells the renderer. */
  onChange: (file: TeamCacheFile, status: PrefetchStatus) => void;
  limiter?: RateLimiter;
  /** Tasks run at the same time (default 2). */
  workers?: number;
  /** While the client is not reachable, try again this often (ms). Unset: wait for setConnected(true). */
  pollMs?: number;
};

export type EnsureOptions = {
  priority: "lobby" | "prefetch";
  mode: "stale" | "all";
  addedBy?: TeamPlayer["addedBy"];
};

type Task = { kind: "light" | "estimate"; puuid: string; cls: 0 | 1 | 2; force: boolean; epoch: number };
class Cancelled extends Error {}

const ERR_NO_ANSWER = "League Client did not answer";
const ERR_LIMITED = "League Client is limiting requests";
const ERR_INVALID = "Invalid request";
const ERR_PARTIAL = "Some data could not be fetched";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const ok = (r: ProbeResponse) => r.status >= 200 && r.status < 300;
const errorText = (r: ProbeResponse): string =>
  r.status === 0 ? ERR_NO_ANSWER : r.status === 429 || r.status === 503 ? ERR_LIMITED : r.status === -1 ? ERR_INVALID : r.status === 404 ? "Not found" : `League Client returned ${r.status}`;
const validPuuid = (p: unknown): p is string => typeof p === "string" && PROBE_PUUID_RE.test(p);

export class TeamFetcher {
  readonly #get: TeamFetcherOptions["get"];
  readonly #build: ProbeBuild;
  readonly #now: () => number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #file: TeamCacheFile;
  readonly #onChange: TeamFetcherOptions["onChange"];
  readonly #limiter: RateLimiter;
  readonly #workers: number;
  readonly #pollMs: number | undefined;

  #queue: Task[] = [];
  #active = new Map<string, Task>();
  #running = 0;
  #epoch = 0;
  #connected = true;
  #connWaiters: (() => void)[] = [];
  #idleWaiters: (() => void)[] = [];
  /** People of the current prefetch batch whose work is not finished. */
  #batch = new Set<string>();
  #done = 0;
  #total = 0;
  #failed = 0;

  constructor(o: TeamFetcherOptions) {
    this.#get = o.get;
    this.#build = o.build;
    this.#now = o.now;
    this.#sleep = o.sleep;
    this.#file = o.file;
    this.#onChange = o.onChange;
    this.#limiter = o.limiter ?? new RateLimiter({ now: o.now, sleep: o.sleep });
    this.#workers = Math.max(1, o.workers ?? 2);
    this.#pollMs = o.pollMs;
  }

  // ── public ───────────────────────────────────────────────────────

  get file(): TeamCacheFile {
    return this.#file;
  }

  status(): PrefetchStatus {
    let current: string | null = null;
    for (const [id] of this.#active) if (this.#batch.has(id)) current = id;
    return {
      running: this.#batch.size > 0,
      done: this.#done,
      total: this.#total,
      current,
      failed: this.#failed,
      pausedUntil: this.#limiter.pausedUntil(),
      rate: this.#limiter.stats(),
    };
  }

  /** PUUIDs with queued or running work. */
  fetching(): string[] {
    return [...new Set([...this.#queue.map((t) => t.puuid), ...this.#active.keys()])];
  }

  /** The League Client connected / disconnected. While disconnected nothing is requested and the work waits. */
  setConnected(connected: boolean): void {
    this.#connected = connected;
    if (connected) this.#wakeConn();
  }

  /** Resolves when no work is queued or running. */
  idle(): Promise<void> {
    if (this.#queue.length === 0 && this.#active.size === 0) return Promise.resolve();
    return new Promise((r) => this.#idleWaiters.push(r));
  }

  /** Fetch these people. "stale": only what is not fresh; "all": everything again (the estimate too). */
  ensure(puuids: readonly string[], o: EnsureOptions): void {
    const now = this.#now();
    const ids = [...new Set(puuids.filter(validPuuid))];
    const prefetch = o.priority === "prefetch";
    if (prefetch && this.#batch.size === 0) this.#done = this.#total = this.#failed = 0;
    const force = o.mode === "all";
    for (const id of ids) {
      const p = this.#player(id, o.addedBy);
      const needLight = force || !p.rank || !p.lanes || freshness(p.rank.fetchedAt, now) !== "fresh";
      const cls = prefetch ? 2 : 0;
      let queued = false;
      if (needLight) queued = this.#enqueue({ kind: "light", puuid: id, cls, force, epoch: this.#epoch });
      else if (this.#estimateNeeded(p, force)) queued = this.#enqueue({ kind: "estimate", puuid: id, cls: prefetch ? 2 : 1, force, epoch: this.#epoch });
      if (prefetch && !this.#batch.has(id)) {
        this.#total++;
        if (queued || this.#active.has(id)) this.#batch.add(id);
        else this.#done++;
      }
    }
    this.#changed();
    this.#kick();
  }

  /** Stop the prefetch: queued prefetch work is dropped, running work stops at its next request. Data already fetched stays. */
  cancelPrefetch(): void {
    this.#epoch++;
    this.#queue = this.#queue.filter((t) => t.cls !== 2);
    this.#batch.clear();
    this.#done = this.#total = this.#failed = 0;
    this.#wakeConn();
    this.#changed();
    this.#checkIdle();
  }

  /** Fetch one person again, the estimate too. */
  refresh(puuid: string): void {
    if (!validPuuid(puuid)) return;
    this.#player(puuid);
    this.#enqueue({ kind: "light", puuid, cls: 0, force: true, epoch: this.#epoch });
    this.#changed();
    this.#kick();
  }

  /** Remove one person (the shared game and co-player data stay). */
  forget(puuid: string): void {
    this.#queue = this.#queue.filter((t) => t.puuid !== puuid);
    if (this.#batch.delete(puuid)) this.#total = Math.max(0, this.#total - 1);
    delete this.#file.players[puuid];
    delete this.#file.playerGames[puuid];
    this.#changed();
    this.#checkIdle();
  }

  /** Empty the cache (the file object is kept) and drop all queued work. */
  clearCache(): void {
    this.#queue = [];
    this.#epoch++;
    this.#batch.clear();
    this.#done = this.#total = this.#failed = 0;
    for (const k of ["players", "playerGames", "games", "coRanks"] as const) for (const id of Object.keys(this.#file[k])) delete this.#file[k][id];
    this.#wakeConn();
    this.#changed();
    this.#checkIdle();
  }

  /** Add or update a person whose name is already known (friends, recent players, Riot ID lookups). */
  upsertPlayer(info: { puuid: string; gameName: string; tagLine: string }, addedBy?: TeamPlayer["addedBy"]): void {
    if (!validPuuid(info.puuid)) return;
    const p = this.#player(info.puuid, addedBy);
    this.#setName(p, info.gameName, info.tagLine);
    this.#changed();
  }

  /** One rate-limited GET for callers outside the fetcher (friends, recently played, Riot ID lookups). Waits while disconnected. */
  request(route: ProbeRouteId, args?: ProbeBuildArgs): Promise<ProbeResponse> {
    return this.#req(null, route, args);
  }

  // ── queue ────────────────────────────────────────────────────────

  /** Returns true when the work is (now) queued or already running. `front`: ahead of the others of its class (an estimate follows its person's light task). */
  #enqueue(t: Task, front = false): boolean {
    const dup = this.#queue.find((q) => q.kind === t.kind && q.puuid === t.puuid);
    if (dup) {
      if (t.cls < dup.cls) dup.cls = t.cls;
      dup.force ||= t.force;
      return true;
    }
    const running = this.#active.get(t.puuid);
    if (running && running.kind === t.kind && !t.force) return true;
    const at = this.#queue.findIndex((q) => (front ? q.cls >= t.cls : q.cls > t.cls));
    if (at < 0) this.#queue.push(t);
    else this.#queue.splice(at, 0, t);
    return true;
  }

  #next(): Task | null {
    let best = -1;
    for (let i = 0; i < this.#queue.length; i++) {
      const t = this.#queue[i]!;
      if (this.#active.has(t.puuid)) continue;
      if (best < 0 || t.cls < this.#queue[best]!.cls) best = i;
    }
    return best < 0 ? null : this.#queue.splice(best, 1)[0]!;
  }

  #kick(): void {
    while (this.#running < this.#workers) {
      const t = this.#next();
      if (!t) break;
      this.#running++;
      this.#active.set(t.puuid, t);
      void this.#run(t).finally(() => {
        this.#running--;
        this.#active.delete(t.puuid);
        this.#afterTask(t);
        this.#changed();
        this.#kick();
        this.#checkIdle();
      });
    }
  }

  #afterTask(t: Task): void {
    if (!this.#batch.has(t.puuid) || this.#queue.some((q) => q.puuid === t.puuid)) return;
    this.#batch.delete(t.puuid);
    this.#done++;
    if (this.#file.players[t.puuid]?.error) this.#failed++;
  }

  #checkIdle(): void {
    if (this.#queue.length || this.#active.size) return;
    for (const r of this.#idleWaiters.splice(0)) r();
  }

  #changed(): void {
    this.#onChange(this.#file, this.status());
  }

  #wakeConn(): void {
    for (const r of this.#connWaiters.splice(0)) r();
  }

  // ── requests ─────────────────────────────────────────────────────

  #cancelled(t: Task | null): boolean {
    return !!t && t.cls === 2 && t.epoch !== this.#epoch;
  }

  async #waitConnected(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.#connWaiters.push(resolve);
      if (this.#pollMs !== undefined) {
        void this.#sleep(this.#pollMs).then(() => {
          this.#connected = true; // try again; a failure marks it disconnected once more
          this.#wakeConn();
        });
      }
    });
  }

  async #req(t: Task | null, route: ProbeRouteId, args?: ProbeBuildArgs): Promise<ProbeResponse> {
    let path: string;
    try {
      path = this.#build(route, args);
    } catch {
      return { status: -1, ms: 0, body: null };
    }
    for (;;) {
      while (!this.#connected) {
        if (this.#cancelled(t)) throw new Cancelled();
        await this.#waitConnected();
      }
      if (this.#cancelled(t)) throw new Cancelled();
      const r = await this.#limiter.run(() => this.#get(path).catch((): ProbeResponse => ({ status: -1, ms: 0, body: null })));
      if (this.#cancelled(t)) throw new Cancelled();
      if (r.status === 0 && r.error === "network") {
        this.#connected = false;
        continue;
      }
      return r;
    }
  }

  // ── tasks ────────────────────────────────────────────────────────

  async #run(t: Task): Promise<void> {
    try {
      if (t.kind === "light") await this.#light(t);
      else await this.#estimate(t);
    } catch (e) {
      if (e instanceof Cancelled) return;
      const p = this.#file.players[t.puuid];
      if (p) p.error = ERR_NO_ANSWER;
    }
  }

  #player(id: string, addedBy?: TeamPlayer["addedBy"]): TeamPlayer {
    let p = this.#file.players[id];
    if (!p) {
      p = { puuid: id, gameName: "", tagLine: "", nameSeenAt: this.#now(), previousNames: [], rank: null, lanes: null, estimate: null, error: null };
      this.#file.players[id] = p;
    }
    if (addedBy && !p.addedBy) p.addedBy = addedBy;
    return p;
  }

  #setName(p: TeamPlayer, gameName: string, tagLine: string): void {
    if (!gameName) return;
    if (p.gameName && (p.gameName !== gameName || p.tagLine !== tagLine)) {
      const old = `${p.gameName}#${p.tagLine}`;
      p.previousNames = [old, ...p.previousNames.filter((n) => n !== old)].slice(0, 3);
    }
    p.gameName = gameName;
    p.tagLine = tagLine;
    p.nameSeenAt = this.#now();
  }

  #estimateNeeded(p: TeamPlayer, force: boolean): boolean {
    if (force) return true;
    if (!p.rank || p.rank.solo || p.rank.flex) return false;
    return !p.estimate || freshness(p.estimate.fetchedAt, this.#now()) !== "fresh";
  }

  async #light(t: Task): Promise<void> {
    const id = t.puuid;
    const p = this.#player(id);
    let err: string | null = null;

    const rn = await this.#req(t, "summonerByPuuid", { params: { puuid: id } });
    if (ok(rn) && isObj(rn.body)) {
      this.#setName(p, typeof rn.body.gameName === "string" ? rn.body.gameName : "", typeof rn.body.tagLine === "string" ? rn.body.tagLine : "");
      this.#changed();
    } else err = errorText(rn);

    const rr = await this.#req(t, "rankedStats", { params: { puuid: id } });
    if (ok(rr)) {
      p.rank = { ...parseRankedStats(rr.body), fetchedAt: this.#now() };
      this.#changed();
    } else err ??= errorText(rr);

    const rm = await this.#req(t, "matches", { params: { puuid: id }, query: { begIndex: 0, endIndex: 20 } });
    if (ok(rm)) {
      this.#mergeMatches(id, rm.body);
      p.lanes = laneProfileFromGames(this.#file.playerGames[id] ?? [], this.#now());
      this.#changed();
    } else err ??= errorText(rm);

    p.error = err;
    if (this.#estimateNeeded(p, t.force)) {
      this.#enqueue({ kind: "estimate", puuid: id, cls: t.cls === 0 ? 1 : t.cls, force: t.force, epoch: t.epoch }, true);
    }
  }

  /** Add the rows of a match list (the player's own row) to playerGames. */
  #mergeMatches(id: string, body: unknown): void {
    const games = isObj(body) && isObj(body.games) && Array.isArray(body.games.games) ? (body.games.games as unknown[]) : [];
    const byId = new Map<number, PlayerGame>((this.#file.playerGames[id] ?? []).map((g) => [g.gameId, g]));
    for (const g of games) {
      if (!isObj(g) || !Number.isInteger(g.gameId) || typeof g.gameCreation !== "number" || !Number.isInteger(g.queueId)) continue;
      const part = Array.isArray(g.participants) && isObj(g.participants[0]) ? g.participants[0] : null;
      const ident = Array.isArray(g.participantIdentities) && isObj(g.participantIdentities[0]) ? g.participantIdentities[0] : null;
      const who = ident && isObj(ident.player) ? ident.player.puuid : undefined;
      if (typeof who === "string" && who !== id) continue;
      const tl = part && isObj(part.timeline) ? part.timeline : {};
      const lane = part ? laneOf({ lane: tl.lane, role: tl.role, spell1Id: part.spell1Id, spell2Id: part.spell2Id }) : null;
      byId.set(g.gameId as number, { gameId: g.gameId as number, at: g.gameCreation, queueId: g.queueId as number, lane });
    }
    this.#file.playerGames[id] = [...byId.values()].sort((a, b) => b.at - a.at).slice(0, MAX_PLAYER_GAMES);
  }

  async #estimate(t: Task): Promise<void> {
    const id = t.puuid;
    const p = this.#file.players[id];
    if (!p || !this.#estimateNeeded(p, t.force)) return;
    let failure: string | null = null;
    let counted = 0;
    for (const gameId of estimateGameIds(id, this.#file, this.#now())) {
      let g = this.#file.games[String(gameId)];
      if (!g) {
        const r = await this.#req(t, "game", { params: { gameId } });
        g = ok(r) ? this.#parseGame(r.body, id, gameId) : undefined;
        if (!g) {
          failure ??= ok(r) ? ERR_PARTIAL : errorText(r);
          continue;
        }
        this.#file.games[String(gameId)] = g;
        this.#changed();
      }
      const others = [...new Set(g.participants.map((x) => x.puuid))].filter((x) => x !== id);
      for (const other of others) {
        const known = this.#file.coRanks[other];
        if (known && freshness(known.fetchedAt, this.#now()) === "fresh") continue;
        const own = this.#file.players[other]?.rank;
        if (own && freshness(own.fetchedAt, this.#now()) === "fresh") {
          this.#file.coRanks[other] = { points: (own.solo ?? own.flex)?.points ?? null, fetchedAt: own.fetchedAt };
          continue;
        }
        const r = await this.#req(t, "rankedStats", { params: { puuid: other } });
        if (ok(r)) {
          const rank = parseRankedStats(r.body);
          this.#file.coRanks[other] = { points: (rank.solo ?? rank.flex)?.points ?? null, fetchedAt: this.#now() };
          this.#changed();
        } else failure ??= errorText(r);
      }
      counted += others.filter((x) => typeof coRankPoints(this.#file, x, this.#now()) === "number").length;
      if (counted >= ESTIMATE_MAX_SAMPLES) break;
    }
    p.estimate = estimateRank(id, this.#file, this.#now());
    if (failure) p.error = failure;
    else if (p.error === ERR_PARTIAL) p.error = null;
  }

  #parseGame(body: unknown, target: string, gameId: number): { at: number; queueId: number; participants: { puuid: string; teamId: number }[] } | undefined {
    if (!isObj(body) || !Array.isArray(body.participants) || !Array.isArray(body.participantIdentities)) return undefined;
    const who = new Map<unknown, string>();
    for (const i of body.participantIdentities) if (isObj(i) && isObj(i.player) && validPuuid(i.player.puuid)) who.set(i.participantId, i.player.puuid);
    const participants: { puuid: string; teamId: number }[] = [];
    for (const x of body.participants) {
      if (!isObj(x)) continue;
      const puuid = who.get(x.participantId);
      if (puuid && typeof x.teamId === "number") participants.push({ puuid, teamId: x.teamId });
    }
    if (participants.length === 0) return undefined;
    const row = this.#file.playerGames[target]?.find((g) => g.gameId === gameId);
    const at = typeof body.gameCreation === "number" ? body.gameCreation : row?.at;
    const queueId = typeof body.queueId === "number" ? body.queueId : row?.queueId;
    return at === undefined || queueId === undefined ? undefined : { at, queueId, participants };
  }
}
