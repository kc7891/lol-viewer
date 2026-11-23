/**
 * In-app updates (electron-updater, generic provider; docs/spec/new-app-design.md §6.2).
 * The state machine lives in update-core.ts; this file only adapts electron-updater to it.
 * Checking is automatic once after startup, downloading and installing are the user's choice.
 */
import { app } from "electron";
import { autoUpdater } from "electron-updater";
import { UpdateController, updateFeedUrl, updatesSupported, type UpdateDriver } from "./update-core.ts";
import { log } from "./log.ts";

const STARTUP_CHECK_DELAY_MS = 5000;

export function createUpdater(): UpdateController {
  const supported = updatesSupported(app.isPackaged, process.env);
  let driver: UpdateDriver;

  if (supported) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.setFeedURL({ provider: "generic", url: updateFeedUrl(process.env) });
    autoUpdater.logger = {
      info: (m?: unknown) => log.debug("updater", m),
      warn: (m?: unknown) => log.warn("updater", m),
      error: (m?: unknown) => log.warn("updater", m),
      debug: (m?: unknown) => log.debug("updater", m),
    };
    // An "error" event without a listener would throw; the failure itself reaches the controller through the rejected promise.
    autoUpdater.on("error", (e) => log.warn("updater", "error event:", e));
    driver = {
      async check() {
        const r = await autoUpdater.checkForUpdates();
        // null: electron-updater considers itself inactive (e.g. no app-update.yml, or a Linux build that is not an AppImage).
        if (!r) throw new Error("updater is inactive in this install");
        return { isUpdateAvailable: r.isUpdateAvailable, version: r.updateInfo.version };
      },
      async download(onProgress) {
        const h = (p: { percent: number }) => onProgress(p.percent);
        autoUpdater.on("download-progress", h);
        try {
          await autoUpdater.downloadUpdate();
        } finally {
          autoUpdater.removeListener("download-progress", h);
        }
      },
      // Silent one-click installer, then start the new version. League / Vanguard processes are left alone.
      install: () => autoUpdater.quitAndInstall(true, true),
    };
  } else {
    driver = { check: async () => null, download: async () => {}, install() {} };
  }

  const controller = new UpdateController(app.getVersion(), supported, driver, log);
  if (supported) {
    log.info("update", `feed ${updateFeedUrl(process.env)}`);
    setTimeout(() => void controller.check(), STARTUP_CHECK_DELAY_MS).unref();
  } else {
    log.info("update", "disabled (not packaged, E2E, or LOL_VIEWER_DISABLE_UPDATES)");
  }
  return controller;
}
