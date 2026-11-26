/**
 * In-game overlay (M-034): with the flags on and a game in progress, a transparent window exists
 * (hidden); holding Tab (a fake key file, LOL_OVERLAY_FAKE_KEYS) shows it without moving focus,
 * releasing hides it; flag off or the end of the game: no window at all.
 * The overlay shows the same values as the sidebar. The fake LCU serves scenarios/live-ingame.jsonl.
 */
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeLcu, type FakeLcu, type ScenarioLine } from "../tools/fake-lcu/src/server.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const shots = fileURLToPath(new URL("./screenshots/electron/", import.meta.url));
mkdirSync(shots, { recursive: true });

const lines = readFileSync(`${root}/scenarios/live-ingame.jsonl`, "utf8")
  .split("\n")
  .filter((l) => l.trim() && !l.startsWith("//"))
  .map((l) => JSON.parse(l) as ScenarioLine);

let app: ElectronApplication;
let page: Page;
let fake: FakeLcu;
const keyFile = join(mkdtempSync(join(tmpdir(), "lol-overlay-keys-")), "keys");
const press = (k: "tab" | "none") => writeFileSync(keyFile, k);

function grabScreen(name: string) {
  try {
    if (process.platform === "linux") execFileSync("import", ["-window", "root", `${shots}${name}.png`]);
  } catch {
    /* no screen grabber available: skip */
  }
}

/** The overlay BrowserWindow as main sees it (null while there is none). */
const overlayInfo = () =>
  app.evaluate(({ BrowserWindow }) => {
    const w = (globalThis as any).__lolViewer.overlayWindow() as Electron.BrowserWindow | null;
    const main = BrowserWindow.getAllWindows().find((x) => x !== w);
    if (!w || w.isDestroyed()) return { exists: false as const, windows: BrowserWindow.getAllWindows().length };
    return {
      exists: true as const,
      windows: BrowserWindow.getAllWindows().length,
      visible: w.isVisible(),
      focused: w.isFocused(),
      focusable: w.isFocusable(),
      alwaysOnTop: w.isAlwaysOnTop(),
      bounds: w.getBounds(),
      mainFocused: main?.isFocused() ?? null,
    };
  });
const mainFocused = () =>
  app.evaluate(({ BrowserWindow }) => {
    const w = (globalThis as any).__lolViewer.overlayWindow() as Electron.BrowserWindow | null;
    return BrowserWindow.getAllWindows().find((x) => x !== w)?.isFocused() ?? null;
  });
const overlayPage = () => app.windows().find((p) => p.url().endsWith("overlay.html"));

const flag = (name: string) => page.getByRole("region", { name: "Feature flags" }).getByRole("switch", { name });
const toSettings = () => page.getByRole("button", { name: "Settings", exact: true }).click();
const toViewers = () => page.getByRole("button", { name: "Viewers", exact: true }).click();

async function playTo(ms: number) {
  for (const l of lines) {
    if (l.t > ms) break;
    fake.advanceTo(l.t);
    await page.waitForTimeout(10);
  }
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  press("none");
  fake = await startFakeLcu({ lines, autoplay: false });
  const exe = process.env.LOL_VIEWER_EXE;
  const sandboxArgs = process.platform === "linux" ? ["--no-sandbox"] : [];
  app = await electron.launch({
    ...(exe ? { executablePath: exe, args: sandboxArgs } : { args: [...sandboxArgs, `${root}/apps/desktop`] }),
    env: {
      ...process.env,
      LOL_LCU_LOCKFILE: fake.lockfilePath,
      LOL_LIVE_CLIENT_URL: `http://127.0.0.1:${fake.port}`,
      LOL_OVERLAY_FAKE_KEYS: keyFile,
      LOL_VIEWER_E2E: "1",
      LOL_VIEWER_USER_DATA_DIR: mkdtempSync(join(tmpdir(), "lol-viewer-e2e-")),
    },
  });
  page = await app.firstWindow();
});

test.afterAll(async () => {
  await app?.close();
  await fake?.close();
});

test("flags off (default): no overlay window even while Tab is held in a game", async () => {
  await expect(page.locator(".conn")).toHaveAttribute("data-status", "connected", { timeout: 15_000 });
  await playTo(5000);
  await expect(page.locator(".top-bar, header").first()).toContainText("In Game");
  press("tab");
  await page.waitForTimeout(600);
  expect(await overlayInfo()).toEqual({ exists: false, windows: 1 });
  expect(await app.evaluate(() => (globalThis as any).__lolViewer.overlay.polling as boolean)).toBe(false);
  press("none");
});

test("the overlay flag is disabled until Live game data is on", async () => {
  await toSettings();
  await expect(flag("In-game overlay (hold Tab)")).toBeDisabled();
  await flag("Live game data").click();
  await expect(flag("In-game overlay (hold Tab)")).toBeEnabled();
  await flag("In-game overlay (hold Tab)").click();
  await expect(flag("In-game overlay (hold Tab)")).toBeChecked();
  await toViewers();
});

test("in a game the window is created hidden; Tab shows it without taking focus; release hides it", async () => {
  await expect.poll(async () => (await overlayInfo()).exists, { timeout: 10_000 }).toBe(true);
  const idle = await overlayInfo();
  expect(idle).toMatchObject({ exists: true, visible: false, focusable: false, alwaysOnTop: true, windows: 2 });
  await expect.poll(() => app.evaluate(() => (globalThis as any).__lolViewer.overlay.polling as boolean)).toBe(true);
  // The overlay page has the rows (sent by the main window) and the live data
  await expect.poll(() => overlayPage()?.locator(".ov-team .ov-gold").textContent(), { timeout: 10_000 }).toBe("+450");

  const focusBefore = await mainFocused();
  press("tab");
  await expect.poll(async () => (await overlayInfo()).exists && (await overlayInfo() as any).visible, { timeout: 3000 }).toBe(true);
  const shown = (await overlayInfo()) as Extract<Awaited<ReturnType<typeof overlayInfo>>, { exists: true }>;
  expect(shown.focused).toBe(false);
  expect(shown.alwaysOnTop).toBe(true);
  expect(shown.focusable).toBe(false);
  expect(await mainFocused()).toBe(focusBefore); // focus did not move
  expect(shown.bounds).toMatchObject({ width: 400, height: 204 });
  // Default position: bottom-left of the primary display's work area, 20 px from the edges (M-036)
  const wa = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
  expect(shown.bounds).toEqual({ x: wa.x + 20, y: wa.y + wa.height - 204 - 20, width: 400, height: 204 });

  // Same values as the sidebar
  const op = overlayPage()!;
  const sidebar = await page.locator(".matchup-row[data-lane] .live-diff .gold").allTextContents();
  await expect(op.locator(".ov-row:not(.ov-team) .ov-gold")).toHaveText(sidebar);
  await expect(op.locator('.ov-row[data-lane="jungle"] .ov-gold')).toHaveText("+1.4k");
  await expect(op.locator(".ov-team .ov-team-gold")).toHaveText(["21.1k", "20.7k"]);
  // Each side's own item gold and level is in the real overlay window (M-037)
  await expect(op.locator('.ov-row[data-lane="jungle"] .ov-stat.ally .ov-stat-gold')).toHaveText(/^(\d+\.\d)k$|^\d+$/);
  await expect(op.locator('.ov-row[data-lane="jungle"] .ov-stat.ally .ov-stat-lvl')).toHaveText(/^Lv \d+$/);
  await page.waitForTimeout(300);
  grabScreen("overlay-screen");
  try {
    const png = await app.evaluate(async () => {
      const w = (globalThis as any).__lolViewer.overlayWindow() as Electron.BrowserWindow;
      return (await w.webContents.capturePage()).toPNG().toString("base64");
    });
    writeFileSync(`${shots}overlay.png`, Buffer.from(png, "base64"));
  } catch {
    /* best effort */
  }

  // Choosing another position in Settings moves the visible overlay at once (M-036)
  await toSettings();
  const pos = page.getByRole("radiogroup", { name: "Overlay position" });
  await expect(pos.getByRole("radio", { name: "Bottom left" })).toBeChecked();
  await pos.getByRole("radio", { name: "Top right" }).click();
  await expect(pos.getByRole("radio", { name: "Top right" })).toBeChecked();
  await expect
    .poll(async () => ((await overlayInfo()) as any).bounds, { timeout: 3000 })
    .toEqual({ x: wa.x + wa.width - 400 - 20, y: wa.y + 20, width: 400, height: 204 });
  expect(((await overlayInfo()) as any).visible).toBe(true);
  expect(await mainFocused()).toBe(focusBefore);
  await toViewers();

  press("none");
  await expect.poll(async () => (await overlayInfo() as any).visible, { timeout: 3000 }).toBe(false);
  expect(await mainFocused()).toBe(focusBefore);
});

test("the end of the game closes the overlay window", async () => {
  press("tab");
  await expect.poll(async () => (await overlayInfo() as any).visible, { timeout: 3000 }).toBe(true);
  await playTo(7400); // EndOfGame, then Lobby
  await expect.poll(async () => (await overlayInfo()).exists, { timeout: 10_000 }).toBe(false);
  expect(await app.evaluate(() => (globalThis as any).__lolViewer.overlay.polling as boolean)).toBe(false);
  press("none");
});

test("turning the overlay flag off removes the window", async () => {
  await app.evaluate(() => (globalThis as any).__lolViewer.hub.dispatch({ type: "gameflow-phase", phase: "InProgress" }));
  await expect.poll(async () => (await overlayInfo()).exists, { timeout: 10_000 }).toBe(true);
  await toSettings();
  await flag("In-game overlay (hold Tab)").click();
  await expect(flag("In-game overlay (hold Tab)")).not.toBeChecked();
  await expect.poll(async () => (await overlayInfo()).exists, { timeout: 10_000 }).toBe(false);
  expect((await overlayInfo()).windows).toBe(1);
});
