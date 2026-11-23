/**
 * In-game overlay on real Windows (M-034): the other overlay spec uses a fake key file, so this one
 * checks that the packaged app can load koffi (the per-OS binary must be in app.asar.unpacked) and
 * call the three Win32 functions it uses. Windows CI runs it against the installed app; skipped elsewhere.
 * It cannot check a real League game window: the foreground window here is whatever the runner shows.
 */
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeLcu, type FakeLcu, type ScenarioLine } from "../tools/fake-lcu/src/server.ts";

test.skip(process.platform !== "win32", "Windows only (Win32 calls through koffi)");

const root = fileURLToPath(new URL("..", import.meta.url));
const lines = readFileSync(`${root}/scenarios/live-ingame.jsonl`, "utf8")
  .split("\n")
  .filter((l) => l.trim() && !l.startsWith("//"))
  .map((l) => JSON.parse(l) as ScenarioLine);
let app: ElectronApplication;
let page: Page;
let fake: FakeLcu;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  fake = await startFakeLcu({ lines, autoplay: false });
  const exe = process.env.LOL_VIEWER_EXE;
  const env: Record<string, string | undefined> = {
    ...process.env,
    LOL_LCU_LOCKFILE: fake.lockfilePath,
    LOL_LIVE_CLIENT_URL: `http://127.0.0.1:${fake.port}`,
    LOL_VIEWER_E2E: "1",
    LOL_VIEWER_USER_DATA_DIR: mkdtempSync(join(tmpdir(), "lol-viewer-e2e-")),
  };
  delete env.LOL_OVERLAY_FAKE_KEYS; // the real key source
  app = await electron.launch({ ...(exe ? { executablePath: exe } : { args: [`${root}/apps/desktop`] }), env: env as Record<string, string> });
  page = await app.firstWindow();
});

test.afterAll(async () => {
  await app?.close();
  await fake?.close();
});

test("the real key source loads koffi and calls GetAsyncKeyState, GetClassNameW and GetWindowRect", async () => {
  const r = await app.evaluate(() => {
    const keys = (globalThis as any).__lolViewer.createKeySource();
    if (!keys) return null;
    const rect = keys.gameRect?.() ?? null;
    return { tab: keys.isTabDown(), game: keys.isGameForeground(), rect };
  });
  expect(r).not.toBeNull();
  expect(typeof r!.tab).toBe("boolean");
  expect(r!.game).toBe(false); // no League game on the runner
  if (r!.rect) expect(r!.rect.width).toBeGreaterThan(0); // the foreground window's bounds, when there is one
});

test("with both flags on and a game in progress, the gate keeps polling the real key", async () => {
  await expect(page.locator(".conn")).toHaveAttribute("data-status", "connected", { timeout: 15_000 });
  for (const l of lines) {
    if (l.t > 5000) break; // in game (the same moment as electron-overlay.spec.ts)
    fake.advanceTo(l.t);
    await page.waitForTimeout(10);
  }
  await expect.poll(() => app.evaluate(() => (globalThis as any).__lolViewer.hub.state.phase as string)).toBe("InProgress");
  await app.evaluate(() => (globalThis as any).__lolViewer.overlay.setEnabled(true)); // as the renderer does with both flags on
  await new Promise((r) => setTimeout(r, 1000)); // ~20 reads of the Tab key
  const s = await app.evaluate(() => {
    const lv = (globalThis as any).__lolViewer;
    return { polling: lv.overlay.polling as boolean, visible: lv.overlay.visible as boolean, window: lv.overlayWindow() != null };
  });
  expect(s).toEqual({ polling: true, visible: false, window: true }); // an exception from koffi would stop the polling
  await app.evaluate(() => (globalThis as any).__lolViewer.overlay.setEnabled(false));
});
