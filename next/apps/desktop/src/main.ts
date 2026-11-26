/**
 * Electron main process (🔴 zone: human review required).
 *
 * Wires: LCU connector -> Hub -> renderer (IPC) and renderer -> ExternalViewManager.
 *
 * Environment:
 *   LOL_LCU_LOCKFILE      lockfile path (fake LCU in tests / dev)
 *   LOL_VIEWER_WEB_URL    load the renderer from a dev server instead of the bundled build
 *   LOL_VIEWER_HUB_PORT   also serve the Hub on 127.0.0.1:<port> (0 = random)
 *   LOL_VIEWER_E2E=1      expose diagnostics on globalThis for Playwright (also skips the single-instance lock)
 *   LOL_VIEWER_DEBUG=1    debug mode (also: --debug, or an executable name containing "debug"): log to a file under app.getPath("logs")
 *   LOL_VIEWER_RECORDINGS_DIR  where session recordings go (default Documents/LoL Viewer Next/recordings)
 *   LOL_VIEWER_UPDATE_URL        update feed base URL (default: the app-latest GitHub Release); tests point it at a local server
 *   LOL_VIEWER_DISABLE_UPDATES=1 never check for updates (also off when not packaged or LOL_VIEWER_E2E=1)
 *   LOL_LIVE_CLIENT_URL   Live Client Data API base URL (fake in tests). Used by the recorder and, with the liveClientData flag on, in game
 *   LOL_OVERLAY_FAKE_KEYS=<file>  in-game overlay: read Tab from this file (`tab` / `none`) instead of Windows (E2E only)
 *   LOL_VIEWER_USER_DATA_DIR  use this folder instead of the user's profile data (E2E: never touch real settings)
 */
import { join } from "node:path";
import { app, BrowserWindow, ipcMain, Menu, screen, shell } from "electron";
import { toLcuEvent } from "@lol-viewer/core";
import { Hub, startHubServer } from "@lol-viewer/hub";
import { startLcuConnector, startLiveClientPoller } from "@lol-viewer/lcu";
import { OverlayPositionSchema, OverlayRowsSchema, ViewCommandSchema, type OverlayPosition, type OverlayRows } from "@lol-viewer/protocol";
import { ExternalViewManager } from "./external-views.ts";
import { createLiveGate, LIVE_POLL_MS } from "./live-core.ts";
import { createOverlayGate, DEFAULT_OVERLAY_POSITION, overlayBounds, OVERLAY_SIZE } from "./overlay-core.ts";
import { createKeySource } from "./win-keys.ts";
import { RecordingController } from "./recording.ts";
import { createUpdater } from "./updater.ts";
import { attachRendererLogging, initLogging, installProcessHandlers, log } from "./log.ts";

// Before anything reads app paths (logs, single-instance lock, localStorage, sessions).
if (process.env.LOL_VIEWER_USER_DATA_DIR) app.setPath("userData", process.env.LOL_VIEWER_USER_DATA_DIR);

initLogging();
installProcessHandlers();

// Single instance. The lock is per userData directory and the E2E tests launch several app
// instances (some concurrently, with the default userData), so the lock would make them quit
// each other; skip it when LOL_VIEWER_E2E=1.
const gotLock = process.env.LOL_VIEWER_E2E === "1" || app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
}

const hub = new Hub();

// No application menu (the old app had none). The default menu's Reload (Ctrl+R) would
// reload the UI and drop every open viewer; text editing shortcuts still work in inputs.
Menu.setApplicationMenu(null);

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

  attachRendererLogging(win.webContents);
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

if (gotLock) void app.whenReady().then(async () => {
  log.info("main", `LoL Viewer ${app.getVersion()} starting`);
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
    else log.warn("views", "rejected command", cmd.error.issues[0]?.message);
  });

  ipcMain.handle("app:info", (e) => (fromApp(e) ? { version: app.getVersion(), platform: process.platform } : null));

  const updater = createUpdater();
  updater.subscribe((s) => {
    if (!win.isDestroyed()) win.webContents.send("updates:status", s);
  });
  ipcMain.handle("updates:status", (e) => (fromApp(e) ? updater.status : null));
  ipcMain.on("updates:check", (e) => {
    if (fromApp(e)) void updater.check();
  });
  ipcMain.on("updates:download", (e) => {
    if (fromApp(e)) void updater.download();
  });
  ipcMain.on("updates:install", (e) => {
    if (fromApp(e)) updater.install();
  });

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
  // M-025: Live Client Data API, only while the feature flag is on and a game is in progress (GET, 127.0.0.1 only).
  const live = createLiveGate({
    start: () => {
      try {
        return startLiveClientPoller({
          intervalMs: LIVE_POLL_MS,
          onData: (raw) => {
            const e = toLcuEvent(raw);
            if (e) hub.dispatch(e);
          },
        });
      } catch (err) {
        log.warn("live", "live client poller not started", String(err)); // e.g. LOL_LIVE_CLIENT_URL not on 127.0.0.1
        return { stop: () => {} };
      }
    },
    clear: () => hub.dispatch({ type: "live-players", players: null }),
  });
  hub.subscribe((s) => live.setPhase(s.phase));
  ipcMain.on("live:set-enabled", (e, enabled: unknown) => {
    if (fromApp(e) && typeof enabled === "boolean") live.setEnabled(enabled);
  });
  // M-034: in-game overlay. A transparent, click-through window that never takes focus, shown only while Tab is held.
  let overlayWin: BrowserWindow | null = null;
  let overlayRows: OverlayRows | null = null;
  let overlayPosition: OverlayPosition = DEFAULT_OVERLAY_POSITION; // M-036
  let lastGameRect: Electron.Rectangle | null = null; // what show() last placed the overlay on
  const sendToOverlay = (channel: string, payload: unknown) => {
    if (overlayWin && !overlayWin.isDestroyed()) overlayWin.webContents.send(channel, payload);
  };
  const overlay = createOverlayGate({
    getKeys: () => {
      try {
        const keys = createKeySource();
        if (keys) log.info("overlay", `key source ready (${process.platform})`);
        return keys;
      } catch (err) {
        log.warn("overlay", "key source not available", String(err)); // e.g. koffi missing from the install
        return null;
      }
    },
    open: () => {
      if (overlayWin && !overlayWin.isDestroyed()) return;
      const ow = new BrowserWindow({
        show: false,
        transparent: true,
        frame: false,
        resizable: false,
        movable: false,
        focusable: false,
        skipTaskbar: true,
        hasShadow: false,
        backgroundColor: "#00000000",
        width: OVERLAY_SIZE.width,
        height: OVERLAY_SIZE.height,
        webPreferences: {
          preload: join(__dirname, "overlay-preload.cjs"),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true,
        },
      });
      ow.setAlwaysOnTop(true, "screen-saver");
      ow.setIgnoreMouseEvents(true);
      ow.webContents.on("will-navigate", (ev) => ev.preventDefault());
      ow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      ow.webContents.on("did-finish-load", () => {
        sendToOverlay("hub:state", hub.state);
        if (overlayRows) sendToOverlay("overlay:rows", overlayRows);
      });
      ow.on("closed", () => {
        if (overlayWin === ow) overlayWin = null;
      });
      overlayWin = ow;
      void ow.loadFile(join(__dirname, "web", "overlay.html"));
    },
    close: () => {
      if (overlayWin && !overlayWin.isDestroyed()) overlayWin.close();
      overlayWin = null;
    },
    show: (keys) => {
      if (!overlayWin || overlayWin.isDestroyed()) return;
      // Over the game window (physical pixels -> DIPs); the primary display when its bounds are unknown.
      let game: Electron.Rectangle = screen.getPrimaryDisplay().workArea;
      try {
        const r = keys.gameRect?.();
        if (r) game = process.platform === "win32" ? screen.screenToDipRect(null, r) : r;
      } catch (err) {
        log.warn("overlay", "game window bounds not available", String(err));
      }
      lastGameRect = game;
      overlayWin.setBounds(overlayBounds(game, overlayPosition));
      overlayWin.setAlwaysOnTop(true, "screen-saver");
      overlayWin.showInactive(); // never show(): that takes focus from the game
    },
    hide: () => {
      if (overlayWin && !overlayWin.isDestroyed()) overlayWin.hide();
    },
    onError: (err) => log.warn("overlay", "reading the Tab key failed; the overlay stops for this game", String(err)),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (h) => clearInterval(h),
  });
  hub.subscribe((s) => {
    overlay.setPhase(s.phase);
    sendToOverlay("hub:state", s);
  });
  ipcMain.on("overlay:set-enabled", (e, enabled: unknown) => {
    if (fromApp(e) && typeof enabled === "boolean") overlay.setEnabled(enabled);
  });
  ipcMain.on("overlay:rows", (e, raw: unknown) => {
    if (!fromApp(e)) return;
    const rows = OverlayRowsSchema.safeParse(raw);
    if (!rows.success) return void log.warn("overlay", "rejected rows", rows.error.issues[0]?.message);
    overlayRows = rows.data;
    sendToOverlay("overlay:rows", rows.data);
  });
  ipcMain.on("overlay:set-position", (e, raw: unknown) => {
    if (!fromApp(e)) return;
    const pos = OverlayPositionSchema.safeParse(raw);
    if (!pos.success) return void log.warn("overlay", "rejected position", pos.error.issues[0]?.message);
    overlayPosition = pos.data;
    // Visible now: move it at once (no showInactive again).
    if (overlay.visible && overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.setBounds(overlayBounds(lastGameRect ?? screen.getPrimaryDisplay().workArea, overlayPosition));
    }
  });
  win.on("closed", () => overlay.dispose()); // the overlay window must not keep the app alive
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
    console.log(`[hub] ${hubServer.url}/api/stream?token=${hubServer.token}`) // stdout only (dev/test): the token must not go to the log file;
  }

  if (process.env.LOL_VIEWER_E2E === "1") {
    (globalThis as Record<string, unknown>).__lolViewer = { hub, views, recording: rec, live, overlay, overlayWindow: () => overlayWin, createKeySource };
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
    live.dispose();
    overlay.dispose();
    connector.stop();
    void hubServer?.close();
  });
});

app.on("window-all-closed", () => app.quit());

// Hardening: no other webContents may create windows or attach webviews.
app.on("web-contents-created", (_e, contents) => {
  contents.on("will-attach-webview", (ev) => ev.preventDefault());
});
