/**
 * Teams in the main process (🔴 zone, M-038): the cache file, the IPC and the League Client, wired to the
 * Electron-free TeamsController (teams-core.ts). Every IPC call comes from our own window only and is
 * checked with the protocol's zod schemas. Reads go through connector.probe (GET only, rate limited).
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app, ipcMain } from "electron";
import { buildProbePath, type LcuConnector } from "@lol-viewer/lcu";
import { TeamsPrefetchRequestSchema, TeamsPuuidSchema, TeamsRiotIdLinesSchema, type TeamsState } from "@lol-viewer/protocol";
import { log } from "./log.ts";
import { TeamsController, type TeamsStorage } from "./teams-core.ts";

const cacheFile = () => join(app.getPath("userData"), "team-cache.json");

/** team-cache.json: a temporary file is written, then renamed over the old one (never a half-written file). */
export const fileStorage = (file: () => string): TeamsStorage => ({
  async load() {
    try {
      return await readFile(file(), "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  },
  async save(text) {
    const path = file();
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    await writeFile(tmp, text, "utf8");
    await rename(tmp, path);
  },
  async remove() {
    await rm(file(), { force: true });
    await rm(`${file()}.tmp`, { force: true });
  },
});

export type TeamsSetup = {
  connector: Pick<LcuConnector, "probe" | "resync">;
  fromApp: (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => boolean;
  push: (channel: string, payload: TeamsState) => void;
};

export function setupTeams({ connector, fromApp, push }: TeamsSetup): TeamsController {
  const teams = new TeamsController({
    get: connector.probe,
    build: buildProbePath,
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    storage: fileStorage(cacheFile),
    send: (s) => push("teams:state", s),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h),
    // The lobby event that came while the flag was off was dropped: ask the connector for it again.
    onEnabled: () => void connector.resync(),
    log: (m) => log.info("teams", m),
  });

  ipcMain.handle("teams:get-state", (e) => (fromApp(e) ? teams.state() : null));
  ipcMain.on("teams:set-enabled", (e, enabled: unknown) => {
    if (fromApp(e) && typeof enabled === "boolean") teams.setEnabled(enabled);
  });
  ipcMain.handle("teams:friends", (e) => (fromApp(e) ? teams.friends() : null));
  ipcMain.handle("teams:recent", (e) => (fromApp(e) ? teams.recentPlayers() : null));
  ipcMain.handle("teams:resolve-riot-ids", (e, raw: unknown) => {
    if (!fromApp(e)) return null;
    const lines = TeamsRiotIdLinesSchema.safeParse(raw);
    if (!lines.success) throw new Error("invalid Riot ID list");
    return teams.resolveRiotIds(lines.data);
  });
  ipcMain.on("teams:prefetch", (e, raw: unknown) => {
    if (!fromApp(e)) return;
    const req = TeamsPrefetchRequestSchema.safeParse(raw);
    if (!req.success) return void log.warn("teams", "rejected prefetch request", req.error.issues[0]?.message);
    void teams.prefetch(req.data);
  });
  ipcMain.on("teams:cancel-prefetch", (e) => {
    if (fromApp(e)) teams.cancelPrefetch();
  });
  const onePuuid = (channel: string, run: (puuid: string) => void) =>
    ipcMain.on(channel, (e, raw: unknown) => {
      if (!fromApp(e)) return;
      const id = TeamsPuuidSchema.safeParse(raw);
      if (id.success) run(id.data);
    });
  onePuuid("teams:refresh", (id) => teams.refresh(id));
  onePuuid("teams:forget", (id) => teams.forget(id));
  ipcMain.on("teams:clear-cache", (e) => {
    if (fromApp(e)) void teams.clearCache();
  });
  return teams;
}
