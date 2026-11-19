/**
 * Browser-only bridge: replays a scenario through the real core reducer.
 * Used by `pnpm web:dev`, PR previews and Storybook — no LCU, no Electron.
 */
import { initialMatchState, parseScenario, reduce, toLcuEvent, type ScenarioLine } from "@lol-viewer/core";
import type { LolViewerBridge, MatchState } from "@lol-viewer/protocol";
import scenarioText from "../../../../scenarios/ranked-two-matches.jsonl?raw";

export type MockPlayer = LolViewerBridge & {
  play(speed?: number): void;
  pause(): void;
  reset(): void;
  readonly playing: boolean;
};

export function createMockBridge(lines: ScenarioLine[] = parseScenario(scenarioText)): MockPlayer {
  let state: MatchState = { ...initialMatchState(), connection: "connected" };
  const listeners = new Set<(s: MatchState) => void>();
  let timers: ReturnType<typeof setTimeout>[] = [];
  let playing = false;

  const set = (s: MatchState) => {
    if (s === state) return;
    state = s;
    listeners.forEach((l) => l(s));
  };

  return {
    kind: "mock",
    onState(cb) {
      listeners.add(cb);
      cb(state);
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
            if (e) set(reduce(state, e));
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
      set({ ...initialMatchState(), connection: "connected" });
    },
  };
}

/** A bridge pinned to one state — for stories and screenshots. */
export function staticBridge(state: MatchState): LolViewerBridge {
  return { kind: "mock", onState: (cb) => (cb(state), () => {}) };
}
