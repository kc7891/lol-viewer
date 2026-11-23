/**
 * Browser-only bridge: replays a scenario through the real core reducer.
 * Used by `pnpm web:dev`, PR previews and Storybook — no LCU, no Electron.
 * It has no `views` (ExternalViewSlot shows a placeholder) and no `app` (Settings shows "dev").
 */
import { initialDetectorState, initialMatchState, parseScenario, reduce, toLcuEvent, type DetectorState, type ScenarioLine } from "@lol-viewer/core";
import type { AppApi, LcuControlApi, LiveClientControlApi, LolViewerBridge, MatchState, OverlayControlApi, UpdateStatus, UpdatesApi } from "@lol-viewer/protocol";
import scenarioText from "../../../../scenarios/ranked-two-matches.jsonl?raw";

export type MockPlayer = LolViewerBridge & {
  play(speed?: number): void;
  pause(): void;
  reset(): void;
  readonly playing: boolean;
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
  };

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
  const overlay = opts.overlay === true ? { setEnabled() {}, setRows() {} } : opts.overlay;
  return { kind: "mock", onState: (cb) => (cb(state), () => {}), ...(lcu ? { lcu } : {}), ...(live ? { live } : {}), ...(overlay ? { overlay } : {}), ...(opts.app ? { app: opts.app } : {}), ...(opts.updates ? { updates: opts.updates } : {}) };
}
