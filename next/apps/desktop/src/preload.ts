/**
 * Preload (sandboxed). Exposes exactly the LolViewerBridge interface and
 * nothing else — no ipcRenderer, no Node. Inputs are validated again in main.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { LolViewerBridge, MatchState, RecorderStatus, ViewCommand, ViewStatus } from "@lol-viewer/protocol";

function on<T>(channel: string, cb: (v: T) => void): () => void {
  const h = (_e: IpcRendererEvent, v: T) => cb(v);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
}

const bridge: LolViewerBridge = {
  kind: "electron",
  onState(cb) {
    const off = on<MatchState>("hub:state", cb);
    void ipcRenderer.invoke("hub:get").then((s: MatchState) => cb(s));
    return off;
  },
  views: {
    command: (cmd: ViewCommand) => ipcRenderer.send("views:command", cmd),
    onStatus: (cb: (s: ViewStatus) => void) => on<ViewStatus>("views:status", cb),
  },
  recorder: {
    start: () => ipcRenderer.invoke("recorder:start") as Promise<RecorderStatus>,
    stop: () => ipcRenderer.invoke("recorder:stop") as Promise<RecorderStatus>,
    status: () => ipcRenderer.invoke("recorder:status") as Promise<RecorderStatus>,
    openFolder: () => ipcRenderer.send("recorder:open-folder"),
    onStatus: (cb: (s: RecorderStatus) => void) => on<RecorderStatus>("recorder:status", cb),
  },
};

contextBridge.exposeInMainWorld("lolViewer", bridge);
