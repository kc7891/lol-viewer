/**
 * Electron main process (🔴 zone: human review required).
 *
 * Wires: LCU connector -> Hub -> renderer (IPC) and renderer -> ExternalViewManager.
 *
 * Environment:
 *   LOL_LCU_LOCKFILE      lockfile path (fake LCU in tests / dev)
 *   LOL_VIEWER_WEB_URL    load the renderer from a dev server instead of the bundled build
 *   LOL_VIEWER_HUB_PORT   also serve the Hub on 127.0.0.1:<port> (0 = random)
 *   LOL_VIEWER_E2E=1      expose diagnostics on globalThis for Playwright
 *   LOL_VIEWER_RECORDINGS_DIR  where session recordings go (default Documents/LoL Viewer Next/recordings)
 *   LOL_LIVE_CLIENT_URL   Live Client Data API base URL (fake in tests)
 */
import { join } from "node:path";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { toLcuEvent } from "@lol-viewer/core";
import { Hub, startHubServer } from "@lol-viewer/hub";
import { startLcuConnector } from "@lol-viewer/lcu";
import { ViewCommandSchema } from "@lol-viewer/protocol";
import { ExternalViewManager } from "./external-views.ts";
import { RecordingController } from "./recording.ts";

const hub = new Hub();

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    backgroundColor: "#0d1117",
    title: "LoL Viewer",
    icon: join(__dirname, "..", "assets", process.platform === "win32" ? "app_icon.ico" : "main-icon.png"),
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  // The app window never navigates away from our UI.
  win.webContents.on("will-navigate", (ev) => ev.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });

  const devUrl = process.env.LOL_VIEWER_WEB_URL;
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(__dirname, "web", "index.html"));
  return win;
}

app.whenReady().then(async () => {
  const win = createWindow();
  const views = new ExternalViewManager(win, (s) => {
    if (!win.isDestroyed()) win.webContents.send("views:status", s);
  });

  // IPC: only from our own top-level renderer, only schema-valid input.
  const fromApp = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) =>
    e.sender === win.webContents && e.senderFrame === win.webContents.mainFrame;

  ipcMain.handle("hub:get", (e) => (fromApp(e) ? hub.state : null));
  ipcMain.on("views:command", (e, raw: unknown) => {
    if (!fromApp(e)) return;
    const cmd = ViewCommandSchema.safeParse(raw);
    if (cmd.success) views.handle(cmd.data);
    else console.warn("[views] rejected command", cmd.error.issues[0]?.message);
  });

  ipcMain.handle("app:info", (e) => (fromApp(e) ? { version: app.getVersion(), platform: process.platform } : null));

  hub.subscribe((state) => {
    if (!win.isDestroyed()) win.webContents.send("hub:state", state);
  });

  let recording: RecordingController | null = null;
  const connector = startLcuConnector({
    onEvent: (raw) => {
      recording?.onLcuEvent(raw);
      const e = toLcuEvent(raw);
      if (e) hub.dispatch(e);
    },
    onStatus: (status) => hub.dispatch({ type: "connection", status }),
  });
  ipcMain.on("lcu:reconnect", (e) => {
    if (fromApp(e)) connector.reconnect();
  });
  ipcMain.on("lcu:resync", (e) => {
    if (fromApp(e)) void connector.resync();
  });
  recording = new RecordingController(connector, (s) => {
    if (!win.isDestroyed()) win.webContents.send("recorder:status", s);
  });
  const rec = recording;
  ipcMain.handle("recorder:status", (e) => (fromApp(e) ? rec.status() : null));
  ipcMain.handle("recorder:start", (e) => (fromApp(e) ? rec.start() : null));
  ipcMain.handle("recorder:stop", (e) => (fromApp(e) ? rec.stop() : null));
  ipcMain.on("recorder:open-folder", (e) => {
    if (fromApp(e)) rec.openFolder();
  });

  let hubServer: Awaited<ReturnType<typeof startHubServer>> | null = null;
  if (process.env.LOL_VIEWER_HUB_PORT !== undefined) {
    hubServer = await startHubServer(hub, { port: Number(process.env.LOL_VIEWER_HUB_PORT) });
    console.log(`[hub] ${hubServer.url}/api/stream?token=${hubServer.token}`);
  }

  if (process.env.LOL_VIEWER_E2E === "1") {
    (globalThis as Record<string, unknown>).__lolViewer = { hub, views, recording: rec };
  }

  // Finish (flush and close) an active recording before quitting.
  let finishing = false;
  app.on("before-quit", (ev) => {
    if (!finishing && rec.status().recording) {
      ev.preventDefault();
      finishing = true;
      void rec.stop().finally(() => app.quit());
      return;
    }
    connector.stop();
    void hubServer?.close();
  });
});

app.on("window-all-closed", () => app.quit());

// Hardening: no other webContents may create windows or attach webviews.
app.on("web-contents-created", (_e, contents) => {
  contents.on("will-attach-webview", (ev) => ev.preventDefault());
});
