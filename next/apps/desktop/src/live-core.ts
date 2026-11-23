/**
 * Live Client Data API gate (M-025): the poller runs only while the feature flag is on AND the
 * game is in progress. Off by default: nothing is requested until the renderer turns it on.
 * Electron-free so it can be unit-tested (like log-core / update-core).
 */
export const LIVE_POLL_MS = 2000;

export type LiveGateDeps = {
  /** Start polling (startLiveClientPoller). */
  start: () => { stop: () => void };
  /** Drop MatchState.live (dispatch {type: "live-players", players: null}). */
  clear: () => void;
};

export type LiveGate = {
  setEnabled(enabled: boolean): void;
  setPhase(phase: string): void;
  readonly enabled: boolean;
  readonly polling: boolean;
  dispose(): void;
};

export function createLiveGate(deps: LiveGateDeps): LiveGate {
  let enabled = false;
  let phase = "None";
  let poller: { stop: () => void } | null = null;
  const sync = () => {
    const want = enabled && phase === "InProgress";
    if (want && !poller) poller = deps.start();
    else if (!want && poller) {
      poller.stop();
      poller = null;
    }
  };
  return {
    setEnabled(v) {
      if (v === enabled) return;
      enabled = v;
      sync();
      if (!v) deps.clear();
    },
    // Never clears from here: this runs inside a Hub listener (a dispatch here would nest Hub
    // notifications). `live` stays after the game; the reducer drops it on the next match (M-031).
    setPhase(p) {
      if (p === phase) return;
      phase = p;
      sync();
    },
    get enabled() {
      return enabled;
    },
    get polling() {
      return poller != null;
    },
    dispose() {
      enabled = false;
      sync();
    },
  };
}
