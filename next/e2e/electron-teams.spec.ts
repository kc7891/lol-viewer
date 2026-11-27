/**
 * Teams in the real app (M-038), against the fake LCU and the synthetic scenarios/teams-custom-lobby.jsonl:
 *  - flag off (the default): no Teams tab, no ranks / match history / names read, no cache file
 *  - flag on: the custom lobby's players are fetched on their own (9 in the team slots, the bot left out, 2 spectators),
 *    ranks and estimates appear, a spectator joins the game, a proposal and the Discord text come out,
 *    the cache file is written, and nothing but GET reaches the client
 *  - Prefetch over the real IPC: friends, recent players, Riot ID lookup
 *  - flag off again: the tab goes and the fetching stops
 * Game dates in the scenario are moved to the day the test runs (the cache only counts the last 60 days).
 */
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCacheFile, parseScenario } from "../packages/core/src/index.ts";
import { startFakeLcu, type FakeLcu } from "../tools/fake-lcu/src/server.ts";
import { REFERENCE_NOW } from "../tools/fake-lcu/src/make-teams-scenario.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const shots = fileURLToPath(new URL("./screenshots/electron/", import.meta.url));
mkdirSync(shots, { recursive: true });

const delta = Date.now() - REFERENCE_NOW;
function shift(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(shift);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, k === "gameCreation" && typeof x === "number" ? x + delta : k === "gameCreationDate" && typeof x === "string" ? new Date(Date.parse(x) + delta).toISOString() : shift(x)]),
    );
  }
  return v;
}
const lines = parseScenario(readFileSync(`${root}/scenarios/teams-custom-lobby.jsonl`, "utf8")).map((l) => ({ ...l, data: shift(l.data) }));

const userData = mkdtempSync(join(tmpdir(), "lol-viewer-e2e-"));
const cacheFile = join(userData, "team-cache.json");

let app: ElectronApplication;
let page: Page;
let fake: FakeLcu;

const playersHeading = () => page.getByRole("region", { name: "Players" }).getByRole("heading");
const benchHeading = () => page.getByRole("region", { name: "Bench" }).getByRole("heading");
const flagSwitch = () => page.getByRole("region", { name: "Feature flags" }).getByRole("switch", { name: "Teams (custom match balancer)" });
const tab = (name: string) => page.getByRole("button", { name, exact: true });
const readsBeyondTheLobby = () => fake.getRequests.filter((u) => /\/lol-(ranked|match-history|summoner\/v2|chat)\//.test(u) || u.startsWith("/lol-summoner/v1/summoners?"));

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  fake = await startFakeLcu({ lines, autoplay: false });
  fake.advanceTo(1000); // everything the client knows, and the lobby (t=300); the update at t=2000 comes later
  const exe = process.env.LOL_VIEWER_EXE;
  const sandboxArgs = process.platform === "linux" ? ["--no-sandbox"] : [];
  app = await electron.launch({
    ...(exe ? { executablePath: exe, args: sandboxArgs } : { args: [...sandboxArgs, `${root}/apps/desktop`] }),
    env: {
      ...process.env,
      LOL_LCU_LOCKFILE: fake.lockfilePath,
      LOL_LIVE_CLIENT_URL: `http://127.0.0.1:${fake.port}`,
      LOL_VIEWER_E2E: "1",
      LOL_VIEWER_USER_DATA_DIR: userData,
    },
  });
  page = await app.firstWindow();
  await page.setViewportSize({ width: 1500, height: 1000 });
});

test.afterAll(async () => {
  await app?.close();
  await fake?.close();
});

test("flag off (default): no Teams tab, nothing is read, no cache file", async () => {
  await expect(page.locator(".conn")).toHaveAttribute("data-status", "connected", { timeout: 15_000 });
  await expect(tab("Teams")).toHaveCount(0);
  await page.waitForTimeout(2500); // the lobby is in the client; a fetch would have started by now
  expect(readsBeyondTheLobby()).toEqual([]);
  expect(existsSync(cacheFile)).toBe(false);
  expect(await app.evaluate(() => (globalThis as any).__lolViewer.teams.enabled as boolean)).toBe(false);
});

test("flag on: the lobby is fetched at once, ranks and estimates appear", async () => {
  await tab("Settings").click();
  await flagSwitch().check();
  await expect(tab("Teams")).toBeVisible();
  // Not opened yet: the fetching started anyway (Owner decision: custom lobby players are read on their own).
  await expect.poll(() => fake.getRequests.some((u) => u.startsWith("/lol-ranked/v1/ranked-stats/player-1")), { timeout: 15_000 }).toBe(true);
  // The Teams tab was never opened: no friends, friend groups or recently played were read without a user action.
  await page.waitForTimeout(1000);
  expect(fake.getRequests.filter((u) => /friend|recently-played/.test(u))).toEqual([]);
  await tab("Teams").click();

  await expect(playersHeading()).toHaveText("Players (9)"); // 5 blue + 4 red; the bot is not listed
  await expect(benchHeading()).toHaveText("Bench (2)");
  const rows = page.getByRole("region", { name: "Players" }).locator(".team-row");
  await expect(rows).toHaveCount(9);
  // Everybody gets a rank, the two unranked players an estimate (~).
  await expect(page.getByRole("region", { name: "Players" }).locator(".rank-chip[data-unknown]")).toHaveCount(0, { timeout: 90_000 });
  // (before the estimate arrives an unranked player shows last season's rank)
  await expect(page.getByRole("region", { name: "Players" }).locator('.rank-chip[data-source="estimate"]')).toHaveCount(2, { timeout: 90_000 });
  await expect(page.getByRole("region", { name: "Players" }).locator('.rank-chip[data-source="flex"]')).toHaveCount(1);
  await expect(page.locator('.team-row[data-puuid="player-1"] .pname')).toHaveText("player-1");
  await expect(page.locator('.team-row[data-puuid="player-1"] .ptag')).toHaveText("#tag-1");
  await expect(page.getByRole("status", { name: /^Fetching/ })).toHaveCount(0, { timeout: 30_000 });
  await page.screenshot({ path: `${shots}teams-lobby.png`, fullPage: true });
});

test("a spectator joins the players: ten players give a proposal and Discord text", async () => {
  await page.getByRole("button", { name: "Move player-10 to Players" }).click();
  await expect(playersHeading()).toHaveText("Players (10)");
  await expect(benchHeading()).toHaveText("Bench (1)");
  await expect(page.locator(".proposal-table tbody tr")).toHaveCount(5);
  await expect(page.getByTestId("proposal-diff")).toContainText("Rank diff");
  const text = await page.getByLabel("Discord text").inputValue();
  expect(text).toContain("```");
  expect(text).toContain("チーム分け案（ランク重視 1）");
  for (let n = 1; n <= 10; n++) expect(text).toMatch(new RegExp(`player-${n}(?!\\d)`));
  await page.getByRole("button", { name: "Copy for Discord" }).click();
  await expect(page.getByText(/^(Copied\.|Press Ctrl\+C to copy\.)$/)).toBeVisible();
  await page.screenshot({ path: `${shots}teams-proposal.png`, fullPage: true });
});

test("the cache file is written, valid, and the client only saw GETs", async () => {
  await expect.poll(() => existsSync(cacheFile), { timeout: 10_000 }).toBe(true);
  const file = parseCacheFile(JSON.parse(readFileSync(cacheFile, "utf8")));
  for (const n of [1, 4, 9, 10, 11]) expect(file.players[`player-${n}`]?.rank).toBeTruthy();
  expect(file.players["player-4"]!.estimate?.points).not.toBeNull();
  expect(Object.keys(file.games).length).toBeGreaterThan(0);
  expect(existsSync(`${cacheFile}.tmp`)).toBe(false);
  expect(fake.rejectedWrites).toEqual([]);
});

test("the lobby changes while the app runs: a new spectator is fetched", async () => {
  fake.advanceTo(2000);
  await expect(benchHeading()).toHaveText("Bench (2)");
  await expect(page.locator('.team-row[data-puuid="player-12"] .rank-chip:not([data-unknown])')).toBeVisible({ timeout: 30_000 });
});

test("Prefetch: friends, recent players and a Riot ID lookup go through the real IPC", async () => {
  await page.getByRole("button", { name: /^Prefetch/ }).click();
  const group = page.getByLabel("Friend group");
  await expect(group.locator("option")).toHaveText(["All friends (12)", "Default (3)", "General (3)", "Customs (6)"]);
  await group.selectOption({ label: "Customs (6)" });
  await expect(page.getByRole("button", { name: /Fetch stale & new \(6\)/ })).toBeEnabled();
  await page.getByLabel("Include me").check();
  await expect(page.getByRole("button", { name: /Fetch stale & new \(7\)/ })).toBeEnabled();

  await page.getByRole("tab", { name: "Recent" }).click();
  await expect(page.locator(".pick-row")).toHaveCount(11);

  await page.getByRole("tab", { name: "Riot IDs" }).click();
  await page.getByLabel(/Riot IDs, one per line/).fill("player-20#tag-20\nplayer-98#tag-98");
  await page.getByRole("button", { name: "Resolve" }).click();
  const results = page.getByRole("list", { name: "Lookup results" });
  await expect(results.locator("li").nth(0)).toContainText("Found");
  await expect(results.locator("li").nth(1)).toContainText("Not found");
  await page.getByRole("button", { name: /Fetch stale & new \(1\)/ }).click();
  await expect.poll(() => fake.getRequests.some((u) => u.startsWith("/lol-ranked/v1/ranked-stats/player-20")), { timeout: 20_000 }).toBe(true);

  await page.getByRole("tab", { name: /^Saved \(/ }).click();
  const saved = page.locator('.saved-row[data-puuid="player-20"]');
  await expect(saved).toBeVisible();
  await expect(saved.locator(".fetched")).toHaveText("just now", { timeout: 20_000 });
  await saved.getByRole("button").first().click();
  await expect(page.getByRole("region", { name: "Rank" })).toContainText(/Solo\/Duo/);
  await page.screenshot({ path: `${shots}teams-saved.png`, fullPage: true });
  expect(fake.rejectedWrites).toEqual([]);
});

test("flag off again: the tab goes away and nothing more is read", async () => {
  await tab("Settings").click();
  await flagSwitch().uncheck();
  await expect(tab("Teams")).toHaveCount(0);
  await page.waitForTimeout(500);
  const before = fake.getRequests.length;
  await page.waitForTimeout(2000);
  expect(fake.getRequests.length).toBe(before);
  expect(await app.evaluate(() => (globalThis as any).__lolViewer.teams.enabled as boolean)).toBe(false);
  expect(fake.rejectedWrites).toEqual([]);
});
