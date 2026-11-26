import { describe, expect, it } from "vitest";
import { createOverlayGate, OVERLAY_POLL_MS, OVERLAY_SIZE, overlayBounds, type KeySource } from "./overlay-core.ts";

function setup(opts: { keys?: boolean } = {}) {
  const calls = { open: 0, close: 0, show: 0, hide: 0, error: 0, getKeys: 0, cleared: 0 };
  const state = { tab: false, fg: true, throws: false };
  const keys: KeySource = {
    isTabDown: () => {
      if (state.throws) throw new Error("no dll");
      return state.tab;
    },
    isGameForeground: () => state.fg,
  };
  let fn: (() => void) | null = null;
  let ms = 0;
  const gate = createOverlayGate({
    getKeys: () => (calls.getKeys++, opts.keys === false ? null : keys),
    open: () => void calls.open++,
    close: () => void calls.close++,
    show: () => void calls.show++,
    hide: () => void calls.hide++,
    onError: () => void calls.error++,
    setInterval: (f, m) => ((fn = f), (ms = m), 1),
    clearInterval: () => ((fn = null), void calls.cleared++),
  });
  return { gate, calls, state, tick: () => fn?.(), timer: () => ({ fn, ms }) };
}

const running = (s: ReturnType<typeof setup>) => {
  s.gate.setEnabled(true);
  s.gate.setPhase("InProgress");
};

describe("overlay gate (flag off => the key is never touched)", () => {
  it("does nothing without the flag, whatever the phase", () => {
    const s = setup();
    s.gate.setPhase("InProgress");
    expect(s.calls).toMatchObject({ getKeys: 0, open: 0 });
    expect(s.gate.polling).toBe(false);
  });

  it("does nothing outside InProgress", () => {
    const s = setup();
    s.gate.setEnabled(true);
    s.gate.setPhase("ChampSelect");
    expect(s.calls).toMatchObject({ getKeys: 0, open: 0 });
  });

  it("does nothing when there is no key source (not Windows)", () => {
    const s = setup({ keys: false });
    running(s);
    expect(s.gate.polling).toBe(false);
    expect(s.calls.open).toBe(0);
  });

  it("opens the window and polls every 50 ms once enabled in a game", () => {
    const s = setup();
    running(s);
    running(s);
    expect(s.calls).toMatchObject({ open: 1, getKeys: 1 });
    expect(s.timer().ms).toBe(OVERLAY_POLL_MS);
    expect(s.gate.polling).toBe(true);
    expect(s.gate.visible).toBe(false);
  });

  it("starts when the flag is turned on in a running game", () => {
    const s = setup();
    s.gate.setPhase("InProgress");
    s.gate.setEnabled(true);
    expect(s.gate.polling).toBe(true);
  });
});

describe("overlay gate (Tab and foreground)", () => {
  it("shows once on Tab and hides once on release", () => {
    const s = setup();
    running(s);
    s.tick();
    expect(s.calls).toMatchObject({ show: 0, hide: 0 });
    s.state.tab = true;
    s.tick();
    s.tick();
    expect(s.calls.show).toBe(1);
    expect(s.gate.visible).toBe(true);
    s.state.tab = false;
    s.tick();
    s.tick();
    expect(s.calls).toMatchObject({ show: 1, hide: 1 });
    expect(s.gate.visible).toBe(false);
  });

  it("stays hidden when the game is not the foreground window", () => {
    const s = setup();
    running(s);
    s.state.tab = true;
    s.state.fg = false;
    s.tick();
    expect(s.calls.show).toBe(0);
    s.state.fg = true;
    s.tick();
    expect(s.calls.show).toBe(1);
    s.state.fg = false; // Alt+Tab away while holding Tab
    s.tick();
    expect(s.calls.hide).toBe(1);
  });
});

describe("overlay gate (conditions drop)", () => {
  it("the end of the game stops the timer, hides and closes", () => {
    const s = setup();
    running(s);
    s.state.tab = true;
    s.tick();
    s.gate.setPhase("EndOfGame");
    expect(s.gate.polling).toBe(false);
    expect(s.gate.visible).toBe(false);
    expect(s.calls).toMatchObject({ hide: 1, close: 1, cleared: 1 });
  });

  it("turning the flag off while hidden closes without a hide call", () => {
    const s = setup();
    running(s);
    s.gate.setEnabled(false);
    expect(s.calls).toMatchObject({ hide: 0, close: 1, cleared: 1 });
    expect(s.gate.enabled).toBe(false);
  });

  it("a new game after the old one opens a new window", () => {
    const s = setup();
    running(s);
    s.gate.setPhase("EndOfGame");
    s.gate.setPhase("InProgress");
    expect(s.calls).toMatchObject({ open: 2, close: 1, getKeys: 1 });
  });

  it("dispose stops everything", () => {
    const s = setup();
    running(s);
    s.gate.dispose();
    expect(s.gate.polling).toBe(false);
    expect(s.calls.close).toBe(1);
  });
});

describe("overlay gate (key source throws)", () => {
  it("reports once, stops the timer and closes", () => {
    const s = setup();
    running(s);
    s.state.throws = true;
    s.tick();
    expect(s.calls).toMatchObject({ error: 1, close: 1, cleared: 1 });
    expect(s.gate.polling).toBe(false);
    s.tick(); // the timer is gone: no more calls
    expect(s.calls.error).toBe(1);
  });

  it("hides when it was visible; the next game tries again", () => {
    const s = setup();
    running(s);
    s.state.tab = true;
    s.tick();
    s.state.throws = true;
    s.tick();
    expect(s.calls.hide).toBe(1);
    s.gate.setPhase("InProgress"); // same phase: no retry in this game
    expect(s.gate.polling).toBe(false);
    s.state.throws = false;
    s.gate.setPhase("EndOfGame");
    s.gate.setPhase("InProgress");
    expect(s.gate.polling).toBe(true);
  });
});

describe("overlayBounds", () => {
  const game = { x: 100, y: 50, width: 1920, height: 1080 };
  const left = 100 + 20;
  const center = 100 + (1920 - OVERLAY_SIZE.width) / 2;
  const right = 100 + 1920 - OVERLAY_SIZE.width - 20;
  const top = 50 + 20;
  const bottom = 50 + 1080 - OVERLAY_SIZE.height - 20;
  it("defaults to bottom-left, 20 from its left and bottom edges", () => {
    expect(overlayBounds(game)).toEqual({ x: left, y: bottom, ...OVERLAY_SIZE });
  });
  it.each([
    ["left", "top", left, top],
    ["center", "top", center, top],
    ["right", "top", right, top],
    ["left", "bottom", left, bottom],
    ["center", "bottom", center, bottom],
    ["right", "bottom", right, bottom],
  ] as const)("%s %s", (horizontal, vertical, x, y) => {
    expect(overlayBounds(game, { horizontal, vertical })).toEqual({ x, y, ...OVERLAY_SIZE });
  });
  it("rounds odd centers", () => {
    expect(overlayBounds({ x: 0, y: 0, width: 1001, height: 600 }, { horizontal: "center", vertical: "top" }).x).toBe(Math.round((1001 - OVERLAY_SIZE.width) / 2));
  });
  it("never above or left of the window when it is smaller than the table", () => {
    const small = { x: 10, y: 30, width: 300, height: 150 };
    for (const horizontal of ["left", "center", "right"] as const)
      for (const vertical of ["top", "bottom"] as const) {
        const b = overlayBounds(small, { horizontal, vertical });
        expect(b.x).toBeGreaterThanOrEqual(10);
        expect(b.y).toBeGreaterThanOrEqual(30);
      }
    expect(overlayBounds(small, { horizontal: "right", vertical: "bottom" })).toEqual({ x: 10, y: 30, ...OVERLAY_SIZE });
    expect(overlayBounds({ x: 0, y: 30, width: 400, height: 150 })).toEqual({ x: 20, y: 30, ...OVERLAY_SIZE });
  });
});
