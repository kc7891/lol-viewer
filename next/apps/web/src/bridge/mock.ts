/**
 * Browser-only bridge: replays a scenario through the real core reducer.
 * Used by `pnpm web:dev`, PR previews and Storybook — no LCU, no Electron.
 * It has no `views` (ExternalViewSlot shows a placeholder) and no `app` (Settings shows "dev").
 */
import { formatProbeReport, initialDetectorState, initialMatchState, parseScenario, reduce, toLcuEvent, type DetectorState, type ScenarioLine } from "@lol-viewer/core";
import type { AppApi, LcuControlApi, LcuProbeProgress, LcuProbeReport, LcuProbeResult, LiveClientControlApi, LolViewerBridge, MatchState, OverlayControlApi, UpdateStatus, UpdatesApi } from "@lol-viewer/protocol";
import scenarioText from "../../../../scenarios/ranked-two-matches.jsonl?raw";

export type MockPlayer = LolViewerBridge & {
  play(speed?: number): void;
  pause(): void;
  reset(): void;
  readonly playing: boolean;
};

/** A fixed, synthetic LCU check report (no real data) for the mock bridge and stories. */
export const MOCK_PROBE_REPORT: LcuProbeReport = {
  startedAt: "2026-11-27T12:34:56.000Z",
  appVersion: "0.0.0",
  platform: "win32",
  steps: [
    { n: 1, name: "current-summoner", route: "currentSummoner", status: 200, ms: 38, shape: "{accountId:num, gameName:str(6), puuid:str(78), summonerLevel:num, tagLine:str(3)}" },
    { n: 2, name: "lobby", route: "lobby", status: 404, ms: 12, note: "not in a lobby", shape: '{errorCode:"RPC_ERROR", httpStatus:404, message:str(24)}' },
    { n: 3, name: "friend-groups", route: "friendGroups", status: 200, ms: 20, shape: "[2]{id:num, name:str(7), totalCount:num}", facts: { count: 2 } },
    {
      n: 5, name: "friends", route: "friends", status: 200, ms: 140, shape: "[42]{puuid:str(78), gameName:str(5), gameTag:str(3), groupId:num, groupName:str(7)}",
      facts: { count: 42, puuid: "yes", gameName: "yes", gameTag: "yes", groupId: "yes", groupName: "yes", displayGroupId: "no" },
    },
    { n: 8, name: "ranked-stats batch json", route: "rankedStatsBatch", status: 200, ms: 210, facts: { returned: 2 } },
    { n: 8, name: "ranked-stats batch comma", route: "rankedStatsBatch", status: 400, ms: 20 },
    { n: 10, name: "matches (self, 0-20)", route: "matches", status: 200, ms: 480, facts: { games: 20, queues: "420x12 450x6 430x2", spanDays: 31.5, lane: "JUNGLE", role: "NONE" } },
    { n: 17, name: "summoners?name (input)", route: "summonerByName", status: "skipped", ms: 0, note: "no Riot ID entered" },
  ],
};

export function createMockBridge(lines: ScenarioLine[] = parseScenario(scenarioText)): MockPlayer {
  const fresh = (): DetectorState => {
    const d = initialDetectorState();
    return { ...d, match: { ...d.match, connection: "connected" } };
  };
  let detector = fresh();
  const listeners = new Set<(s: MatchState) => void>();
  let timers: ReturnType<typeof setTimeout>[] = [];
  let playing = false;

  const emit = () => listeners.forEach((l) => l(detector.match));
  const setDetector = (d: DetectorState) => {
    if (d === detector) return;
    detector = d;
    emit();
  };
  const setConnection = (connection: MatchState["connection"]) =>
    setDetector({ ...detector, match: { ...detector.match, connection } });

  const lcu: LcuControlApi = {
    reconnect() {
      setConnection("connecting");
      timers.push(setTimeout(() => setConnection("connected"), 1000));
    },
    resync() {},
    probe: () => mockProbe(),
    onProbeProgress: (cb) => {
      progressListeners.add(cb);
      return () => progressListeners.delete(cb);
    },
  };
  const progressListeners = new Set<(p: LcuProbeProgress) => void>();
  /** The fixed report after about a second, with a little progress on the way. */
  const mockProbe = (): Promise<LcuProbeResult> =>
    new Promise((resolve) => {
      [250, 500, 750].forEach((ms, i) => setTimeout(() => progressListeners.forEach((l) => l({ done: (i + 1) * 5, total: 20 })), ms));
      setTimeout(() => resolve({ text: formatProbeReport(MOCK_PROBE_REPORT), report: MOCK_PROBE_REPORT }), 1000);
    });

  return {
    kind: "mock",
    lcu,
    onState(cb) {
      listeners.add(cb);
      cb(detector.match);
      return () => listeners.delete(cb);
    },
    get playing() {
      return playing;
    },
    play(speed = 1) {
      if (playing) return;
      playing = true;
      lines.forEach((line, i) =>
        timers.push(
          setTimeout(() => {
            const e = toLcuEvent(line);
            if (e) setDetector(reduce(detector, e));
            if (i === lines.length - 1) playing = false;
          }, line.t / speed),
        ),
      );
    },
    pause() {
      timers.forEach(clearTimeout);
      timers = [];
      playing = false;
    },
    reset() {
      this.pause();
      setDetector(fresh());
    },
  };
}

/**
 * An UpdatesApi pinned to `initial`. With `simulate`, Check / Download / Restart play out a fake
 * "0.2.0 is available" flow (for the Storybook e2e); without it the buttons do nothing.
 */
export function mockUpdates(initial: UpdateStatus, simulate = false): UpdatesApi {
  let status = initial;
  const listeners = new Set<(s: UpdateStatus) => void>();
  const set = (patch: Partial<UpdateStatus>) => {
    status = { ...status, ...patch };
    listeners.forEach((l) => l(status));
  };
  return {
    status: async () => status,
    onStatus(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    check() {
      if (!simulate) return;
      set({ state: "checking", error: null });
      setTimeout(() => set({ state: "available", latestVersion: "0.2.0" }), 300);
    },
    download() {
      if (!simulate) return;
      set({ state: "downloading", percent: 0 });
      [25, 60, 100].forEach((p, i) => setTimeout(() => set(p === 100 ? { state: "downloaded", percent: 100 } : { percent: p }), 200 * (i + 1)));
    },
    install() {
      if (simulate) set({ state: "idle", currentVersion: status.latestVersion ?? status.currentVersion, latestVersion: null, percent: null });
    },
  };
}

export type StaticBridgeOptions = {
  /** Give the bridge a League Client control API (Settings -> Reconnect). */
  lcu?: LcuControlApi | true;
  app?: AppApi;
  /** Give the bridge the desktop update API (Settings > Version). */
  updates?: UpdatesApi;
  /** Give the bridge the desktop Live Client switch (Settings > Feature flags). */
  live?: LiveClientControlApi | true;
  /** Give the bridge the desktop in-game overlay switch (Settings > Feature flags). */
  overlay?: OverlayControlApi | true;
};

/** A bridge pinned to one state — for stories and screenshots. */
export function staticBridge(state: MatchState, opts: StaticBridgeOptions = {}): LolViewerBridge {
  const lcu = opts.lcu === true ? { reconnect() {}, resync() {} } : opts.lcu;
  const live = opts.live === true ? { setEnabled() {} } : opts.live;
  const overlay = opts.overlay === true ? { setEnabled() {}, setRows() {}, setPosition() {} } : opts.overlay;
  return { kind: "mock", onState: (cb) => (cb(state), () => {}), ...(lcu ? { lcu } : {}), ...(live ? { live } : {}), ...(overlay ? { overlay } : {}), ...(opts.app ? { app: opts.app } : {}), ...(opts.updates ? { updates: opts.updates } : {}) };
}
