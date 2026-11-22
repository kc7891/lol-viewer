import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { initialMatchState } from "@lol-viewer/core";
import type { LolViewerBridge, MatchState, UpdateStatus, ViewStatus } from "@lol-viewer/protocol";

declare global {
  interface Window {
    /** Injected by apps/desktop preload via contextBridge. */
    lolViewer?: LolViewerBridge;
  }
}

const BridgeContext = createContext<LolViewerBridge | null>(null);

/** When true, every ExternalViewSlot hides its native view (an HTML overlay is open). */
const SuppressViewsContext = createContext<boolean>(false);

export function BridgeProvider({ bridge, children }: { bridge: LolViewerBridge; children: ReactNode }) {
  return <BridgeContext.Provider value={bridge}>{children}</BridgeContext.Provider>;
}

export const SuppressViewsProvider = SuppressViewsContext.Provider;

/** Hide every native view below while `when` is true (drag in progress, app-wide modal). Nests with outer ones. */
export function SuppressViews({ when, children }: { when: boolean; children: ReactNode }) {
  const outer = useContext(SuppressViewsContext);
  return <SuppressViewsContext.Provider value={outer || when}>{children}</SuppressViewsContext.Provider>;
}

export function useBridge(): LolViewerBridge {
  const b = useContext(BridgeContext);
  if (!b) throw new Error("BridgeProvider missing");
  return b;
}

export function useSuppressViews(): boolean {
  return useContext(SuppressViewsContext);
}

export function useMatchState(): MatchState {
  const bridge = useBridge();
  // Bridges replay the current state synchronously on subscribe: take it for the first render so the
  // workspace never sees a bogus "initial" state first (that would count as a new match and close everything).
  const [state, setState] = useState<MatchState>(() => {
    let first: MatchState | undefined;
    bridge.onState((s) => (first = s))();
    return first ?? initialMatchState();
  });
  useEffect(() => bridge.onState(setState), [bridge]);
  return state;
}

/** Latest ViewStatus per viewId (current URL, back/forward, loading). Empty where there are no native views. */
const ViewStatusContext = createContext<ReadonlyMap<string, ViewStatus>>(new Map());

export function ViewStatusProvider({ children }: { children: ReactNode }) {
  const views = useBridge().views;
  const [map, setMap] = useState<ReadonlyMap<string, ViewStatus>>(new Map());
  useEffect(() => {
    if (!views) return;
    return views.onStatus((s) => setMap((m) => new Map(m).set(s.viewId, s)));
  }, [views]);
  return <ViewStatusContext.Provider value={map}>{children}</ViewStatusContext.Provider>;
}

export function useViewStatus(viewId: string): ViewStatus | undefined {
  return useContext(ViewStatusContext).get(viewId);
}

/** Latest UpdateStatus from the desktop app; null until the first answer, and always null where the bridge has no `updates` (browser, Storybook). */
export function useUpdateStatus(): UpdateStatus | null {
  const updates = useBridge().updates;
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  useEffect(() => {
    if (!updates) return setStatus(null);
    let live = true;
    const off = updates.onStatus((s) => live && setStatus(s));
    void updates.status().then(
      // A push that arrived while the first request was in flight is newer: keep it.
      (s) => live && setStatus((cur) => cur ?? s),
      () => {},
    );
    return () => {
      live = false;
      off();
    };
  }, [updates]);
  return status;
}
