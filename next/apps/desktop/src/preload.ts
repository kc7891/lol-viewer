/**
 * Preload (sandboxed). Exposes exactly the LolViewerBridge interface and
 * nothing else — no ipcRenderer, no Node. Inputs are validated again in main.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { AppInfo, LcuProbeOptions, LcuProbeProgress, LcuProbeResult, LolViewerBridge, MatchState, OverlayPosition, OverlayRows, RecorderStatus, TeamsApi, TeamsState, UpdateStatus, ViewCommand, ViewStatus } from "@lol-viewer/protocol";

function on<T>(channel: string, cb: (v: T) => void): () => void {
  const h = (_e: IpcRendererEvent, v: T) => cb(v);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
}

const teams: TeamsApi = {
  getState: () => ipcRenderer.invoke("teams:get-state") as Promise<TeamsState>,
  onState(cb) {
    let pushed = false;
    const off = on<TeamsState>("teams:state", (s) => {
      pushed = true;
      cb(s);
    });
    void ipcRenderer.invoke("teams:get-state").then((s: TeamsState | null) => {
      if (s && !pushed) cb(s); // a push that arrived first is newer
    });
    return off;
  },
  setEnabled: (enabled: boolean) => ipcRenderer.send("teams:set-enabled", enabled === true),
  friends: () => ipcRenderer.invoke("teams:friends") as ReturnType<TeamsApi["friends"]>,
  recentPlayers: () => ipcRenderer.invoke("teams:recent") as ReturnType<TeamsApi["recentPlayers"]>,
  resolveRiotIds: (lines: string[]) => ipcRenderer.invoke("teams:resolve-riot-ids", lines) as ReturnType<TeamsApi["resolveRiotIds"]>,
  prefetch: (req) => ipcRenderer.send("teams:prefetch", req),
  cancelPrefetch: () => ipcRenderer.send("teams:cancel-prefetch"),
  refresh: (puuid: string) => ipcRenderer.send("teams:refresh", puuid),
  forget: (puuid: string) => ipcRenderer.send("teams:forget", puuid),
  clearCache: () => ipcRenderer.send("teams:clear-cache"),
  exportPrefs: (json: string) => ipcRenderer.invoke("teams:export-prefs", json) as ReturnType<TeamsApi["exportPrefs"]>,
};

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
  teams,
};

contextBridge.exposeInMainWorld("lolViewer", bridge);
