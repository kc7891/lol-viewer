/**
 * Preload of the in-game overlay window (sandboxed, 🔴). Receive-only: the page can listen to
 * the match state and the matchup rows, and has no way to send anything to main.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { LolOverlayBridge, MatchState, OverlayRows } from "@lol-viewer/protocol";

// Listen from the start and keep the latest values: the page may subscribe after they arrived.
let state: MatchState | undefined;
let rows: OverlayRows | undefined;
const stateListeners = new Set<(s: MatchState) => void>();
const rowsListeners = new Set<(r: OverlayRows) => void>();
ipcRenderer.on("hub:state", (_e: IpcRendererEvent, s: MatchState) => {
  state = s;
  stateListeners.forEach((l) => l(s));
});
ipcRenderer.on("overlay:rows", (_e: IpcRendererEvent, r: OverlayRows) => {
  rows = r;
  rowsListeners.forEach((l) => l(r));
});

const bridge: LolOverlayBridge = {
  onState(cb) {
    stateListeners.add(cb);
    if (state) cb(state);
    return () => void stateListeners.delete(cb);
  },
  onRows(cb) {
    rowsListeners.add(cb);
    if (rows) cb(rows);
    return () => void rowsListeners.delete(cb);
  },
};

contextBridge.exposeInMainWorld("lolOverlay", bridge);
