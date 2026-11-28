/**
 * Teams controller without Electron (M-038): the custom lobby, the cache file's life cycle, the fetcher
 * and the state the renderer sees. Files, the League Client, timers and the IPC push are injected, so
 * it is unit-tested like overlay-core / live-core. teams.ts connects it to Electron.
 *
 * Gate: the feature flag teamBalancer. Off (the default): lobby events are dropped, nothing is requested,
 * the cache file is neither read nor written. On: the cache is read, and a custom lobby's players are
 * fetched at once (ranks and match lists, then the rank estimate), whether or not the Teams tab is open.
 * Logs carry counts only, never PUUIDs, names or ranks.
 */
import {
  emptyCache,
  lookupRiotId,
  parseCacheFile,
  parseCustomLobby,
  pruneCache,
  TeamFetcher,
  type ProbeBuild,
  type TeamCacheFile,
} from "@lol-viewer/core";
import {
  PROBE_PUUID_RE,
  type CustomLobby,
  type FriendEntry,
  type FriendGroup,
  type PrefetchStatus,
  type ProbeResponse,
  type RecentPlayer,
  type RiotIdResult,
  type TeamsState,
} from "@lol-viewer/protocol";

export const LOBBY_URI = "/lol-lobby/v2/lobby";
/** Changes reach the renderer within this long (they are coalesced). */
export const STATE_PUSH_MS = 200;
/** The cache file is written at most this long after a change. */
export const SAVE_DEBOUNCE_MS = 1000;
/** While the client is unreachable the fetcher tries again this often. */
export const RECONNECT_POLL_MS = 30_000;
/** A failed cache write is tried again this many times (each one debounce later). */
export const SAVE_RETRIES = 3;
export const RECENT_MAX = 200;

/** The preferences file (M-040): its default name, and where a save goes when the test hook is on. Pure, so they are tested without Electron. */
export const prefsFileName = (d: Date): string =>
  `lol-viewer-team-preferences-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}.json`;
/** `LOL_VIEWER_E2E_SAVE_PATH` skips the save dialog, but only in an E2E run (LOL_VIEWER_E2E=1). Otherwise null: ask the person. */
export const e2eSavePath = (env: Record<string, string | undefined>): string | null => (env.LOL_VIEWER_E2E === "1" && env.LOL_VIEWER_E2E_SAVE_PATH ? env.LOL_VIEWER_E2E_SAVE_PATH : null);

/** Names seen in friends / recent lists, kept in memory so a prefetch can show a name before its fetch. */
const NAMES_MAX = 1000;

export type TeamsStorage = {
  /** The file's text, or null when there is none. */
  load(): Promise<string | null>;
  /** Replace the file (atomically: temporary file, then rename). */
  save(text: string): Promise<void>;
  remove(): Promise<void>;
};

export type TeamsDeps = {
  get: (path: string) => Promise<ProbeResponse>;
  build: ProbeBuild;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  storage: TeamsStorage;
  /** Push the state to the renderer. */
  send: (state: TeamsState) => void;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: any) => void;
  /** Called once the flag is on and the cache is loaded: main asks the connector to emit the lobby again. */
  onEnabled?: () => void;
  /** Counts and state changes only. */
  log: (message: string) => void;
};

const IDLE_PREFETCH: PrefetchStatus = {
  running: false,
  done: 0,
  total: 0,
  current: null,
  failed: 0,
  pausedUntil: null,
  rate: { requests: 0, throttled: 0, avgMs: 0, perSec: 0 },
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const validPuuid = (v: unknown): v is string => typeof v === "string" && PROBE_PUUID_RE.test(v);
const okBody = (r: ProbeResponse): unknown => (r.status >= 200 && r.status < 300 ? r.body : null);

const lobbyPuuids = (l: CustomLobby): string[] => [...l.team100, ...l.team200, ...l.spectators];
const lobbyKey = (l: CustomLobby | null): string => (l ? JSON.stringify([l.team100, l.team200, l.spectators]) : "");

export type FriendsResult = { groups: FriendGroup[]; friends: FriendEntry[]; self: { puuid: string; gameName: string; tagLine: string } | null };

export class TeamsController {
  readonly #d: TeamsDeps;
  #enabled = false;
  #connected = false;
  #lobby: CustomLobby | null = null;
  #key = "";
  #fetcher: TeamFetcher | null = null;
  #file: TeamCacheFile | null = null;
  /** Bumped by every enable / disable: a slow cache load of an older one is dropped. */
  #gen = 0;
  #ready: Promise<void> = Promise.resolve();
  #sendTimer: unknown = null;
  #saveTimer: unknown = null;
  #dirty = false;
  #saving: Promise<void> = Promise.resolve();
  /** Writes that have started and not ended. */
  #inflight = 0;
  /** The text of a write that failed, tried again with the next debounce. */
  #failedText: string | null = null;
  #failures = 0;
  #names = new Map<string, { gameName: string; tagLine: string }>();
  #wasRunning = false;

  constructor(deps: TeamsDeps) {
    this.#d = deps;
  }

  get enabled(): boolean {
    return this.#enabled;
  }
  /** True while a change waits for the debounced save (main flushes before quitting). */
  get dirty(): boolean {
    return this.#dirty || this.#inflight > 0 || this.#failedText !== null;
  }
  /** Resolves when the cache has been loaded after enabling (tests, E2E). */
  get ready(): Promise<void> {
    return this.#ready;
  }
  /** The fetcher, while the flag is on and the cache is loaded (E2E / tests). */
  get fetcher(): TeamFetcher | null {
    return this.#fetcher;
  }

  state(): TeamsState {
    const f = this.#fetcher;
    if (!this.#enabled || !f || !this.#file) {
      return { enabled: this.#enabled, lobby: this.#enabled ? this.#lobby : null, players: {}, fetching: [], prefetch: IDLE_PREFETCH };
    }
    return { enabled: true, lobby: this.#lobby, players: this.#file.players, fetching: f.fetching(), prefetch: f.status() };
  }

  // ── gate ─────────────────────────────────────────────────────────

  /** The feature flag (from the renderer's settings). */
  setEnabled(enabled: boolean): void {
    if (enabled === this.#enabled) return;
    this.#enabled = enabled;
    const gen = ++this.#gen;
    if (enabled) {
      this.#d.log("Teams on");
      this.#ready = this.#start(gen);
    } else {
      this.#d.log("Teams off");
      this.#stop();
    }
  }

  async #start(gen: number): Promise<void> {
    await this.#saving; // a write from the previous run (flag turned off a moment ago) comes first
    let text: string | null = null;
    try {
      text = await this.#d.storage.load();
    } catch {
      this.#d.log("cache file could not be read; starting empty");
    }
    if (gen !== this.#gen) return;
    let file = emptyCache();
    if (text) {
      try {
        file = parseCacheFile(JSON.parse(text));
      } catch {
        this.#d.log("cache file is damaged; starting empty");
      }
    }
    file = pruneCache(file, this.#d.now());
    this.#file = file;
    const fetcher: TeamFetcher = new TeamFetcher({
      get: this.#d.get,
      build: this.#d.build,
      now: this.#d.now,
      sleep: this.#d.sleep,
      file,
      pollMs: RECONNECT_POLL_MS,
      onChange: () => {
        if (this.#fetcher === fetcher) this.#changed();
      },
    });
    this.#fetcher = fetcher;
    fetcher.setConnected(this.#connected);
    this.#d.log(`cache loaded: ${Object.keys(file.players).length} players`);
    this.#scheduleSend();
    this.#ensureLobby();
    this.#d.onEnabled?.();
  }

  #stop(): void {
    const f = this.#fetcher;
    this.#clear(this.#sendTimer);
    this.#sendTimer = null;
    // Data fetched while the flag was on is kept: write what is pending.
    if (this.#dirty && this.#file) void this.#save();
    else if (this.#failedText !== null) void this.#save();
    this.#clear(this.#saveTimer);
    this.#saveTimer = null;
    if (f) {
      f.dispose(); // queued and running work ends without another request; the fetcher is dropped
    }
    this.#fetcher = null;
    this.#file = null;
    this.#lobby = null;
    this.#key = "";
    this.#names.clear();
    this.#wasRunning = false;
    this.#d.send(this.state());
  }

  /** The League Client connected or disconnected. */
  setConnected(connected: boolean): void {
    this.#connected = connected;
    this.#fetcher?.setConnected(connected);
    if (!connected && this.#lobby) {
      this.#lobby = null; // a lobby seen before the connection dropped is not trusted
      this.#key = "";
      this.#scheduleSend();
    }
  }

  // ── lobby ────────────────────────────────────────────────────────

  /** The raw /lol-lobby/v2/lobby body (null for a Delete). Dropped while the flag is off. */
  onLobby(data: unknown): void {
    if (!this.#enabled) return;
    const lobby = parseCustomLobby(data);
    const key = lobbyKey(lobby);
    if (key === this.#key) return;
    this.#key = key;
    this.#lobby = lobby;
    this.#d.log(lobby ? `custom lobby: ${lobbyPuuids(lobby).length} players` : "left the custom lobby");
    this.#scheduleSend();
    this.#ensureLobby();
  }

  #ensureLobby(): void {
    const f = this.#fetcher;
    if (!f || !this.#lobby) return;
    f.ensure(lobbyPuuids(this.#lobby), { priority: "lobby", mode: "stale", addedBy: "lobby" });
  }

  // ── renderer calls ───────────────────────────────────────────────

  async #need(): Promise<TeamFetcher | null> {
    if (!this.#enabled) return null;
    await this.#ready;
    return this.#enabled ? this.#fetcher : null;
  }

  async friends(): Promise<FriendsResult> {
    const empty: FriendsResult = { groups: [], friends: [], self: null };
    const f = await this.#need();
    if (!f) return empty;
    const [g, fr, me] = await Promise.all([f.request("friendGroups"), f.request("friends"), f.request("currentSummoner")]);
    const groups: FriendGroup[] = [];
    for (const x of Array.isArray(okBody(g)) ? (okBody(g) as unknown[]) : []) {
      if (isObj(x) && Number.isInteger(x.id) && typeof x.name === "string") groups.push({ id: x.id as number, name: x.name });
    }
    const friends: FriendEntry[] = [];
    for (const x of Array.isArray(okBody(fr)) ? (okBody(fr) as unknown[]) : []) {
      if (!isObj(x) || !validPuuid(x.puuid)) continue;
      const tagLine = str(x.gameTag) || str(x.tagLine);
      if (!str(x.gameName)) continue;
      friends.push({
        puuid: x.puuid,
        gameName: str(x.gameName),
        tagLine,
        groupId: Number.isInteger(x.groupId) ? (x.groupId as number) : 0,
        groupName: str(x.groupName),
      });
    }
    const m = okBody(me);
    const self = isObj(m) && validPuuid(m.puuid) ? { puuid: m.puuid, gameName: str(m.gameName), tagLine: str(m.tagLine) } : null;
    for (const p of friends) this.#remember(p);
    if (self && self.gameName) this.#remember(self);
    return { groups, friends, self };
  }

  async recentPlayers(): Promise<RecentPlayer[]> {
    const f = await this.#need();
    if (!f) return [];
    const r = await f.request("recentlyPlayed");
    const body = okBody(r);
    const byPuuid = new Map<string, RecentPlayer>();
    for (const x of Array.isArray(body) ? (body as unknown[]) : []) {
      if (!isObj(x) || !validPuuid(x.puuid)) continue;
      const gameName = str(x.gameName) || str(x.summonerName);
      if (!gameName) continue;
      const when = typeof x.gameCreationDate === "number" ? x.gameCreationDate : Date.parse(str(x.gameCreationDate));
      const lastPlayedAt = Number.isFinite(when) ? when : 0;
      const seen = byPuuid.get(x.puuid);
      if (!seen || lastPlayedAt > seen.lastPlayedAt) byPuuid.set(x.puuid, { puuid: x.puuid, gameName, tagLine: str(x.tagLine), lastPlayedAt });
    }
    // Newest first; Map keeps the list order for equal times (the client lists newest games first).
    const list = [...byPuuid.values()].sort((a, b) => b.lastPlayedAt - a.lastPlayedAt).slice(0, RECENT_MAX);
    for (const p of list) this.#remember(p);
    return list;
  }

  async resolveRiotIds(lines: string[]): Promise<RiotIdResult[]> {
    const f = await this.#need();
    if (!f) return [];
    const out: RiotIdResult[] = [];
    for (const input of lines) {
      const { result, found } = await lookupRiotId((route, args) => f.request(route, args), input.trim());
      if (found) {
        f.upsertPlayer(found, "riotId");
        this.#remember(found);
      }
      out.push({ ...result, input });
    }
    this.#d.log(`riot ids: ${out.filter((r) => r.puuid).length} of ${out.length} found`);
    return out;
  }

  async prefetch(req: { puuids: string[]; mode: "stale" | "all"; addedBy?: "friend" | "recent" | "lobby" }): Promise<void> {
    const f = await this.#need();
    if (!f) return;
    for (const id of req.puuids) {
      const n = this.#names.get(id);
      if (n && !f.file.players[id]?.gameName) f.upsertPlayer({ puuid: id, ...n }, req.addedBy);
    }
    this.#d.log(`prefetch: ${req.puuids.length} players (${req.mode})`);
    f.ensure(req.puuids, { priority: "prefetch", mode: req.mode, addedBy: req.addedBy });
  }

  cancelPrefetch(): void {
    this.#fetcher?.cancelPrefetch();
  }

  refresh(puuid: string): void {
    this.#fetcher?.refresh(puuid);
  }

  forget(puuid: string): void {
    this.#fetcher?.forget(puuid);
  }

  /** Delete every cached value and the cache file. The lobby's players are fetched again. */
  async clearCache(): Promise<void> {
    const f = await this.#need();
    if (!f) return;
    f.clearCache();
    this.#names.clear();
    this.#clear(this.#saveTimer);
    this.#saveTimer = null;
    this.#dirty = false;
    this.#failedText = null;
    this.#failures = 0;
    await this.#saving;
    try {
      await this.#d.storage.remove();
    } catch {
      this.#d.log("cache file could not be removed");
    }
    this.#d.log("cache cleared");
    this.#scheduleSend();
    this.#ensureLobby();
  }

  /** Write a pending change now (before quitting). */
  async flush(): Promise<void> {
    this.#clear(this.#saveTimer);
    this.#saveTimer = null;
    for (let i = 0; i <= SAVE_RETRIES; i++) {
      await this.#save();
      await this.#saving;
      if (this.#failedText === null && !this.#dirty) break;
    }
  }

  // ── internals ────────────────────────────────────────────────────

  #remember(p: { puuid: string; gameName: string; tagLine: string }): void {
    if (!this.#names.has(p.puuid) && this.#names.size >= NAMES_MAX) return;
    this.#names.set(p.puuid, { gameName: p.gameName, tagLine: p.tagLine });
  }

  #clear(h: unknown): void {
    if (h !== null) this.#d.clearTimer(h);
  }

  #changed(): void {
    this.#dirty = true;
    if (this.#saveTimer === null) {
      this.#saveTimer = this.#d.setTimer(() => {
        this.#saveTimer = null;
        void this.#save();
      }, SAVE_DEBOUNCE_MS);
    }
    const running = this.#fetcher?.status().running ?? false;
    if (this.#wasRunning && !running) {
      const s = this.#fetcher!.status();
      this.#d.log(`prefetch finished: ${s.done} / ${s.total}, ${s.failed} failed`);
    }
    this.#wasRunning = running;
    this.#scheduleSend();
  }

  #scheduleSend(): void {
    if (this.#sendTimer !== null) return;
    this.#sendTimer = this.#d.setTimer(() => {
      this.#sendTimer = null;
      this.#d.send(this.state());
    }, STATE_PUSH_MS);
  }

  async #save(): Promise<void> {
    const file = this.#file;
    let text: string;
    if (file && this.#dirty) text = JSON.stringify(pruneCache(file, this.#d.now()));
    else if (this.#failedText !== null) text = this.#failedText;
    else return;
    this.#dirty = false;
    this.#failedText = null;
    this.#inflight++;
    this.#saving = this.#saving
      .then(() => this.#d.storage.save(text))
      .then(() => {
        this.#failures = 0;
      })
      .catch(() => {
        if (this.#dirty && this.#file) return; // a newer write is already due and will replace this one
        this.#failedText = text;
        if (++this.#failures >= SAVE_RETRIES) {
          this.#d.log("cache file could not be saved; giving up for now");
          this.#failures = 0;
          this.#failedText = null;
          if (this.#file) this.#dirty = true; // the next change or the quit writes it again
          return;
        }
        this.#d.log(`cache file could not be saved (try ${this.#failures} of ${SAVE_RETRIES})`);
        if (this.#saveTimer === null) {
          this.#saveTimer = this.#d.setTimer(() => {
            this.#saveTimer = null;
            void this.#save();
          }, SAVE_DEBOUNCE_MS);
        }
      })
      .finally(() => {
        this.#inflight--;
      });
    await this.#saving;
  }
}
