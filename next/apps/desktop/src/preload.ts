/**
 * Preload (sandboxed). Exposes exactly the LolViewerBridge interface and
 * nothing else — no ipcRenderer, no Node. Inputs are validated again in main.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { AppInfo, LcuProbeOptions, LcuProbeProgress, LcuProbeResult, LolViewerBridge, MatchState, OverlayPosition, OverlayRows, RecorderStatus, UpdateStatus, ViewCommand, ViewStatus } from "@lol-viewer/protocol";

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
  lcu: {
    reconnect: () => ipcRenderer.send("lcu:reconnect"),
    resync: () => ipcRenderer.send("lcu:resync"),
    probe: (opts: LcuProbeOptions) => ipcRenderer.invoke("lcu:probe", opts) as Promise<LcuProbeResult>,
    onProbeProgress: (cb: (p: LcuProbeProgress) => void) => on<LcuProbeProgress>("lcu:probe-progress", cb),
  },
  app: {
    info: () => ipcRenderer.invoke("app:info") as Promise<AppInfo>,
  },
  updates: {
    status: () => ipcRenderer.invoke("updates:status") as Promise<UpdateStatus>,
    onStatus: (cb: (s: UpdateStatus) => void) => on<UpdateStatus>("updates:status", cb),
    check: () => ipcRenderer.send("updates:check"),
    download: () => ipcRenderer.send("updates:download"),
    install: () => ipcRenderer.send("updates:install"),
  },
  live: {
    setEnabled: (enabled: boolean) => ipcRenderer.send("live:set-enabled", enabled === true),
  },
  overlay: {
    setEnabled: (enabled: boolean) => ipcRenderer.send("overlay:set-enabled", enabled === true),
    setRows: (rows: OverlayRows) => ipcRenderer.send("overlay:rows", rows),
    setPosition: (pos: OverlayPosition) => ipcRenderer.send("overlay:set-position", pos),
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
