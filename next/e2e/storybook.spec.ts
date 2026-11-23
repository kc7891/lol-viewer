/**
 * Renders every story in a real Chromium on Linux and saves a screenshot to
 * e2e/screenshots/storybook/<story-id>.png (uploaded as a CI artifact, and
 * readable by an AI agent to check the UI with its own eyes).
 * Then drives the main operations of the new UI (docs/spec/new-app-design.md §3-4).
 */
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const shotDir = fileURLToPath(new URL("./screenshots/storybook/", import.meta.url));

type Index = { entries: Record<string, { id: string; type: string; title: string; name: string }> };
const index = JSON.parse(readFileSync(new URL("../apps/web/storybook-static/index.json", import.meta.url), "utf8")) as Index;
const stories = Object.values(index.entries).filter((e) => e.type === "story");

test("storybook has stories", () => {
  expect(stories.length).toBeGreaterThan(40);
});

for (const story of stories) {
  test(`${story.title} / ${story.name}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && !m.text().includes("ddragon") && !m.text().includes("Failed to load resource") && errors.push(m.text()));

    await page.goto(`/iframe.html?id=${story.id}&viewMode=story`);
    await page.locator("#storybook-root > *").first().waitFor();
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${shotDir}${story.id}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
}

const open = async (page: Page, id: string) => {
  await page.goto(`/iframe.html?id=${id}&viewMode=story`);
  await page.locator("#storybook-root > *").first().waitFor();
};
const slotUrls = (page: Page) => page.locator(".viewers-page").getByTestId("slot-url");

test("complete champ select: 10 champions, my viewer, 5 enemy picks, YOU on my row", async ({ page }) => {
  await open(page, "screens-app--champ-select-complete");
  await expect(page.locator(".matchup-row")).toHaveCount(5);
  await expect(page.locator(".matchup-row .champ-btn")).toHaveCount(10);
  await expect(page.locator(".viewer-pane")).toHaveCount(1);
  await expect(page.locator(".pending .row")).toHaveCount(5);
  await expect(page.locator('.matchup-row[data-lane="middle"] .you')).toBeVisible();
});

test("second match closes every viewer and pending pick (M-001)", async ({ page }) => {
  await open(page, "screens-app--second-match-closes-everything");
  await expect(page.locator(".matchup-row .champ-btn")).toHaveCount(2);
  await expect(page.locator(".viewers .row .name")).toHaveText(["Aatrox"]);
});

test("cooldowns default to my lane's enemy and follow clicks", async ({ page }) => {
  await open(page, "screens-app--champ-select-complete");
  const panel = page.getByRole("region", { name: "Cooldowns" });
  await expect(panel.locator(".cd-champ")).toContainText("Zed");
  await expect(panel.locator("tr")).toHaveCount(4);
  await page.locator('.matchup-row[data-lane="top"] .side.enemy .champ-btn').click();
  await expect(panel.locator(".cd-champ")).toContainText("Garen");
});

test("CooldownPanel: numbers per rank, dash when Data Dragon has none", async ({ page }) => {
  await open(page, "components-cooldownpanel--ahri");
  await expect(page.locator('tr[data-spell="W"] .spell-cd')).toHaveText("9 / 8 / 7 / 6 / 5 s");
  await open(page, "components-cooldownpanel--gangplank");
  await expect(page.locator('tr[data-spell="E"] .spell-cd')).toHaveText("—");
});

test("add a viewer, pick a champion by hiragana, check the URL", async ({ page }) => {
  await open(page, "screens-app--waiting-for-champ-select");
  await page.getByRole("button", { name: "Add viewer" }).first().click();
  // The picker is open from the start, search box focused.
  const search = page.getByLabel("Search champions");
  await expect(search).toBeFocused();
  await search.fill("あーり");
  await expect(page.getByRole("option").first()).toContainText("Ahri");
  await search.press("Enter");
  await expect(slotUrls(page)).toHaveText("https://lolalytics.com/lol/ahri/build/");
  await expect(page.locator(".viewers .row .name")).toHaveText(["Ahri"]);
  await expect(page.locator(".viewers .row .kind")).toHaveText(["Build"]);
});

test("champion picker: arrow keys and Esc", async ({ page }) => {
  await open(page, "screens-app--manual-viewers");
  await page.getByRole("button", { name: "Champion", exact: true }).first().click();
  const search = page.locator('[data-pane-id="1"]').getByLabel("Search champions");
  await search.press("ArrowRight");
  await search.press("ArrowDown");
  await expect(page.locator('[data-pane-id="1"] .champ-cell[data-active="true"]')).toHaveCount(1);
  await search.press("Escape");
  await expect(page.locator('[data-pane-id="1"]').getByLabel("Search champions")).toHaveCount(0);
  await expect(page.locator(".panel")).toHaveCount(1); // the empty second viewer keeps its picker
});

test("opponent: quick pick gives the Matchup URL, None goes back to Build", async ({ page }) => {
  await open(page, "screens-app--champ-select-complete");
  await page.getByRole("button", { name: "Set Zed as opponent" }).click();
  await expect(slotUrls(page)).toHaveText("https://lolalytics.com/lol/ahri/vs/zed/build/?lane=middle&vslane=middle");
  await page.getByRole("button", { name: "Opponent", exact: true }).click();
  await expect(page.getByText("Suggested")).toBeVisible();
  await page.getByRole("option", { name: /None/ }).click();
  await expect(slotUrls(page)).toHaveText("https://lolalytics.com/lol/ahri/build/?lane=middle");
});

test("opponent picker by hand (Japanese name), lane panel, mode switch", async ({ page }) => {
  await open(page, "screens-app--champ-select-complete");
  await page.getByRole("button", { name: "Opponent", exact: true }).click();
  await page.getByLabel("Search champions").fill("ガレン");
  await page.getByLabel("Search champions").press("Enter");
  await expect(slotUrls(page)).toHaveText("https://lolalytics.com/lol/ahri/vs/garen/build/?lane=middle&vslane=middle");
  await page.getByRole("button", { name: "Lane", exact: true }).click();
  await page.getByRole("button", { name: "Top", exact: true }).click();
  await expect(slotUrls(page)).toHaveText("https://lolalytics.com/lol/ahri/vs/garen/build/?lane=top&vslane=top");
  await page.getByRole("button", { name: "ARAM", exact: true }).click();
  await expect(slotUrls(page)).toHaveText("https://u.gg/lol/champions/aram/ahri-aram");
  await expect(page.getByRole("button", { name: "Lane", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Opponent", exact: true })).toBeDisabled();
});

test("drag an enemy onto another enemy row swaps them; across sides does nothing (M-005)", async ({ page }) => {
  await open(page, "screens-app--champ-select-complete");
  const names = () => page.locator(".matchup-row .side.enemy .name").allTextContents();
  expect(await names()).toEqual(["Garen", "Nidalee", "Zed", "Caitlyn", "Leona"]);
  await page.locator('.matchup-row[data-lane="top"] .side.enemy .champ-btn').dragTo(page.locator('.matchup-row[data-lane="jungle"] .side.enemy'));
  expect(await names()).toEqual(["Nidalee", "Garen", "Zed", "Caitlyn", "Leona"]);
  await page.locator('.matchup-row[data-lane="top"] .side.enemy .champ-btn').dragTo(page.locator('.matchup-row[data-lane="jungle"] .side.ally'));
  expect(await names()).toEqual(["Nidalee", "Garen", "Zed", "Caitlyn", "Leona"]);
});

test("matchup row button opens a Build viewer with the opponent and lane", async ({ page }) => {
  await open(page, "screens-app--champ-select-complete");
  await page.getByRole("button", { name: "Open TOP matchup" }).click({ force: true });
  await expect(page.locator(".viewer-pane")).toHaveCount(2);
  await expect(slotUrls(page).last()).toHaveText("https://lolalytics.com/lol/darius/vs/garen/build/?lane=top&vslane=top");
});

test("an enemy pick becomes a Counter viewer", async ({ page }) => {
  await open(page, "screens-app--champ-select-complete");
  await page.getByRole("button", { name: "Open Counter for Garen" }).click();
  await expect(page.locator(".pending .row")).toHaveCount(4);
  await expect(page.locator(".viewer-pane")).toHaveCount(2);
  // Placed right after my picked viewer.
  await expect(slotUrls(page).nth(1)).toHaveText("https://lolalytics.com/lol/garen/counters/");
  await page.getByRole("button", { name: "Remove Zed" }).click();
  await expect(page.locator(".pending .row")).toHaveCount(3);
});

test("close one viewer, hide with double-click, close all", async ({ page }) => {
  await open(page, "screens-app--three-viewers");
  await expect(page.locator(".viewer-pane")).toHaveCount(3);
  await page.locator('.viewers .row[data-viewer-id="2"]').hover();
  await page.getByRole("button", { name: "Close Zed" }).click();
  await expect(page.locator(".viewer-pane")).toHaveCount(2);

  await page.locator(".viewers .row-main").first().dblclick();
  await expect(page.locator(".viewer-pane")).toHaveCount(1);
  // M-006: the row itself shows no hidden state or opponent.
  await expect(page.locator(".viewers .row").first()).not.toContainText(/hidden|vs/i);

  await page.getByRole("button", { name: "Close all viewers" }).click();
  await expect(page.locator(".viewers .row")).toHaveCount(0);
  await expect(page.locator(".pending")).toHaveCount(0);
  await expect(page.getByText("No viewers yet")).toBeVisible();
});

test("sidebar lists picked viewers first, then the others", async ({ page }) => {
  await open(page, "screens-app--three-viewers");
  const rows = page.locator(".viewers .row");
  await expect(rows).toHaveCount(3);
  await expect(rows.first().locator(".name")).toHaveText("Ahri");
  // the picked viewer comes before every non-picked one
  const picked = await page.locator(".viewers .row").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.viewerId));
  expect(picked[0]).toBe("1");
});

test("viewer limit: the add button refuses with a notice", async ({ page }) => {
  await open(page, "screens-app--viewer-limit");
  await expect(page.getByText("20/20")).toBeVisible();
  await page.getByRole("button", { name: "Add viewer" }).first().click();
  await expect(page.locator(".viewer-pane")).toHaveCount(20);
  await expect(page.locator(".toast", { hasText: "Viewer limit reached" })).toHaveCount(1);
});

test("panes keep a 300px minimum and the strip scrolls sideways", async ({ page }) => {
  await open(page, "screens-app--viewer-limit");
  const w = await page.locator(".pane-cell").first().evaluate((el) => el.getBoundingClientRect().width);
  expect(w).toBeGreaterThanOrEqual(300);
  const strip = page.locator(".strip");
  expect(await strip.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
});

test("dragging the handle between panes trades width", async ({ page }) => {
  await open(page, "screens-app--three-viewers");
  const widths = () => page.locator(".pane-cell").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
  const before = await widths();
  const handle = page.locator(".pane-handle").first();
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 4, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 4 + 20, box.y + 200, { steps: 4 });
  await page.mouse.up();
  const after = await widths();
  expect(after[0]).toBeGreaterThan(before[0]!);
  expect(after[1]).toBeLessThan(before[1]!);
  expect(after[0]! + after[1]!).toBeLessThanOrEqual(before[0]! + before[1]! + 1);
});

test("QR button swaps the page for a QR code of its URL", async ({ page }) => {
  await open(page, "screens-app--three-viewers");
  await page.getByRole("button", { name: "QR" }).first().click();
  await expect(page.getByRole("img", { name: "QR code" })).toBeVisible();
  await expect(page.getByTestId("qr-url")).toHaveText("https://lolalytics.com/lol/ahri/build/?lane=middle");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("img", { name: "QR code" })).toHaveCount(0);
});

test("QR button can be switched off in Settings", async ({ page }) => {
  await open(page, "screens-app--qr-button-off");
  await expect(page.getByRole("button", { name: "QR" })).toHaveCount(0);
});

test("Settings: URL validation blocks saving, saving works, UI size applies at once", async ({ page }) => {
  await open(page, "screens-app--settings-url-errors");
  await expect(page.locator(".field[data-invalid]")).toHaveCount(2);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".field[data-invalid]")).toHaveCount(2);
  await page.locator("#url-counter").fill("https://lolalytics.com/lol/{name}/counters/?x=1");
  await page.locator("#url-liveGame").fill("https://u.gg/lol/lg-splash");
  await expect(page.locator(".field[data-invalid]")).toHaveCount(0);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".toasts-floating .toast", { hasText: "URLs saved" })).toBeVisible();

  await page.getByRole("button", { name: "Large" }).click();
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--ui-scale"))).toBe("1.15");
  await page.getByRole("button", { name: "Small" }).click();
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--ui-scale"))).toBe("0.9");
});

test("Settings: Reconnect shows Connecting… for a moment; Version says dev in the browser", async ({ page }) => {
  await open(page, "screens-app--settings");
  await page.getByRole("button", { name: "Reconnect" }).click();
  await expect(page.getByRole("button", { name: "Connecting…" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Reconnect" })).toBeEnabled({ timeout: 4000 });
  await expect(page.getByTestId("version")).toHaveText("dev");
});

test("Settings > Version: browser says updates are in the desktop app; states show the right text and button", async ({ page }) => {
  await open(page, "components-settingscards--version-dev");
  await expect(page.getByText("Updates are available in the desktop app.")).toBeVisible();
  await expect(page.getByRole("button", { name: /update/i })).toHaveCount(0);

  const cases: [string, string, string | null][] = [
    ["version-updates-off", "Update checks are off in this build.", null],
    ["version-not-checked", "Not checked yet.", "Check for updates"],
    ["version-up-to-date", "You have the latest version.", "Check for updates"],
    ["version-update-available", "A new version is available.", "Download"],
    ["version-downloading", "Downloading… 42%", "Download"],
    ["version-ready-to-install", "Ready to install. The app restarts.", "Restart and update"],
    ["version-update-error", "Could not reach the update server.", "Check for updates"],
  ];
  for (const [id, text, button] of cases) {
    await open(page, `components-settingscards--${id}`);
    await expect(page.getByTestId("update-status")).toHaveText(text);
    if (button) await expect(page.getByRole("button", { name: button })).toBeVisible();
    else await expect(page.getByRole("button", { name: /update|download/i })).toHaveCount(0);
  }
  await open(page, "components-settingscards--version-downloading");
  await expect(page.getByRole("button", { name: "Download" })).toBeDisabled();
  await expect(page.getByRole("progressbar", { name: "Download progress" })).toHaveAttribute("value", "42");
});

test("Settings > Version: Check -> Download -> Restart and update (simulated)", async ({ page }) => {
  await open(page, "components-settingscards--version-update-flow");
  await page.getByRole("button", { name: "Check for updates" }).click();
  await expect(page.getByTestId("update-status")).toHaveText("A new version is available.");
  await expect(page.getByTestId("latest-version")).toHaveText("0.2.0");
  await page.getByRole("button", { name: "Download" }).click();
  await expect(page.getByTestId("update-status")).toHaveText("Ready to install. The app restarts.", { timeout: 4000 });
  await page.getByRole("button", { name: "Restart and update" }).click();
  await expect(page.getByTestId("update-status")).toHaveText("Not checked yet.");
});

test("Top bar: Settings gets a dot only when an update is available or downloaded", async ({ page }) => {
  const dot = page.getByRole("img", { name: "Update available" });
  await open(page, "screens-app--viewers-update-available");
  await expect(dot).toBeVisible();
  await open(page, "screens-app--settings-update-downloaded");
  await expect(dot).toBeVisible();
  await open(page, "screens-app--viewers-up-to-date");
  await expect(dot).toHaveCount(0);
  await open(page, "screens-app--waiting-for-champ-select");
  await expect(dot).toHaveCount(0);
});

test("Settings: Debug adds an ally to the first empty row, and says when full", async ({ page }) => {
  await open(page, "screens-app--settings");
  const debug = page.getByRole("region", { name: "Debug" });
  await debug.getByLabel("Debug champion").fill("ahri");
  await debug.getByRole("option").first().click();
  await debug.getByRole("button", { name: "Add enemy" }).click();
  await expect(debug.getByRole("status")).toContainText("full"); // all five enemy rows are taken in this scene
});

test("Top bar: clicking the connection status goes to Settings", async ({ page }) => {
  await open(page, "screens-app--disconnected");
  await page.getByRole("button", { name: /Disconnected/ }).click();
  await expect(page.getByRole("heading", { name: "League Client" })).toBeVisible();
});

// ── Live Client data (feature flag liveClientData, M-025..M-029) ──

test("in game with live data: enemies moved to their lanes, gold and level diffs, cooldowns on my lane opponent", async ({ page }) => {
  await open(page, "screens-app--in-game-live");
  await expect(page.locator(".matchup-row .side.enemy .name")).toHaveText(["Pantheon", "Gragas", "Jayce", "Varus", "Karma"]);
  const row = (lane: string) => page.locator(`.matchup-row[data-lane="${lane}"]`);
  await expect(row("jungle").locator(".live-diff .gold")).toHaveText("+1.4k");
  await expect(row("jungle").locator(".live-diff")).toHaveAttribute("data-trend", "ahead");
  await expect(row("middle").locator(".live-diff .gold")).toHaveText("-150");
  await expect(row("middle").locator(".live-diff")).toHaveAttribute("data-trend", "behind");
  await expect(row("support").locator(".live-diff .gold")).toHaveText("0");
  await expect(row("support").locator(".live-diff")).toHaveAttribute("data-trend", "even");
  await expect(row("bottom").locator(".live-diff .lvl")).toHaveText("Lv-1");
  await expect(row("support").locator(".lvl")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Cooldowns" }).locator(".cd-champ")).toContainText("Jayce");
});

test("live data flag off: the table and cooldowns are as before", async ({ page }) => {
  await open(page, "screens-app--in-game-live-flag-off");
  await expect(page.locator(".matchup-row .side.enemy .name")).toHaveText(["Jayce", "Karma", "Gragas", "Varus", "Pantheon"]);
  await expect(page.locator(".live-diff")).toHaveCount(0);
  await expect(page.locator(".matchup-row .vs")).toHaveText(["vs", "vs", "vs", "vs", "vs"]);
  await expect(page.getByRole("region", { name: "Cooldowns" }).locator(".cd-champ")).toContainText("Gragas");
});

test("Settings: the live data flag is off by default, toggles at once and resets", async ({ page }) => {
  await open(page, "screens-app--settings");
  const card = page.getByRole("region", { name: "Feature flags" });
  const sw = card.getByRole("switch", { name: "Live game data" });
  const reset = card.getByRole("button", { name: "Reset flags to defaults" });
  await expect(sw).not.toBeChecked();
  await expect(reset).toBeDisabled();
  await sw.click();
  await expect(sw).toBeChecked();
  await expect(page.locator(".toasts-floating .toast", { hasText: "Live game data: on." })).toBeVisible();
  await expect(reset).toBeEnabled();
  await reset.click();
  await expect(sw).not.toBeChecked();
  await expect(page.locator(".toasts-floating .toast", { hasText: "Feature flags reset to defaults." })).toBeVisible();
});

test("live data: my swap after the correction is kept", async ({ page }) => {
  await open(page, "components-sidebar--matchup-live-swap-kept");
  await expect(page.locator(".matchup-row .side.enemy .name")).toHaveText(["Karma", "Gragas", "Jayce", "Varus", "Pantheon"]);
});
