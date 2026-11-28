import { describe, expect, it } from "vitest";
import type { ProbeResponse, TeamsState } from "@lol-viewer/protocol";
import { emptyCache, parseCacheFile, type TeamCacheFile } from "@lol-viewer/core";
import { e2eSavePath, prefsFileName, RECENT_MAX, SAVE_DEBOUNCE_MS, STATE_PUSH_MS, TeamsController, type TeamsStorage } from "./teams-core.ts";

const NOW0 = 1_700_000_000_000;
const ok = (body: unknown): ProbeResponse => ({ status: 200, ms: 1, body });
const NOT_FOUND: ProbeResponse = { status: 404, ms: 1, body: null };
const rank = (tier: string) => ({ queueMap: { RANKED_SOLO_5x5: { tier, division: "II", leaguePoints: 10 }, RANKED_FLEX_SR: { tier: "", division: "NA" } } });
const lobbyBody = (t100: string[], t200: string[], spec: string[], extra: unknown[] = []) => ({
  gameConfig: {
    isCustom: true,
    customTeam100: t100.map((puuid) => ({ puuid, isBot: false })),
    customTeam200: [...t200.map((puuid) => ({ puuid, isBot: false })), ...extra],
    customSpectators: spec.map((puuid) => ({ puuid, isBot: false })),
  },
});

/** build() writes the route and its arguments as JSON, so the fake client can answer by route. */
function setup(o: { stored?: string | null; routes?: Record<string, (args: any) => ProbeResponse> } = {}) {
  let t = NOW0;
  let nextTimer = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const gets: { id: string; args: any }[] = [];
  const sent: TeamsState[] = [];
  const logs: string[] = [];
  const saved: string[] = [];
  let stored: string | null = o.stored ?? null;
  const calls = { load: 0, save: 0, remove: 0, onEnabled: 0 };
  /** While set, every GET waits for it (after being counted); likewise every save. */
  let hold: Promise<void> | null = null;
  let saveHold: Promise<void> | null = null;
  let failSaves = 0;
  const storage: TeamsStorage = {
    load: async () => (calls.load++, stored),
    save: async (text) => {
      calls.save++;
      if (saveHold) await saveHold;
      if (failSaves > 0) {
        failSaves--;
        throw new Error("rename failed");
      }
      saved.push(text);
      stored = text;
    },
    remove: async () => (calls.remove++, void (stored = null)),
  };
  const routes = o.routes ?? {};
  const c = new TeamsController({
    get: async (path) => {
      const { id, args } = JSON.parse(path) as { id: string; args: any };
      gets.push({ id, args });
      if (hold) await hold;
      const h = routes[id];
      if (h) return h(args);
      if (id === "summonerByPuuid") return ok({ gameName: `n-${args.params.puuid}`, tagLine: "t" });
      if (id === "rankedStats") return ok(rank("GOLD"));
      if (id === "matches") return ok({ games: { games: [] } });
      return NOT_FOUND;
    },
    build: (id, args) => JSON.stringify({ id, args }),
    now: () => t,
    sleep: async (ms) => void (t += ms),
    storage,
    send: (s) => void sent.push(s),
    setTimer: (fn, ms) => {
      const id = nextTimer++;
      timers.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimer: (h) => void timers.delete(h as number),
    onEnabled: () => void calls.onEnabled++,
    log: (m) => void logs.push(m),
  });
  const tick = (ms: number) => {
    const until = t + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, v]) => v.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      t = Math.max(t, due[1].at);
      due[1].fn();
    }
    t = until;
  };
  const settle = async () => {
    await c.ready;
    await c.fetcher?.idle();
    await new Promise((r) => setImmediate(r));
  };
  const later = () => {
    let release!: () => void;
    const p = new Promise<void>((r) => (release = r));
    return { p, release };
  };
  return {
    c, gets, sent, logs, saved, calls, tick, settle, stored: () => stored, timers, now: () => t,
    /** Hold the GETs; the returned function lets them go. */
    holdGets: () => {
      const h = later();
      hold = h.p;
      return () => {
        hold = null;
        h.release();
      };
    },
    holdSaves: () => {
      const h = later();
      saveHold = h.p;
      return () => {
        saveHold = null;
        h.release();
      };
    },
    failSaves: (n: number) => void (failSaves = n),
  };
}
const count = (s: ReturnType<typeof setup>, id: string) => s.gets.filter((g) => g.id === id).length;

describe("flag off (the default)", () => {
  it("does nothing: lobby events are dropped, no request, no file access", async () => {
    const s = setup({ stored: "{}" });
    s.c.setConnected(true);
    s.c.onLobby(lobbyBody(["a"], ["b"], []));
    expect(await s.c.friends()).toEqual({ groups: [], friends: [], self: null });
    expect(await s.c.recentPlayers()).toEqual([]);
    expect(await s.c.resolveRiotIds(["x#y"])).toEqual([]);
    await s.c.prefetch({ puuids: ["a"], mode: "stale" });
    await s.c.clearCache();
    s.tick(10_000);
    expect(s.gets).toEqual([]);
    expect(s.calls).toEqual({ load: 0, save: 0, remove: 0, onEnabled: 0 });
    expect(s.c.state()).toMatchObject({ enabled: false, lobby: null, players: {}, fetching: [] });
    expect(s.sent).toEqual([]);
  });
});

describe("custom lobby, flag on", () => {
  it("reads the cache, asks for the lobby again, and fetches the lobby's players (bots left out)", async () => {
    const s = setup();
    s.c.setConnected(true);
    s.c.setEnabled(true);
    await s.c.ready;
    expect(s.calls).toMatchObject({ load: 1, onEnabled: 1 });
    s.c.onLobby(lobbyBody(["a", "b"], ["c", "d"], ["e"], [{ isBot: true, puuid: "" }]));
    expect(s.c.state().lobby).toEqual({ team100: ["a", "b"], team200: ["c", "d"], spectators: ["e"] });
    await s.settle();
    expect(Object.keys(s.c.state().players).sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect(count(s, "rankedStats")).toBe(5);
    expect(s.c.state().players.a).toMatchObject({ gameName: "n-a", addedBy: "lobby" });
    expect(s.c.state().players.a!.rank!.solo).toMatchObject({ tier: "GOLD" });
  });

  it("leaves fresh cached players alone and fetches only the missing ones", async () => {
    const file: TeamCacheFile = emptyCache();
    file.players.a = {
      puuid: "a", gameName: "Cached", tagLine: "1", nameSeenAt: NOW0, previousNames: [], error: null, estimate: null,
      rank: { solo: null, flex: null, prevSeason: null, fetchedAt: NOW0 },
      lanes: { counts: { top: 0, jungle: 0, middle: 0, bottom: 0, support: 0 }, games: 0, fetchedAt: NOW0 },
    };
    const s = setup({ stored: JSON.stringify(file) });
    s.c.setConnected(true);
    s.c.setEnabled(true);
    await s.c.ready;
    // The unranked, estimate-less player still needs an estimate, but there is nothing to read for it here.
    s.c.onLobby(lobbyBody(["a"], ["b"], []));
    await s.settle();
    const ranked = s.gets.filter((g) => g.id === "rankedStats").map((g) => g.args.params.puuid);
    expect(ranked).toEqual(["b"]);
  });

  it("does not fetch again when the same lobby arrives twice, and fetches who joined", async () => {
    const s = setup();
    s.c.setConnected(true);
    s.c.setEnabled(true);
    await s.c.ready;
    s.c.onLobby(lobbyBody(["a"], [], []));
    await s.settle();
    const before = s.gets.length;
    s.c.onLobby(lobbyBody(["a"], [], []));
    await s.settle();
    expect(s.gets.length).toBe(before);
    s.c.onLobby(lobbyBody(["a"], ["z"], []));
    await s.settle();
    expect(s.gets.filter((g) => g.id === "rankedStats").map((g) => g.args.params.puuid)).toEqual(["a", "z"]);
  });

  it("a lobby that is not custom, or a Delete, clears the lobby", async () => {
    const s = setup();
    s.c.setConnected(true);
    s.c.setEnabled(true);
    await s.c.ready;
    s.c.onLobby(lobbyBody(["a"], [], []));
    expect(s.c.state().lobby).not.toBeNull();
    s.c.onLobby({ gameConfig: { isCustom: false } });
    expect(s.c.state().lobby).toBeNull();
    s.c.onLobby(lobbyBody(["a"], [], []));
    s.c.onLobby(null);
    expect(s.c.state().lobby).toBeNull();
  });

  it("a lobby event that arrives while the cache loads is used afterwards", async () => {
    const s = setup();
    s.c.setConnected(true);
    s.c.setEnabled(true);
    s.c.onLobby(lobbyBody(["a"], ["b"], []));
    await s.settle();
    expect(count(s, "rankedStats")).toBe(2);
  });

  it("forgets the lobby when the client disconnects, and waits for it to come back", async () => {
    const s = setup();
    s.c.setConnected(true);
    s.c.setEnabled(true);
    await s.c.ready;
    s.c.onLobby(lobbyBody(["a"], [], []));
    s.c.setConnected(false);
    expect(s.c.state().lobby).toBeNull();
  });

  it("does not log PUUIDs, names or ranks", async () => {
    const s = setup();
    s.c.setConnected(true);
    s.c.setEnabled(true);
    await s.c.ready;
    s.c.onLobby(lobbyBody(["alpha-puuid"], ["beta-puuid"], []));
    await s.settle();
    s.tick(5000);
    const text = s.logs.join("\n");
    expect(text).toContain("custom lobby: 2 players");
    expect(text).not.toMatch(/puuid|n-alpha|GOLD/);
  });
});

describe("state push and saving", () => {
  it("coalesces changes into one push within 200 ms", async () => {
    const s = setup();
    s.c.setConnected(true);
    s.c.setEnabled(true);
    await s.c.ready;
    s.sent.length = 0;
    s.c.onLobby(lobbyBody(["a", "b", "c"], [], []));
    await s.settle();
    expect(s.sent.length).toBe(0); // nothing before the timer
    s.tick(STATE_PUSH_MS);
    expect(s.sent.length).toBe(1);
    expect(Object.keys(s.sent[0]!.players).length).toBe(3);
  });

  it("saves once, about a second after the first change, as a file the loader accepts", async () => {
    const s = setup();
    s.c.setConnected(true);
    s.c.setEnabled(true);
    await s.c.ready;
    s.c.onLobby(lobbyBody(["a", "b"], [], []));
    await s.settle();
    expect(s.calls.save).toBe(0);
    expect(s.c.dirty).toBe(true);
    s.tick(SAVE_DEBOUNCE_MS);
    await s.settle();
    expect(s.calls.save).toBe(1);
    expect(s.c.dirty).toBe(false);
    const file = parseCacheFile(JSON.parse(s.saved[0]!));
    expect(Object.keys(file.players).sort()).toEqual(["a", "b"]);
  });

  it("flush() writes a pending change at once", async () => {
    const s = setup();
    s.c.setConnected(true);
    s.c.setEnabled(true);
    await s.c.ready;
    s.c.onLobby(lobbyBody(["a"], [], []));
    await s.settle();
    await s.c.flush();
    expect(s.calls.save).toBe(1);
    s.tick(5000);
    expect(s.calls.save).toBe(1);
  });

  it("drops cache entries older than 30 days on load, and survives a broken file", async () => {
    const old = emptyCache();
    old.players.old = {
      puuid: "old", gameName: "Old", tagLine: "1", nameSeenAt: NOW0 - 40 * 86_400_000, previousNames: [], error: null, estimate: null,
      rank: { solo: null, flex: null, prevSeason: null, fetchedAt: NOW0 - 40 * 86_400_000 }, lanes: null,
    };
    const a = setup({ stored: JSON.stringify(old) });
    a.c.setEnabled(true);
    await a.c.ready;
    expect(a.c.state().players).toEqual({});
    const b = setup({ stored: "{ not json" });
    b.c.setEnabled(true);
    await b.c.ready;
    expect(b.c.state()).toMatchObject({ enabled: true, players: {} });
  });
});

describe("turning the flag off and on", () => {
  it("off: stops fetching, writes the pending data once, and pushes a disabled state", async () => {
    const s = setup();
    s.c.setConnected(true);
    s.c.setEnabled(true);
    await s.c.ready;
    s.c.onLobby(lobbyBody(["a"], [], []));
    await s.settle();
    s.c.setEnabled(false);
    await s.settle();
    expect(s.calls.save).toBe(1);
    expect(s.sent.at(-1)).toMatchObject({ enabled: false, lobby: null, players: {} });
    const gets = s.gets.length;
    s.c.onLobby(lobbyBody(["x"], [], [])); // dropped again
    s.tick(10_000);
    expect(s.gets.length).toBe(gets);
  });

  it("on again: reads the file it wrote and asks for the lobby", async () => {
    const s = setup();
    s.c.setConnected(true);
    s.c.setEnabled(true);
    await s.c.ready;
    s.c.onLobby(lobbyBody(["a"], [], []));
    await s.settle();
    s.c.setEnabled(false);
    s.c.setEnabled(true);
    await s.c.ready;
    expect(s.calls.load).toBe(2);
    expect(s.calls.onEnabled).toBe(2);
    expect(Object.keys(s.c.state().players)).toEqual(["a"]);
  });
});

describe("renderer calls", () => {
  const routes = {
    friendGroups: () => ok([{ id: 0, name: "**Default", isMetaGroup: true }, { id: 3, name: "Customs" }, { nope: 1 }]),
    friends: () =>
      ok([
        { puuid: "f1", gameName: "Friend1", gameTag: "t1", groupId: 3, groupName: "Customs" },
        { puuid: "f2", gameName: "Friend2", gameTag: "t2", groupId: 0, groupName: "**Default" },
        { puuid: "", gameName: "NoId", gameTag: "x" },
      ]),
    currentSummoner: () => ok({ puuid: "me", gameName: "Me", tagLine: "t0" }),
    recentlyPlayed: () =>
      ok([
        { puuid: "r1", gameName: "Old", tagLine: "t", gameCreationDate: "2026-11-01T00:00:00.000Z" },
        { puuid: "r2", gameName: "Newest", tagLine: "t", gameCreationDate: "2026-11-20T00:00:00.000Z" },
        { puuid: "r1", gameName: "Old", tagLine: "t", gameCreationDate: "2026-11-10T00:00:00.000Z" },
        { puuid: "bad id", gameName: "X", tagLine: "t" },
      ]),
    summonerByName: (a: any) => (a.query.name === "Found#t9" ? ok({ puuid: "p9", gameName: "Found", tagLine: "t9" }) : NOT_FOUND),
  };

  it("friends: groups, friends (gameTag becomes tagLine) and myself", async () => {
    const s = setup({ routes });
    s.c.setConnected(true);
    s.c.setEnabled(true);
    const r = await s.c.friends();
    expect(r.groups).toEqual([{ id: 0, name: "**Default" }, { id: 3, name: "Customs" }]);
    expect(r.friends).toEqual([
      { puuid: "f1", gameName: "Friend1", tagLine: "t1", groupId: 3, groupName: "Customs" },
      { puuid: "f2", gameName: "Friend2", tagLine: "t2", groupId: 0, groupName: "**Default" },
    ]);
    expect(r.self).toEqual({ puuid: "me", gameName: "Me", tagLine: "t0" });
  });

  it("recent players: one entry per person, newest first, at most 200", async () => {
    const s = setup({ routes });
    s.c.setConnected(true);
    s.c.setEnabled(true);
    const r = await s.c.recentPlayers();
    expect(r.map((p) => p.puuid)).toEqual(["r2", "r1"]);
    expect(r[1]!.lastPlayedAt).toBe(Date.parse("2026-11-10T00:00:00.000Z"));
    const many = setup({
      routes: { recentlyPlayed: () => ok(Array.from({ length: 300 }, (_, i) => ({ puuid: `p${i}`, gameName: `N${i}`, tagLine: "t", gameCreationDate: 1000 + i }))) },
    });
    many.c.setConnected(true);
    many.c.setEnabled(true);
    expect((await many.c.recentPlayers()).length).toBe(RECENT_MAX);
  });

  it("Riot IDs: found people join the players with their name, the rest say why", async () => {
    const s = setup({ routes });
    s.c.setConnected(true);
    s.c.setEnabled(true);
    const r = await s.c.resolveRiotIds(["Found#t9", "Missing#t1", "no-tag"]);
    expect(r).toEqual([
      { input: "Found#t9", puuid: "p9", error: null },
      { input: "Missing#t1", puuid: null, error: "not-found" },
      { input: "no-tag", puuid: null, error: "format" },
    ]);
    expect(s.c.state().players.p9).toMatchObject({ gameName: "Found", tagLine: "t9", addedBy: "riotId" });
  });

  it("prefetch shows the names learned from the friends list and fetches the rest", async () => {
    const s = setup({ routes });
    s.c.setConnected(true);
    s.c.setEnabled(true);
    await s.c.friends();
    await s.c.prefetch({ puuids: ["f1", "f2"], mode: "stale", addedBy: "friend" });
    expect(s.c.state().players.f1).toMatchObject({ gameName: "Friend1", addedBy: "friend" });
    expect(s.c.state().prefetch.total).toBe(2);
    await s.settle();
    expect(s.c.state().prefetch).toMatchObject({ running: false, done: 2, total: 2 });
    expect(s.c.state().players.f1!.rank).not.toBeNull();
  });

  it("forget removes one person; clearCache empties everything, deletes the file and fetches the lobby again", async () => {
    const s = setup();
    s.c.setConnected(true);
    s.c.setEnabled(true);
    await s.c.ready;
    s.c.onLobby(lobbyBody(["a", "b"], [], []));
    await s.settle();
    s.tick(SAVE_DEBOUNCE_MS);
    await s.settle();
    s.c.forget("a");
    expect(Object.keys(s.c.state().players)).toEqual(["b"]);
    await s.c.clearCache();
    expect(s.calls.remove).toBe(1);
    expect(s.stored()).toBeNull();
    expect(s.c.dirty).toBe(true); // the lobby is being fetched again
    await s.settle();
    expect(Object.keys(s.c.state().players).sort()).toEqual(["a", "b"]);
  });
});

const spin = async (n = 5) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

describe("review fixes", () => {
  it("flag off while a lobby fetch runs: no GET afterwards, not even after the reconnect poll; on again: only the new fetcher asks", async () => {
    const s = setup();
    s.c.setConnected(true);
    s.c.setEnabled(true);
    await s.c.ready;
    const release = s.holdGets();
    s.c.onLobby(lobbyBody(["a", "b", "c"], [], []));
    await spin();
    expect(s.gets.length).toBeGreaterThan(0);
    s.c.setEnabled(false);
    const atOff = s.gets.length;
    release();
    await spin();
    s.tick(120_000); // longer than the 30 s reconnect poll
    await spin();
    expect(s.gets.length).toBe(atOff);
    expect(s.c.state().players).toEqual({});

    // On again: the old fetcher stays silent, the new one fetches the lobby once.
    s.c.setEnabled(true);
    await s.c.ready;
    s.c.onLobby(lobbyBody(["a"], [], []));
    await s.settle();
    expect(count(s, "rankedStats")).toBe(1); // none from the old fetcher
    expect(s.c.state().players.a?.rank).not.toBeNull();
  });

  it("clearCache during a lobby fetch: the lobby is fetched again and ends with name and rank", async () => {
    const s = setup();
    s.c.setConnected(true);
    s.c.setEnabled(true);
    await s.c.ready;
    const release = s.holdGets();
    s.c.onLobby(lobbyBody(["a", "b"], [], []));
    await spin();
    const cleared = s.c.clearCache();
    release();
    await cleared;
    await s.settle();
    for (const id of ["a", "b"]) {
      const p = s.c.state().players[id];
      expect(p?.gameName).toBe(`n-${id}`);
      expect(p?.rank).not.toBeNull();
    }
  });

  it("forget during a fetch: nothing of that person is in the saved file afterwards", async () => {
    const own = (puuid: string) => ({ gameId: 7, gameCreation: NOW0 - 1000, queueId: 420, participants: [{ timeline: { lane: "TOP", role: "SOLO" } }], participantIdentities: [{ player: { puuid } }] });
    const s = setup({ routes: { matches: (args) => ok({ games: { games: [own(args.params.puuid)] } }) } });
    s.c.setConnected(true);
    s.c.setEnabled(true);
    await s.c.ready;
    const release = s.holdGets();
    s.c.onLobby(lobbyBody(["a", "b"], [], []));
    await spin();
    s.c.forget("a");
    release();
    await s.settle();
    s.tick(SAVE_DEBOUNCE_MS);
    await spin();
    const file = parseCacheFile(JSON.parse(s.saved.at(-1)!));
    expect(Object.keys(file.players)).toEqual(["b"]);
    expect(Object.keys(file.playerGames)).toEqual(["b"]);
    expect(s.saved.at(-1)).not.toContain('"a"');
    expect(s.c.state().players.a).toBeUndefined();
  });

  it("a save that is in flight counts as unsaved, and flush() waits for it", async () => {
    const s = setup();
    s.c.setConnected(true);
    s.c.setEnabled(true);
    await s.c.ready;
    const release = s.holdSaves();
    s.c.onLobby(lobbyBody(["a"], [], []));
    await s.settle();
    s.tick(SAVE_DEBOUNCE_MS);
    await spin();
    expect(s.calls.save).toBe(1);
    expect(s.c.dirty).toBe(true); // main would not wait for it otherwise
    let done = false;
    const f = s.c.flush().then(() => void (done = true));
    await spin();
    expect(done).toBe(false);
    release();
    await f;
    expect(s.saved).toHaveLength(1);
    expect(s.c.dirty).toBe(false);
  });

  it("a failed write is tried again with the next debounce (three tries), counts only in the log", async () => {
    const s = setup();
    s.c.setConnected(true);
    s.c.setEnabled(true);
    await s.c.ready;
    s.failSaves(2);
    s.c.onLobby(lobbyBody(["a"], [], []));
    await s.settle();
    for (let i = 0; i < 3; i++) {
      s.tick(SAVE_DEBOUNCE_MS);
      await spin();
    }
    expect(s.calls.save).toBe(3);
    expect(s.saved).toHaveLength(1);
    expect(parseCacheFile(JSON.parse(s.saved[0]!)).players.a).toBeDefined();
    expect(s.c.dirty).toBe(false);
    expect(s.logs.filter((m) => /could not be saved/.test(m))).toHaveLength(2);
  });

  it("gives up after three failed tries, and the quit writes it once more", async () => {
    const s = setup();
    s.c.setConnected(true);
    s.c.setEnabled(true);
    await s.c.ready;
    s.failSaves(3);
    s.c.onLobby(lobbyBody(["a"], [], []));
    await s.settle();
    for (let i = 0; i < 6; i++) {
      s.tick(SAVE_DEBOUNCE_MS);
      await spin();
    }
    expect(s.calls.save).toBe(3);
    expect(s.c.dirty).toBe(true);
    await s.c.flush();
    expect(s.saved).toHaveLength(1);
    expect(s.c.dirty).toBe(false);
  });
});

describe("the preferences file (M-040)", () => {
  it("is named by the day, local time", () => {
    expect(prefsFileName(new Date(2026, 10, 7))).toBe("lol-viewer-team-preferences-20261107.json");
    expect(prefsFileName(new Date(2026, 11, 31))).toBe("lol-viewer-team-preferences-20261231.json");
  });
  it("the test save path is honoured only in an E2E run", () => {
    expect(e2eSavePath({ LOL_VIEWER_E2E: "1", LOL_VIEWER_E2E_SAVE_PATH: "/tmp/x.json" })).toBe("/tmp/x.json");
    expect(e2eSavePath({ LOL_VIEWER_E2E_SAVE_PATH: "/tmp/x.json" })).toBeNull();
    expect(e2eSavePath({ LOL_VIEWER_E2E: "0", LOL_VIEWER_E2E_SAVE_PATH: "/tmp/x.json" })).toBeNull();
    expect(e2eSavePath({ LOL_VIEWER_E2E: "1" })).toBeNull();
    expect(e2eSavePath({ LOL_VIEWER_E2E: "1", LOL_VIEWER_E2E_SAVE_PATH: "" })).toBeNull();
  });
});
