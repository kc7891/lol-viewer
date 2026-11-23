/**
 * Live Client Data API in the real app (M-025..M-028): feature flag off => no requests,
 * on => item gold differences and lane correction without a restart, user swaps survive
 * the next poll, off => polling stops and the differences disappear, end of game => polling stops
 * and the differences stay until the next pick starts (M-031).
 * The fake LCU also serves /liveclientdata/playerlist from scenarios/live-ingame.jsonl.
 */
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
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

/** Whole-screen grab (native views included), best effort like electron.spec.ts. */
function grabScreen(name: string) {
  try {
    if (process.platform === "linux") execFileSync("import", ["-window", "root", `${shots}${name}.png`]);
  } catch {
    /* no screen grabber available: skip */
  }
}

const polling = () => app.evaluate(() => (globalThis as any).__lolViewer.live.polling as boolean);
const enemyNames = () => page.locator(".matchup-row .side.enemy .name").allTextContents();
const liveSwitch = () => page.getByRole("region", { name: "Feature flags" }).getByRole("switch", { name: "Live game data" });
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
  fake = await startFakeLcu({ lines, autoplay: false });
  const exe = process.env.LOL_VIEWER_EXE;
  const sandboxArgs = process.platform === "linux" ? ["--no-sandbox"] : [];
  app = await electron.launch({
    ...(exe ? { executablePath: exe, args: sandboxArgs } : { args: [...sandboxArgs, `${root}/apps/desktop`] }),
    env: {
      ...process.env,
      LOL_LCU_LOCKFILE: fake.lockfilePath,
      LOL_LIVE_CLIENT_URL: `http://127.0.0.1:${fake.port}`,
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

test("flag off (default): the Live Client API is never requested", async () => {
  await expect(page.locator(".conn")).toHaveAttribute("data-status", "connected", { timeout: 15_000 });
  await playTo(5000);
  await expect(page.locator(".top-bar, header").first()).toContainText("In Game");
  await page.waitForTimeout(5000);
  expect(fake.liveClientRequests).toEqual([]);
  expect(await polling()).toBe(false);
  await expect(page.locator(".live-diff")).toHaveCount(0);
  expect(await enemyNames()).toEqual(["Jayce", "Karma", "Gragas", "Varus", "Pantheon"]);
});

test("turning the flag on starts reading without a restart", async () => {
  await toSettings();
  await liveSwitch().click();
  await expect(liveSwitch()).toBeChecked();
  await toViewers();
  await expect.poll(() => fake.liveClientRequests.length, { timeout: 10_000 }).toBeGreaterThan(0);
  await expect(page.locator('.matchup-row[data-lane="jungle"] .live-diff .gold')).toHaveText("+1.4k", { timeout: 10_000 });
  expect(await enemyNames()).toEqual(["Pantheon", "Gragas", "Jayce", "Varus", "Karma"]);
  await expect(page.getByRole("region", { name: "Cooldowns" }).locator(".cd-champ")).toContainText("Jayce");
  grabScreen("live-on");
});

test("a swap made by the user survives the next poll", async () => {
  await page.locator('.matchup-row[data-lane="top"] .side.enemy .champ-btn').dragTo(page.locator('.matchup-row[data-lane="support"] .side.enemy'));
  const swapped = await enemyNames();
  expect(swapped).toEqual(["Karma", "Gragas", "Jayce", "Varus", "Pantheon"]);
  await page.waitForTimeout(5000);
  expect(await enemyNames()).toEqual(swapped);
});

test("turning the flag off stops reading and removes the differences", async () => {
  await toSettings();
  await liveSwitch().click();
  await expect(liveSwitch()).not.toBeChecked();
  await toViewers();
  await expect(page.locator(".live-diff")).toHaveCount(0);
  expect(await polling()).toBe(false);
  const n = fake.liveClientRequests.length;
  await page.waitForTimeout(5000);
  expect(fake.liveClientRequests.length).toBeLessThanOrEqual(n + 1); // one request may have been in flight
});

test("the end of the game stops reading and keeps the differences", async () => {
  await toSettings();
  await liveSwitch().click();
  await toViewers();
  await expect.poll(polling, { timeout: 10_000 }).toBe(true);
  await expect(page.locator('.matchup-row[data-lane="jungle"] .live-diff .gold')).toHaveText("+1.4k", { timeout: 10_000 });
  await playTo(7400); // EndOfGame, then Lobby
  await expect.poll(polling, { timeout: 10_000 }).toBe(false);
  await expect(page.locator(".top-bar, header").first()).toContainText("Lobby");
  await expect(page.locator('.matchup-row[data-lane="jungle"] .live-diff .gold')).toHaveText("+1.4k");
  const n = fake.liveClientRequests.length;
  await page.waitForTimeout(5000);
  expect(fake.liveClientRequests.length).toBeLessThanOrEqual(n + 1); // one request may have been in flight
  expect(fake.rejectedWrites).toEqual([]);
});

test("the next pick clears the differences", async () => {
  await expect(page.locator(".live-diff")).not.toHaveCount(0); // still there from the last game
  await app.evaluate(() => (globalThis as any).__lolViewer.hub.dispatch({ type: "gameflow-phase", phase: "ChampSelect" }));
  await expect(page.locator(".live-diff")).toHaveCount(0);
  await expect(page.locator(".matchup-row .side.enemy .name")).toHaveCount(0);
});
