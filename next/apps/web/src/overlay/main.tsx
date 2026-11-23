import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { initialMatchState } from "@lol-viewer/core";
import type { LolOverlayBridge, MatchState, OverlayRows } from "@lol-viewer/protocol";
import { OverlayTable } from "./OverlayTable.tsx";
import "../styles.css";
import "./overlay.css";

declare global {
  interface Window {
    /** Injected by apps/desktop overlay-preload via contextBridge (receive-only). */
    lolOverlay?: LolOverlayBridge;
  }
}

document.documentElement.classList.add("overlay-page");

function Overlay({ bridge }: { bridge: LolOverlayBridge }) {
  const [match, setMatch] = useState<MatchState>(initialMatchState());
  const [rows, setRows] = useState<OverlayRows | null>(null);
  useEffect(() => bridge.onState(setMatch), [bridge]);
  useEffect(() => bridge.onRows(setRows), [bridge]);
  return rows ? <OverlayTable rows={rows} live={match.live ?? null} /> : null;
}

const bridge = window.lolOverlay;
if (bridge) {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Overlay bridge={bridge} />
    </StrictMode>,
  );
}
