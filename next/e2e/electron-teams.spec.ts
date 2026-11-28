/**
 * Teams in the real app (M-038), against the fake LCU and the synthetic scenarios/teams-custom-lobby.jsonl:
 *  - flag off (the default): no Teams tab, no ranks / match history / names read, no cache file
 *  - flag on: the custom lobby's players are fetched on their own (9 in the team slots, the bot left out, 2 spectators),
 *    ranks and estimates appear, a spectator joins the game, a proposal and the Discord text come out,
 *    the cache file is written, and nothing but GET reaches the client
 *  - People over the real IPC: the Add panels (friends, recent players, Riot ID lookup)
 *  - lane chips and the rank badge set preferences, the proposal follows, Export writes the preferences file (LOL_VIEWER_E2E_SAVE_PATH),
 *    clearing the preferences and importing the file again restores them (M-040)
 *  - saved Rosters and Matchups (M-042) are kept in the app's settings: saved, the app is closed and started again, and they are still there
 *  - flag off again: the tab goes and the fetching stops
 * Game dates in the scenario are moved to the day the test runs (the cache only counts the last 60 days).
 */
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCacheFile, parsePrefsFile, parseScenario } from "../packages/core/src/index.ts";
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
/** Where Export preferences writes in this run (main honours the variable only with LOL_VIEWER_E2E=1). */
const savePath = join(mkdtempSync(join(tmpdir(), "lol-viewer-e2e-save-")), "prefs-export.json");

let app: ElectronApplication;
let page: Page;
let fake: FakeLcu;

const playersHeading = () => page.getByRole("region", { name: "Players" }).getByRole("heading");
const chip = (name: string) => page.getByRole("button", { name, exact: true });
const subTab = (name: string | RegExp) => page.getByRole("tab", { name, exact: typeof name === "string" });
const toast = () => page.locator(".toast").last();
const flagSwitch = () => page.getByRole("region", { name: "Feature flags" }).getByRole("switch", { name: "Teams (custom match balancer)" });
const tab = (name: string) => page.getByRole("button", { name, exact: true });
const readsBeyondTheLobby = () => fake.getRequests.filter((u) => /\/lol-(ranked|match-history|summoner\/v2|chat)\//.test(u) || u.startsWith("/lol-summoner/v1/summoners?"));

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  fake = await startFakeLcu({ lines, autoplay: false });
  fake.advanceTo(1000); // everything the client knows, and the lobby (t=300); the update at t=2000 comes later
  await launch();
});

/** Start the app on the same user data directory (settings and the cache stay between launches). */
async function launch() {
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
      LOL_VIEWER_E2E_SAVE_PATH: savePath,
    },
  });
  page = await app.firstWindow();
  await page.setViewportSize({ width: 1500, height: 1000 });
}

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

  await expect(playersHeading()).toHaveText("Players 9 of 11"); // 5 blue + 4 red play (the bot is not listed), 2 spectators sit out
  await expect(page.locator(".team-row")).toHaveCount(11);
  const rows = page.locator(".team-row[data-playing]");
  await expect(rows).toHaveCount(9);
  // Everybody gets a rank, the two unranked players an estimate (~).
  await expect(rows.locator(".rank-chip[data-unknown]")).toHaveCount(0, { timeout: 90_000 });
  // (before the estimate arrives an unranked player shows last season's rank)
  await expect(rows.locator('.rank-chip[data-source="estimate"]')).toHaveCount(2, { timeout: 90_000 });
  await expect(rows.locator('.rank-chip[data-source="flex"]')).toHaveCount(1);
  await expect(page.locator('.team-row[data-puuid="player-1"] .pname')).toHaveText("player-1");
  await expect(page.locator('.team-row[data-puuid="player-1"] .ptag')).toHaveText("#tag-1");
  await expect(page.getByRole("status", { name: /^Fetching/ })).toHaveCount(0, { timeout: 30_000 });
  await page.screenshot({ path: `${shots}teams-lobby.png`, fullPage: true });
});

test("a spectator joins the players: ten players give a proposal and Discord text", async () => {
  await page.getByRole("checkbox", { name: "Include player-10" }).check();
  await expect(playersHeading()).toHaveText("Players 10 of 11");
  await expect(page.locator(".proposal-table tbody tr")).toHaveCount(5);
  await expect(page.getByTestId("proposal-diff")).toContainText("Rank diff");
  await expect(page.getByLabel("Discord text")).toHaveCount(0); // only in Preview
  await page.getByRole("button", { name: "Discord options" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Preview" }).click();
  await page.keyboard.press("Escape");
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
  await expect(playersHeading()).toHaveText("Players 10 of 12");
  await expect(page.locator('.team-row[data-puuid="player-12"] .rank-chip:not([data-unknown])')).toBeVisible({ timeout: 30_000 });
});

test("People: friends, recent players and a Riot ID lookup go through the real IPC", async () => {
  await subTab(/^People/).click();
  await expect(page.locator(".people-row")).toHaveCount(12); // the lobby's people, all saved by the automatic fetch
  await page.getByRole("button", { name: "Add to People" }).click();
  await page.getByRole("menuitem", { name: "From a friend group…" }).click();
  const friends = page.getByRole("dialog", { name: "Add from a friend group" });
  const group = friends.getByLabel("Friend group");
  await expect(group.locator("option")).toHaveText(["All friends (12)", "Default (3)", "General (3)", "Customs (6)"]);
  await group.selectOption({ label: "Customs (6)" });
  await expect(friends.getByRole("button", { name: /Add & fetch \(6\)/ })).toBeEnabled();
  await friends.getByLabel("Include me").check();
  await expect(friends.getByRole("button", { name: /Add & fetch \(7\)/ })).toBeEnabled();
  await friends.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Add to People" }).click();
  await page.getByRole("menuitem", { name: "From recent players…" }).click();
  const recent = page.getByRole("dialog", { name: "Add from recent players" });
  await expect(recent.locator(".pick-row")).toHaveCount(11);
  await recent.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Add to People" }).click();
  await page.getByRole("menuitem", { name: "By Riot ID…" }).click();
  const riot = page.getByRole("dialog", { name: "Add by Riot ID" });
  await riot.getByLabel(/Riot IDs, one per line/).fill("player-20#tag-20\nplayer-98#tag-98");
  await riot.getByRole("button", { name: "Add & fetch" }).click();
  const results = riot.getByRole("list", { name: "Lookup results" });
  await expect(results.locator("li").nth(0)).toContainText("Found");
  await expect(results.locator("li").nth(1)).toContainText("Not found");
  await expect.poll(() => fake.getRequests.some((u) => u.startsWith("/lol-ranked/v1/ranked-stats/player-20")), { timeout: 20_000 }).toBe(true);
  await riot.getByRole("button", { name: "Close", exact: true }).first().click();

  const saved = page.locator('.people-row[data-puuid="player-20"]');
  await expect(saved).toBeVisible();
  await expect(saved.locator(".fetched")).toHaveText("just now", { timeout: 20_000 });
  await saved.getByRole("button", { name: /^Details of/ }).click();
  await expect(page.getByRole("region", { name: "Rank" })).toContainText(/Solo\/Duo/);
  await page.screenshot({ path: `${shots}teams-people.png`, fullPage: true });
  expect(fake.rejectedWrites).toEqual([]);
});

test("preferences: chips and the rank badge change the proposal, Export writes the file, clearing and Import bring it back", async () => {
  await subTab("Match").click();
  await expect(playersHeading()).toHaveText("Players 10 of 12");
  const support = page.locator('.proposal-table tr[data-lane="support"]');
  const topBlue = page.locator('.proposal-table tr[data-lane="top"] .slot-name').first();
  const name = (await topBlue.innerText()).trim();
  const before = await page.locator(".proposal-table").innerText();
  await expect(support).not.toContainText(name);

  // Two clicks on the Support chip: ★ prefer, then 🔒 lock. The proposal puts the player on Support.
  await chip(`${name} Support: not set`).click();
  await expect(chip(`${name} Support: preferred`)).toBeVisible();
  await chip(`${name} Support: preferred`).click();
  await expect(chip(`${name} Support: locked`)).toBeVisible();
  await expect(support).toContainText(name);
  expect(await page.locator(".proposal-table").innerText()).not.toBe(before);
  // The rank badge: Diamond II by hand.
  await page.getByRole("button", { name: new RegExp(`^${name} rank: `) }).click();
  const pop = page.getByRole("dialog", { name: `Rank of ${name}` });
  await pop.getByRole("button", { name: "Diamond", exact: true }).click();
  await pop.getByRole("button", { name: "Diamond II", exact: true }).click();
  await expect(page.getByRole("button", { name: `${name} rank: D2` })).toHaveAttribute("data-source", "manual");
  await page.screenshot({ path: `${shots}teams-preferences.png`, fullPage: true });

  // Export: no dialog in the test, the file is written to LOL_VIEWER_E2E_SAVE_PATH.
  rmSync(savePath, { force: true });
  await subTab(/^People/).click();
  await page.getByRole("button", { name: "People actions" }).click();
  await page.getByRole("menuitem", { name: "Export preferences…" }).click();
  await expect(toast()).toContainText("Saved preferences for 1 person.");
  expect(existsSync(savePath)).toBe(true);
  const parsed = parsePrefsFile(readFileSync(savePath, "utf8"));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.entries).toHaveLength(1);
  expect(parsed.entries[0]).toMatchObject({ riotId: `${name}#${name.replace("player-", "tag-")}`, pref: { lock: "support", rankOverride: 2600 } });
  expect(JSON.parse(readFileSync(savePath, "utf8")).players[0]).toMatchObject({ lock: "support", rank: "DIAMOND II" });

  // Clear: right-click the chip, and Auto in the rank popover.
  await chip(`${name} Support: locked`).click({ button: "right" });
  await expect(chip(`${name} Support: not set`)).toBeVisible();
  await page.getByRole("button", { name: `${name} rank: D2` }).click();
  await page.getByRole("dialog", { name: `Rank of ${name}` }).getByRole("button", { name: /^Auto/ }).click();
  await expect(page.getByRole("button", { name: `${name} rank: D2` })).toHaveCount(0);
  await subTab("Match").click();
  await expect(support).not.toContainText(name);
  await subTab(/^People/).click();

  // Import the file: a confirm bar first, then the same preferences are back.
  await page.locator('input[type="file"]').setInputFiles(savePath);
  const bar = page.getByTestId("import-bar");
  await expect(bar).toContainText("Import 1 person?");
  await expect(chip(`${name} Support: not set`)).toBeVisible(); // nothing yet
  await page.screenshot({ path: `${shots}teams-import.png`, fullPage: true });
  await bar.getByRole("button", { name: "Import" }).click();
  await expect(toast()).toContainText("Imported preferences for 1 person.");
  await expect(chip(`${name} Support: locked`)).toBeVisible();
  await expect(page.getByRole("button", { name: `${name} rank: D2` })).toHaveAttribute("data-source", "manual");
  await subTab("Match").click();
  await expect(support).toContainText(name);
  expect(fake.rejectedWrites).toEqual([]);
});

test("saved Rosters and Matchups stay after the app is closed and started again", async () => {
  await subTab("Match").click();
  await expect(playersHeading()).toHaveText("Players 10 of 12");
  // A roster of the ten who play, and the proposal on screen.
  await page.getByRole("button", { name: "Rosters", exact: true }).click();
  await page.getByRole("menuitem", { name: "Save current as…" }).click();
  const rosterDlg = page.getByRole("dialog", { name: "Save roster" });
  await rosterDlg.getByLabel("Roster name").fill("E2E ten");
  await rosterDlg.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "☆ Save" }).click();
  const matchDlg = page.getByRole("dialog", { name: "Save matchup" });
  await matchDlg.getByLabel("Matchup name").fill("E2E split");
  await matchDlg.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "★ Saved as “E2E split”" })).toBeVisible();
  await expect(subTab(/^Matchups/)).toContainText("1");
  const split = await page.getByRole("region", { name: "Proposals" }).locator(".proposal-table").innerText();

  await app.close();
  await launch();
  await expect(page.locator(".conn")).toHaveAttribute("data-status", "connected", { timeout: 15_000 });
  await tab("Teams").click();
  await expect(subTab(/^Matchups/)).toContainText("1");
  // Who plays is not saved: the spectator who was ticked in sits out again.
  await expect(playersHeading()).toHaveText("Players 9 of 12", { timeout: 30_000 });
  await page.getByRole("button", { name: "Rosters", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "E2E ten · 10 people" })).toBeVisible();
  await page.keyboard.press("Escape");
  await subTab(/^Matchups/).click();
  const card = page.getByRole("listitem", { name: "E2E split" });
  await expect(card).toBeVisible();
  await expect(card.locator(".slot-btn")).toHaveCount(10);
  await page.screenshot({ path: `${shots}teams-matchups.png`, fullPage: true });
  // The roster loads and the matchup opens the same split as before the restart.
  await card.getByRole("button", { name: "Open in Match" }).click();
  await expect(page.getByTestId("proposal-count")).toHaveText("Saved: E2E split");
  await expect(playersHeading()).toHaveText("Players 10 of 12");
  expect(await page.getByRole("region", { name: "Proposals" }).locator(".proposal-table").innerText()).toBe(split);
  await page.screenshot({ path: `${shots}teams-matchup-opened.png`, fullPage: true });
  await page.getByRole("button", { name: "Rosters", exact: true }).click();
  await page.getByRole("menuitem", { name: "E2E ten · 10 people" }).click();
  await expect(playersHeading()).toHaveText("Players 10 of 12");
  await expect(page.getByTestId("roster-line")).toHaveText("Roster: E2E ten");
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
