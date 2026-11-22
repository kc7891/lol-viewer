import { useState } from "react";
import type { MockPlayer } from "./bridge/mock.ts";

/** Playback controls for the browser/preview mock (never shown in Electron). */
export function MockBar({ player }: { player: MockPlayer }) {
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);
  return (
    <div className="mockbar">
      <span className="tag">MOCK</span>
      <button type="button" className="btn" onClick={() => (player.play(1), rerender())}>
        Play scenario
      </button>
      <button type="button" className="btn" onClick={() => (player.play(10), rerender())}>
        x10
      </button>
      <button type="button" className="btn" onClick={() => (player.reset(), rerender())}>
        Reset
      </button>
    </div>
  );
}
