/**
 * In-game overlay gate (M-034): the Tab key is read only while the feature is on AND a game is in
 * progress AND this OS has a key source. Off by default: nothing is read until the renderer turns it on.
 * Electron-free so it can be unit-tested (like live-core / log-core).
 */
import type { OverlayPosition } from "@lol-viewer/protocol";

export const OVERLAY_POLL_MS = 50;
/** Content size of the overlay window in CSS pixels (same numbers as apps/web/src/overlay/OverlayTable.tsx). */
export const OVERLAY_SIZE = { width: 360, height: 204 } as const;
/** Gap between the table and the game window's edges, in DIPs (M-035, M-036). */
export const OVERLAY_EDGE_MARGIN = 20;

/** Bottom-left (M-035). */
export const DEFAULT_OVERLAY_POSITION: OverlayPosition = { horizontal: "left", vertical: "bottom" };

export type Rect = { x: number; y: number; width: number; height: number };

export type KeySource = {
  /** Tab is down right now (GetAsyncKeyState, most significant bit). */
  isTabDown(): boolean;
  /** The foreground window is the League of Legends game. */
  isGameForeground(): boolean;
  /** Bounds of the foreground game window in screen pixels; null when unknown. */
  gameRect?(): Rect | null;
};

export type OverlayGateDeps = {
  /** The key source for this OS, created when first needed (null: nothing to do, e.g. not Windows). */
  getKeys: () => KeySource | null;
  /** Create the (hidden) overlay window. */
  open(): void;
  /** Close it. */
  close(): void;
  /** Place it on the game window and show it without taking focus. */
  show(keys: KeySource): void;
  hide(): void;
  /** Called once when reading the key throws; polling stops. */
  onError?(err: unknown): void;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: any) => void;
};

export type OverlayGate = {
  /** inGameOverlay && liveClientData (the renderer computes it). */
  setEnabled(enabled: boolean): void;
  setPhase(phase: string): void;
  readonly enabled: boolean;
  readonly polling: boolean;
  readonly visible: boolean;
  dispose(): void;
};

export function createOverlayGate(deps: OverlayGateDeps): OverlayGate {
  let enabled = false;
  let phase = "None";
  let keys: KeySource | null | undefined; // undefined: not asked yet
  let failed = false;
  let timer: unknown = null;
  let visible = false;

  const stop = () => {
    if (timer == null) return;
    deps.clearInterval(timer);
    timer = null;
    if (visible) {
      visible = false;
      deps.hide();
    }
    deps.close();
  };

  const tick = () => {
    if (!keys) return;
    let want: boolean;
    try {
      want = keys.isTabDown() && keys.isGameForeground();
    } catch (err) {
      failed = true; // log once, stop: no 50 ms log flood
      deps.onError?.(err);
      sync();
      return;
    }
    if (want === visible) return;
    visible = want;
    if (want) deps.show(keys);
    else deps.hide();
  };

  function sync() {
    const base = enabled && phase === "InProgress";
    if (!base) failed = false;
    if (base && !failed && timer == null) {
      if (keys === undefined) keys = deps.getKeys();
      if (keys) {
        deps.open();
        timer = deps.setInterval(tick, OVERLAY_POLL_MS);
      }
    } else if ((!base || failed) && timer != null) stop();
  }

  return {
    setEnabled(v) {
      if (v === enabled) return;
      enabled = v;
      sync();
    },
    setPhase(p) {
      if (p === phase) return;
      phase = p;
      sync();
    },
    get enabled() {
      return enabled;
    },
    get polling() {
      return timer != null;
    },
    get visible() {
      return visible;
    },
    dispose() {
      enabled = false;
      sync();
    },
  };
}

/**
 * Where the table goes on the game window (M-036): OVERLAY_EDGE_MARGIN from the chosen edges, centered
 * horizontally for "center". Never above or left of the window when it is smaller than the table.
 * `game` is in DIPs (the caller converts).
 */
export function overlayBounds(
  game: Rect,
  pos: OverlayPosition = DEFAULT_OVERLAY_POSITION,
  size: { width: number; height: number } = OVERLAY_SIZE,
): Rect {
  const M = OVERLAY_EDGE_MARGIN;
  const x = pos.horizontal === "left" ? game.x + M : pos.horizontal === "right" ? game.x + game.width - size.width - M : game.x + (game.width - size.width) / 2;
  const y = pos.vertical === "top" ? game.y + M : game.y + game.height - size.height - M;
  return { x: Math.round(Math.max(x, game.x)), y: Math.round(Math.max(y, game.y)), width: size.width, height: size.height };
}
