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
 */
import { join } from "node:path";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { toLcuEvent } from "@lol-viewer/core";
import { Hub, startHubServer } from "@lol-viewer/hub";
import { startLcuConnector } from "@lol-viewer/lcu";
import { ViewCommandSchema } from "@lol-viewer/protocol";
import { ExternalViewManager } from "./external-views.ts";

const hub = new Hub();

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    backgroundColor: "#0d1117",
    title: "LoL Viewer Next",
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

  hub.subscribe((state) => {
    if (!win.isDestroyed()) win.webContents.send("hub:state", state);
  });

  const connector = startLcuConnector({
    onEvent: (raw) => {
      const e = toLcuEvent(raw);
      if (e) hub.dispatch(e);
    },
    onStatus: (status) => hub.dispatch({ type: "connection", status }),
  });

  let hubServer: Awaited<ReturnType<typeof startHubServer>> | null = null;
  if (process.env.LOL_VIEWER_HUB_PORT !== undefined) {
    hubServer = await startHubServer(hub, { port: Number(process.env.LOL_VIEWER_HUB_PORT) });
    console.log(`[hub] ${hubServer.url}/api/stream?token=${hubServer.token}`);
  }

  if (process.env.LOL_VIEWER_E2E === "1") {
    (globalThis as Record<string, unknown>).__lolViewer = { hub, views };
  }

  app.on("before-quit", () => {
    connector.stop();
    void hubServer?.close();
  });
});

app.on("window-all-closed", () => app.quit());

// Hardening: no other webContents may create windows or attach webviews.
app.on("web-contents-created", (_e, contents) => {
  contents.on("will-attach-webview", (ev) => ev.preventDefault());
});
