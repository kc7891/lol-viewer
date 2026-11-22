import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { initialMatchState } from "@lol-viewer/core";
import type { LolViewerBridge, MatchState } from "@lol-viewer/protocol";

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
  const [state, setState] = useState<MatchState>(initialMatchState);
  useEffect(() => bridge.onState(setState), [bridge]);
  return state;
}
