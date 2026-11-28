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

test("Settings > LCU check: Run shows progress and a report; the Riot ID is validated; browsers get a notice (M-039)", async ({ page }) => {
  await open(page, "components-settingscards--lcu-check-idle");
  const card = page.getByRole("region", { name: "LCU check" });
  await expect(card.getByRole("button", { name: "Run check" })).toBeEnabled();
  await expect(card.getByLabel("LCU check report")).toHaveCount(0);
  const riot = card.getByLabel("Riot ID to look up (optional)");
  await riot.fill("no-tag");
  await expect(card.getByRole("button", { name: "Run check" })).toBeDisabled();
  await expect(card.getByText("Use name#tag.")).toBeVisible();
  await riot.fill("Name#JP1");
  await card.getByRole("button", { name: "Run check" }).click();
  const report = card.getByLabel("LCU check report");
  await expect(report).toHaveValue(/LoL Viewer LCU check/);
  await expect(report).toHaveValue(/current-summoner +200/);
  await expect(card.getByRole("button", { name: "Copy report" })).toBeVisible();

  await open(page, "components-settingscards--lcu-check-running");
  await expect(page.getByRole("region", { name: "LCU check" }).getByRole("status")).toHaveText("12 / 20 …");
  await expect(page.getByRole("region", { name: "LCU check" }).getByRole("button", { name: "Run check" })).toBeDisabled();

  await open(page, "components-settingscards--lcu-check-disconnected");
  await expect(page.getByRole("region", { name: "LCU check" }).getByRole("button", { name: "Run check" })).toBeDisabled();
  await expect(page.getByText("Connect to the League Client first.")).toBeVisible();

  await open(page, "components-settingscards--lcu-check-browser");
  await expect(page.getByRole("region", { name: "LCU check" }).getByText("Only available in the desktop app.")).toBeVisible();
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
  // Team total: every live player's item gold, ally minus enemy
  const team = page.locator(".matchup-row.team-total");
  await expect(team).toHaveAttribute("data-gold-diff", "450");
  await expect(team.locator(".live-diff .gold")).toHaveText("+450");
  await expect(team.locator(".live-diff")).toHaveAttribute("data-trend", "ahead");
  await expect(team.locator(".team-gold")).toHaveText(["21.1k", "20.7k"]);
  await expect(page.getByRole("region", { name: "Cooldowns" }).locator(".cd-champ")).toContainText("Jayce");
});

test("live data flag off: the table and cooldowns are as before", async ({ page }) => {
  await open(page, "screens-app--in-game-live-flag-off");
  await expect(page.locator(".matchup-row .side.enemy .name")).toHaveText(["Jayce", "Karma", "Gragas", "Varus", "Pantheon"]);
  await expect(page.locator(".live-diff")).toHaveCount(0);
  await expect(page.locator(".team-total")).toHaveCount(0);
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

// ── In-game overlay (feature flag inGameOverlay, M-034) ──

test("Settings: the overlay flag is off by default, disabled without live data, then switchable (M-034)", async ({ page }) => {
  await open(page, "components-settingscards--feature-flags");
  const card = page.getByRole("region", { name: "Feature flags" });
  const overlay = card.getByRole("switch", { name: "In-game overlay (hold Tab)" });
  await expect(overlay).not.toBeChecked();
  await expect(overlay).toBeDisabled();
  await expect(card.getByTestId("flag-inGameOverlay-requires")).toHaveText("Requires Live game data");
  await expect(card.getByTestId("flag-inGameOverlay-windows-only")).toHaveCount(0); // desktop app on Windows

  await open(page, "components-settingscards--feature-flags-live-on");
  const card2 = page.getByRole("region", { name: "Feature flags" });
  const overlay2 = card2.getByRole("switch", { name: "In-game overlay (hold Tab)" });
  await expect(overlay2).toBeEnabled();
  await expect(overlay2).not.toBeChecked();
  await expect(card2.getByTestId("flag-inGameOverlay-requires")).toHaveCount(0);
  await overlay2.click();
  await expect(overlay2).toBeChecked();
  await card2.getByRole("button", { name: "Reset flags to defaults" }).click();
  await expect(overlay2).not.toBeChecked();
});

test("Settings: the overlay position picker defaults to Bottom left, saves at once, and is disabled while the overlay is off (M-036)", async ({ page }) => {
  await open(page, "components-settingscards--feature-flags");
  const off = page.getByRole("radiogroup", { name: "Overlay position" });
  await expect(off.getByRole("radio")).toHaveCount(6);
  await expect(off.getByRole("radio", { name: "Bottom left" })).toBeChecked();
  await expect(off.getByRole("radio", { name: "Top right" })).toBeDisabled();

  await open(page, "components-settingscards--feature-flags-on");
  const on = page.getByRole("radiogroup", { name: "Overlay position" });
  await expect(on.getByRole("radio", { name: "Top right" })).toBeChecked(); // the story's setting
  await on.getByRole("radio", { name: "Bottom center" }).click();
  await expect(on.getByRole("radio", { name: "Bottom center" })).toBeChecked();
  await expect(on.getByRole("radio", { name: "Top right" })).not.toBeChecked();
  await on.getByRole("radio", { name: "Top right" }).click();
  await expect(on.getByRole("radio", { name: "Top right" })).toBeChecked();

  await open(page, "components-settingscards--feature-flags-live-on"); // live on, overlay off: still disabled
  const live = page.getByRole("radiogroup", { name: "Overlay position" });
  await expect(live.getByRole("radio", { name: "Bottom left" })).toBeChecked();
  await expect(live.getByRole("radio", { name: "Top right" })).toBeDisabled();
});

test("Settings: the overlay flag says Windows only outside Windows and in a browser", async ({ page }) => {
  await open(page, "components-settingscards--feature-flags-not-windows");
  await expect(page.getByTestId("flag-inGameOverlay-windows-only")).toHaveText("Windows only");
  await open(page, "components-settingscards--feature-flags-browser");
  await expect(page.getByTestId("flag-inGameOverlay-windows-only")).toHaveText("Windows only");
  await open(page, "components-settingscards--feature-flags-on");
  await expect(page.getByRole("switch", { name: "In-game overlay (hold Tab)" })).toBeChecked();
  await expect(page.getByTestId("flag-inGameOverlay-windows-only")).toHaveCount(0);
});

test("overlay table: same differences and team totals as the sidebar's Matchup (M-034)", async ({ page }) => {
  await open(page, "components-sidebar--matchup-live");
  const sidebar = {
    gold: await page.locator(".matchup-row[data-lane] .live-diff .gold").allTextContents(),
    teamDiff: await page.locator(".matchup-row.team-total .live-diff .gold").textContent(),
    team: await page.locator(".matchup-row.team-total .team-gold").allTextContents(),
    titles: await page.locator(".matchup-row[data-lane] .live-diff").evaluateAll((els) => els.map((e) => e.getAttribute("title") ?? "")),
  };
  expect(sidebar.gold).toEqual(["+150", "+1.4k", "-150", "-950", "0"]);

  await open(page, "overlay-overlaytable--live-mid");
  const table = page.getByRole("region", { name: "Item gold differences" });
  await expect(table.locator(".ov-row")).toHaveCount(6);
  const ov = (lane: string) => table.locator(`.ov-row[data-lane="${lane}"] .ov-gold`);
  await expect(ov("jungle")).toHaveText("+1.4k");
  await expect(ov("jungle")).toHaveAttribute("data-trend", "ahead");
  await expect(ov("middle")).toHaveText("-150");
  await expect(ov("middle")).toHaveAttribute("data-trend", "behind");
  await expect(ov("support")).toHaveText("0");
  await expect(ov("support")).toHaveAttribute("data-trend", "even");
  const team = table.locator(".ov-team");
  await expect(team).toHaveAttribute("data-gold-diff", "450");
  await expect(team.locator(".ov-gold")).toHaveText("+450");
  await expect(team.locator(".ov-team-gold")).toHaveText(sidebar.team);
  // Every lane's difference equals the sidebar's, in the same order
  await expect(table.locator(".ov-row:not(.ov-team) .ov-gold")).toHaveText(sidebar.gold);
  await expect(table.locator(".ov-team .ov-gold")).toHaveText(sidebar.teamDiff!);
  // Each side's own item gold and level (M-037), cross-checked with the sidebar's tooltip ("Item gold: A 4,500 vs B 3,000 · Level 11 vs 10")
  const fmt = (n: number) => (n >= 1000 ? `${(Math.round(n / 100) / 10).toFixed(1)}k` : String(n));
  const lanes = ["top", "jungle", "middle", "bottom", "support"];
  for (const [i, lane] of lanes.entries()) {
    const m = sidebar.titles[i]!.match(/ ([\d,]+) vs .* ([\d,]+) · Level (\d+) vs (\d+)/);
    expect(m, `tooltip of ${lane}`).not.toBeNull();
    const [allyGold, enemyGold] = [Number(m![1]!.replace(/,/g, "")), Number(m![2]!.replace(/,/g, ""))];
    const row = table.locator(`.ov-row[data-lane="${lane}"]`);
    await expect(row.locator(".ov-stat.ally .ov-stat-gold")).toHaveText(fmt(allyGold));
    await expect(row.locator(".ov-stat.enemy .ov-stat-gold")).toHaveText(fmt(enemyGold));
    await expect(row.locator(".ov-stat.ally .ov-stat-lvl")).toHaveText(`Lv ${m![3]}`);
    await expect(row.locator(".ov-stat.enemy .ov-stat-lvl")).toHaveText(`Lv ${m![4]}`);
    // ally minus enemy is the diff shown in the middle
    await expect(row.locator(".ov-gold")).toHaveAttribute("data-gold-diff", String(allyGold - enemyGold));
  }
  const jg = table.locator('.ov-row[data-lane="jungle"]');
  await expect(jg.locator(".ov-stat.ally")).toHaveCSS("text-align", "start");
  await expect(jg.locator(".ov-stat.enemy")).toHaveCSS("text-align", "right");
  await expect(table.locator('.ov-row[data-lane="bottom"] .ov-stat')).toHaveCount(2);
});

test("overlay table: early game (level 1) and my swap are kept", async ({ page }) => {
  await open(page, "overlay-overlaytable--live-early");
  const table = page.getByRole("region", { name: "Item gold differences" });
  await expect(table.locator('.ov-row[data-lane="top"] .ov-stat-lvl').first()).toHaveText("Lv 1");
  await expect(table.locator(".ov-team")).toBeVisible();
  await open(page, "overlay-overlaytable--live-swap-kept");
  // The enemy in the top row is Karma after the swap: that row has no live partner at the same lane, so its difference is whatever its own entries give
  await expect(page.getByRole("region", { name: "Item gold differences" }).locator(".ov-row")).toHaveCount(6);
});

test("overlay table: the background stays see-through", async ({ page }) => {
  await open(page, "overlay-overlaytable--over-checkerboard");
  const bg = await page.locator(".ov-table").evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(bg).toMatch(/^rgba\(13, 17, 23, 0\.82\)$/);
});

test("live data: my swap after the correction is kept", async ({ page }) => {
  await open(page, "components-sidebar--matchup-live-swap-kept");
  await expect(page.locator(".matchup-row .side.enemy .name")).toHaveText(["Karma", "Gragas", "Jayce", "Varus", "Pantheon"]);
});

// ── Teams (M-038, reworked in M-040) ──

const names = (n: number) => Array.from({ length: n }, (_, i) => `Player${i + 1}`);
const discord = (page: Page) => page.getByLabel("Discord text");
const playersHeading = (page: Page) => page.getByRole("region", { name: "Players" }).getByRole("heading");
const chip = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
/** The Discord text is only in Preview: open it from the options menu. */
const showPreview = async (page: Page) => {
  await page.getByRole("button", { name: "Discord options" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Preview" }).click();
  await page.keyboard.press("Escape");
};
const tabBtn = (page: Page, name: RegExp | string) => page.getByRole("tab", { name });

test("Teams tab shows only with the feature flag, and the Match page lists the lobby", async ({ page }) => {
  await open(page, "screens-app--waiting-for-champ-select");
  await expect(page.getByRole("button", { name: "Teams", exact: true })).toHaveCount(0);
  await open(page, "screens-app--teams-tab");
  await expect(page.getByRole("button", { name: "Teams", exact: true })).toBeVisible();
  await expect(playersHeading(page)).toHaveText("Players 10 of 12");
  await expect(page.getByTestId("lobby-line")).toHaveText("Custom lobby · 12 people");
  await expect(tabBtn(page, "Match")).toHaveAttribute("aria-selected", "true");
  await expect(tabBtn(page, /^People/)).toContainText("12");
  await expect(page.getByTestId("legend")).toHaveText("★ prefer · 🔒 lock · ✕ avoid · underline = from match history");
});

test("Teams Match: ten players give a table with five lanes, one proposal at a time, and no Discord text until Preview", async ({ page }) => {
  await open(page, "screens-teams--match-ten-players");
  await expect(page.locator(".proposal-table tbody tr")).toHaveCount(5);
  await expect(page.locator(".proposal-table .slot-btn")).toHaveCount(10);
  await expect(page.getByTestId("proposal-diff")).toContainText("Rank diff");
  await expect(page.getByTestId("proposal-count")).toHaveText("1 / 126");
  await expect(page.getByTestId("proposal-diff")).toContainText("1 unknown rank"); // Player9: unranked with too little data
  await expect(discord(page)).toHaveCount(0);
  await showPreview(page);
  const text = await discord(page).inputValue();
  expect(text).toContain("```");
  expect(text).toContain("🟦 BLUE");
  expect(text).toContain("チーム分け案（ランク重視 1）");
  for (const n of names(10)) expect(text).toContain(n);
  // Spectators are in the list, unticked.
  await expect(page.getByRole("checkbox", { name: "Include Player11" })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Include Player1", exact: true })).toBeChecked();
});

test("Teams Match: the checkbox moves people in and out, 9 players give a message, 10 again give proposals", async ({ page }) => {
  await open(page, "screens-teams--match-ten-players");
  await page.getByRole("checkbox", { name: "Include Player1", exact: true }).uncheck();
  await expect(playersHeading(page)).toHaveText("Players 9 of 12");
  await expect(page.getByTestId("count-hint")).toHaveText("Pick 6, 8 or 10");
  await expect(page.getByTestId("proposal-problem")).toHaveText("Pick 6, 8 or 10 players (now 9).");
  // The row stays where it is.
  await expect(page.locator(".team-row").first()).toHaveAttribute("data-puuid", "fx-1");
  await page.getByRole("checkbox", { name: "Include Player11" }).check();
  await expect(playersHeading(page)).toHaveText("Players 10 of 12");
  await expect(page.getByTestId("count-hint")).toHaveCount(0);
  await expect(page.getByTestId("proposal-problem")).toHaveCount(0);
  await showPreview(page);
  expect(await discord(page).inputValue()).toContain("Player11");
  expect(await discord(page).inputValue()).not.toContain("Player1 ");
});

test("Teams Match: eight players have no lane column, nine have a message, locks that clash say which lane", async ({ page }) => {
  await open(page, "screens-teams--match-eight-players");
  await expect(page.locator(".proposal-table tbody tr")).toHaveCount(4);
  await expect(page.locator(".proposal-table[data-laned='false']")).toHaveCount(1);
  await showPreview(page);
  expect(await discord(page).inputValue()).toMatch(/\((TOP|JG|MID|BOT|SUP)\)/);
  await open(page, "screens-teams--match-nine-players");
  await expect(page.getByTestId("proposal-problem")).toHaveText("Pick 6, 8 or 10 players (now 9).");
  await expect(page.getByTestId("count-hint")).toBeVisible();
  await open(page, "screens-teams--match-lock-clash");
  await expect(page.getByTestId("proposal-problem")).toHaveText("Too many players are locked to Jungle.");
});

test("Teams Match: Priority and the proposal arrows", async ({ page }) => {
  await open(page, "screens-teams--match-ten-players");
  await page.getByRole("button", { name: "Lanes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Lanes", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("proposal-count")).toHaveText("1 / 126");
  await showPreview(page);
  expect(await discord(page).inputValue()).toContain("レーン重視 1");
  await page.getByRole("button", { name: "Next proposal" }).click();
  await expect(page.getByTestId("proposal-count")).toHaveText("2 / 126");
  expect(await discord(page).inputValue()).toContain("レーン重視 2");
  await page.getByRole("button", { name: "Previous proposal" }).click();
  await page.getByRole("button", { name: "Previous proposal" }).click(); // wraps to the last one
  await expect(page.getByTestId("proposal-count")).toHaveText("126 / 126");
});

test("Teams Match: lane chips cycle prefer, lock, avoid, clear; a lock puts the player on that lane in every proposal", async ({ page }) => {
  await open(page, "screens-teams--match-ten-players");
  const support = chip(page, "Player2 Support: not set");
  await expect(support).toHaveAttribute("data-state", "none");
  await support.click();
  await expect(chip(page, "Player2 Support: preferred")).toHaveAttribute("data-state", "prefer");
  await chip(page, "Player2 Support: preferred").click();
  await expect(chip(page, "Player2 Support: locked")).toHaveAttribute("data-state", "lock");
  const lane = page.locator('.proposal-table tr[data-lane="support"]');
  await expect(lane).toContainText("Player2"); // Player2 is a jungler, now locked to Support
  await page.getByRole("button", { name: "Next proposal" }).click();
  await expect(lane).toContainText("Player2");
  await page.getByRole("button", { name: "Lanes", exact: true }).click();
  await expect(lane).toContainText("Player2");
  await chip(page, "Player2 Support: locked").click();
  await expect(chip(page, "Player2 Support: avoided")).toHaveAttribute("data-state", "avoid");
  await chip(page, "Player2 Support: avoided").click();
  await expect(chip(page, "Player2 Support: not set")).toBeVisible();
});

test("Teams Match: right-click and Delete / Backspace clear a chip, Enter and Space cycle it from the keyboard", async ({ page }) => {
  await open(page, "screens-teams--match-ten-players");
  const top = () => page.getByRole("button", { name: /^Player3 Top: / });
  await top().focus();
  await page.keyboard.press("Enter");
  await expect(top()).toHaveAttribute("aria-label", "Player3 Top: preferred");
  await page.keyboard.press("Space");
  await expect(top()).toHaveAttribute("aria-label", "Player3 Top: locked");
  await page.keyboard.press("Delete");
  await expect(top()).toHaveAttribute("aria-label", "Player3 Top: not set");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Backspace");
  await expect(top()).toHaveAttribute("aria-label", "Player3 Top: not set");
  await top().click();
  await top().click({ button: "right" });
  await expect(top()).toHaveAttribute("aria-label", "Player3 Top: not set");
  // The chip says what a click does.
  await expect(top()).toHaveAttribute("title", /Click: ★ prefer → 🔒 lock → ✕ avoid → clear\. Right-click to clear\./);
});

test("Teams Match: a third star pushes the oldest one out, and only one lane is locked", async ({ page }) => {
  await open(page, "screens-teams--match-ten-players");
  const lane = (n: string) => page.getByRole("button", { name: new RegExp(`^Player5 ${n}: `) });
  for (const n of ["Top", "Jungle", "Mid"]) await lane(n).click();
  await expect(lane("Top")).toHaveAttribute("aria-label", "Player5 Top: not set");
  await expect(lane("Jungle")).toHaveAttribute("aria-label", "Player5 Jungle: preferred");
  await expect(lane("Mid")).toHaveAttribute("aria-label", "Player5 Mid: preferred");
  await lane("Bot").click();
  await lane("Bot").click(); // lock Bot
  await lane("Top").click();
  await lane("Top").click(); // lock Top: Bot goes back to none
  await expect(lane("Top")).toHaveAttribute("aria-label", "Player5 Top: locked");
  await expect(lane("Bot")).toHaveAttribute("aria-label", "Player5 Bot: not set");
});

test("Teams Match: the rank popover sets a rank by hand, Auto takes it back, Esc closes", async ({ page }) => {
  await open(page, "screens-teams--match-ten-players");
  const badge = () => page.getByRole("button", { name: /^Player9 rank: / });
  await expect(badge()).toHaveText("—");
  await expect(badge()).toHaveAttribute("data-unknown", "true");
  await badge().click();
  const pop = page.getByRole("dialog", { name: "Rank of Player9" });
  await expect(pop).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(pop).toHaveCount(0);
  await badge().click();
  await pop.getByRole("button", { name: "Diamond", exact: true }).click();
  await pop.getByRole("button", { name: "Diamond II", exact: true }).click();
  await expect(pop).toHaveCount(0);
  await expect(badge()).toHaveText("D2");
  await expect(badge()).toHaveAttribute("data-source", "manual");
  await expect(badge()).toHaveAttribute("title", /Manual \(fetched: none\)/);
  await expect(page.getByTestId("proposal-diff")).not.toContainText("unknown rank");
  await badge().click();
  await pop.getByRole("button", { name: "Master", exact: true }).click();
  await pop.getByLabel("LP").fill("120");
  await pop.getByRole("button", { name: "Set" }).click();
  await expect(badge()).toHaveText("M 120LP");
  await badge().click();
  await pop.getByRole("button", { name: /^Auto/ }).click();
  await expect(badge()).toHaveText("—");
});

test("Teams Match: two players can be swapped by hand: Edited, and Reset takes it back", async ({ page }) => {
  await open(page, "screens-teams--match-ten-players");
  await showPreview(page);
  const before = await discord(page).inputValue();
  const first = await page.locator(".proposal-table .slot-btn").nth(0).getAttribute("data-puuid");
  const second = await page.locator(".proposal-table .slot-btn").nth(1).getAttribute("data-puuid");
  await page.locator(`.slot-btn[data-puuid="${first}"]`).click();
  await expect(page.getByText("Pick the second player to swap with.")).toBeVisible();
  await page.locator(`.slot-btn[data-puuid="${second}"]`).click();
  await expect(page.getByTestId("proposal-count")).toHaveText("Edited");
  expect(await discord(page).inputValue()).not.toBe(before);
  expect(await discord(page).inputValue()).toContain("入れ替え後");
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.getByTestId("proposal-count")).toHaveText("1 / 126");
  expect(await discord(page).inputValue()).toBe(before);
});

test("Teams Match: Copy for Discord copies, or opens the Preview and selects the text when the browser refuses; the options change the text", async ({ page }) => {
  await open(page, "screens-teams--match-ten-players");
  await page.getByRole("button", { name: "Discord options" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Show #tag" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Show ranks" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Preview" }).click();
  await page.keyboard.press("Escape");
  const text = await discord(page).inputValue();
  expect(text).toMatch(/Player\d+#tag\d+/);
  expect(text).not.toContain("ランク差");
  // The browser refuses to write to the clipboard: the Preview opens by itself and the text is selected.
  await open(page, "screens-teams--match-ten-players");
  await expect(discord(page)).toHaveCount(0);
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("no")) }, configurable: true }));
  await page.getByRole("button", { name: "Copy for Discord" }).click();
  await expect(page.getByText("Press Ctrl+C to copy.")).toBeVisible();
  await expect(discord(page)).toBeVisible();
  expect(await discord(page).evaluate((e: HTMLTextAreaElement) => e.selectionEnd - e.selectionStart)).toBeGreaterThan(50);
  // The browser lets it copy.
  await open(page, "screens-teams--match-ten-players");
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.resolve() }, configurable: true }));
  await page.getByRole("button", { name: "Copy for Discord" }).click();
  await expect(page.getByText("Copied.")).toBeVisible();
  await expect(discord(page)).toHaveCount(0);
});

test("Teams Match: + Add people lists the saved people who are not on the list, with search", async ({ page }) => {
  await open(page, "screens-teams--match-no-lobby");
  await expect(page.getByTestId("lobby-line")).toContainText("Not in a custom lobby");
  await expect(playersHeading(page)).toHaveText("Players 0 of 0");
  const listTop = async () => (await playersHeading(page).boundingBox())!.y;
  const before = await listTop();
  await page.getByRole("button", { name: "Add people" }).click();
  // A modal over the page (M-041): the players list does not move, and the search has the focus.
  const dialog = page.getByRole("dialog", { name: "Add saved people" });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel("Search saved people")).toBeFocused();
  expect(await listTop()).toBe(before);
  await page.getByLabel("Search saved people").fill("player1");
  await expect(page.locator(".add-person")).toHaveCount(4); // 1, 10, 11, 12
  await page.getByRole("button", { name: "Add Player12" }).click();
  await expect(playersHeading(page)).toHaveText("Players 1 of 1");
  await expect(page.locator(".add-person")).toHaveCount(3); // stays open for more picks
  await page.keyboard.press("Escape");
  await expect(page.locator(".add-people-panel")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add people" })).toBeFocused();
  // Done closes it too, and the search starts empty next time.
  await page.getByRole("button", { name: "Add people" }).click();
  await expect(page.getByLabel("Search saved people")).toHaveValue("");
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toHaveCount(0);
  // Tab stays inside the dialog (search → ... → Done → × → search).
  await page.getByRole("button", { name: "Add people" }).click();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Shift+Tab");
  expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  // A click on the dimmed backdrop closes it, and the focus goes back to the button.
  await page.mouse.click(5, 5);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add people" })).toBeFocused();
  // Added people can be removed from the list again (the row menu).
  await page.getByRole("button", { name: "More for Player12" }).click();
  await page.getByRole("menuitem", { name: "Remove from this list" }).click();
  await expect(playersHeading(page)).toHaveText("Players 0 of 0");
});

test("Teams People: every saved person with the same chips, search, filters and sort", async ({ page }) => {
  await open(page, "screens-teams--people-table");
  await expect(tabBtn(page, /^People/)).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".people-row")).toHaveCount(14);
  await expect(page.locator(".people-row").first().locator(".pname")).toHaveText("Player1");
  await expect(page.locator(".people-row").nth(1).locator(".pname")).toHaveText("Player2"); // natural order
  await page.getByLabel("Search people").fill("player1");
  await expect(page.locator(".people-row")).toHaveCount(6); // 1, 10..14
  await page.getByLabel("Search people").fill("");
  await page.getByRole("group", { name: "Show" }).getByRole("button", { name: /^In lobby/ }).click();
  await expect(page.locator(".people-row")).toHaveCount(12);
  await page.getByRole("group", { name: "Show" }).getByRole("button", { name: /^Old\/missing/ }).click();
  await expect(page.locator(".people-row")).toHaveCount(3); // 12 (6 days old), 13 (name only), 14 (failed)
  await expect(page.getByRole("button", { name: /^Fetch missing & old \(3\)/ })).toBeEnabled();
  await page.getByRole("group", { name: "Show" }).getByRole("button", { name: /^All/ }).click();
  await page.getByRole("group", { name: "Sort by" }).getByRole("button", { name: "Rank" }).click();
  await expect(page.locator(".people-row").first().locator(".pname")).toHaveText("Player11"); // Diamond IV, the best rank saved
  await page.getByRole("group", { name: "Sort by" }).getByRole("button", { name: "Name" }).click();
  // The chips are the same as in Match: a change in People shows in Match.
  await chip(page, "Player4 Support: not set").click();
  await chip(page, "Player4 Support: preferred").click();
  await tabBtn(page, "Match").click();
  await expect(chip(page, "Player4 Support: locked")).toBeVisible();
  // ... and a rank set by hand in Match shows in People.
  await page.getByRole("button", { name: /^Player9 rank: / }).click();
  await page.getByRole("dialog", { name: "Rank of Player9" }).getByRole("button", { name: "Gold", exact: true }).click();
  await page.getByRole("dialog", { name: "Rank of Player9" }).getByRole("button", { name: "Gold I", exact: true }).click();
  await tabBtn(page, /^People/).click();
  await expect(page.getByRole("button", { name: "Player9 rank: G1" })).toHaveAttribute("data-source", "manual");
});

test("Teams People: details show the estimate and the lane shares, Refresh and Forget are in the row menu", async ({ page }) => {
  await open(page, "screens-teams--people-table");
  await page.getByRole("button", { name: "Details of Player4" }).click();
  const est = page.getByRole("region", { name: "Estimate" });
  await expect(est).toContainText("~G3");
  await expect(est).toContainText("22 players in 8 games");
  await expect(est.locator(".estimate-games li")).toHaveCount(8);
  await expect(page.getByRole("region", { name: "Lanes" }).locator("li")).toHaveCount(5);
  await expect(page.getByRole("region", { name: "Rank" })).toContainText("Silver II"); // last season
  await page.getByRole("button", { name: "Details of Player4" }).click();
  await expect(est).toHaveCount(0);
  await page.getByRole("button", { name: "More for Player4" }).click();
  await expect(page.getByRole("menuitem", { name: "Refresh" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Forget" })).toBeVisible();
});

test("Teams People: the Add menu opens three panels; the Riot ID panel checks the lines and shows a result per line", async ({ page }) => {
  await open(page, "screens-teams--people-table");
  await page.getByRole("button", { name: "Add to People" }).click();
  await expect(page.getByRole("menuitem")).toHaveText(["From a friend group…", "From recent players…", "By Riot ID…"]);
  await page.getByRole("menuitem", { name: "By Riot ID…" }).click();
  const dialog = page.getByRole("dialog", { name: "Add by Riot ID" });
  const box = dialog.getByLabel(/Riot IDs, one per line/);
  const add = dialog.getByRole("button", { name: "Add & fetch" });
  await expect(add).toBeDisabled();
  await box.fill("Player20#tag20\nno-tag-here");
  await expect(dialog.getByText("Use name#tag")).toBeVisible();
  await expect(add).toBeDisabled();
  await box.fill("Player20#tag20, Player21#tag21\nPlayer99#tag99");
  await expect(add).toBeEnabled();
  await add.click();
  const results = dialog.getByRole("list", { name: "Lookup results" });
  await expect(results.locator("li")).toHaveCount(3);
  await expect(results.locator("li").nth(0)).toContainText("Found");
  await expect(results.locator("li").nth(2)).toContainText("Not found");
  await dialog.getByRole("button", { name: "Close", exact: true }).first().click();
  await expect(dialog).toHaveCount(0);
});

test("Teams People: Add from a friend group and from recent players (read only when the panel opens)", async ({ page }) => {
  await open(page, "screens-teams--people-table");
  await page.getByRole("button", { name: "Add to People" }).click();
  await page.getByRole("menuitem", { name: "From a friend group…" }).click();
  const dialog = page.getByRole("dialog", { name: "Add from a friend group" });
  await expect(dialog.getByRole("button", { name: /^Add & fetch \(15\)/ })).toBeVisible();
  await dialog.getByLabel("Friend group").selectOption({ label: "Customs (7)" });
  await expect(dialog.getByRole("button", { name: /^Add & fetch \(7\)/ })).toBeVisible();
  await dialog.getByLabel("Include me").check();
  await expect(dialog.getByRole("button", { name: /^Add & fetch \(8\)/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Add to People" }).click();
  await page.getByRole("menuitem", { name: "From recent players…" }).click();
  const recent = page.getByRole("dialog", { name: "Add from recent players" });
  await recent.getByLabel("Search recent players").fill("player2");
  await expect(recent.locator(".pick-row")).toHaveCount(5);
  await recent.getByRole("button", { name: "Select shown" }).click();
  await expect(recent.getByRole("button", { name: /^Add & fetch \(5\)/ })).toBeEnabled();
  await recent.getByRole("button", { name: "Cancel" }).click();
});

test("Teams People: the menu has Fetch all again, Export / Import preferences… and a two-click Clear all cached data", async ({ page }) => {
  await open(page, "screens-teams--people-table");
  await page.getByRole("button", { name: "People actions" }).click();
  await expect(page.getByRole("menuitem")).toHaveText(["Fetch all again", "Export preferences…", "Import preferences…", "Clear all cached data"]);
  await page.getByRole("menuitem", { name: "Clear all cached data" }).click();
  await expect(page.getByRole("menuitem", { name: "Click again to clear" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("Teams People: progress and the paused message while the client limits requests", async ({ page }) => {
  await open(page, "screens-teams--people-fetching");
  await expect(page.getByTestId("prefetch-progress")).toContainText("12 / 30");
  await expect(page.getByRole("button", { name: "Cancel" })).toBeEnabled();
  await open(page, "screens-teams--people-paused");
  await expect(page.getByText(/The League Client is limiting requests\. Resuming in \d+ s\./)).toBeVisible();
});

test("Teams People: an empty list says how people get here", async ({ page }) => {
  await open(page, "screens-teams--people-empty");
  await expect(page.getByText(/Nobody is saved yet/)).toBeVisible();
});

const prefsFile = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    kind: "lol-viewer/team-preferences",
    version: 1,
    exportedAt: "2026-11-27T15:30:00Z",
    players: [
      { riotId: "Player1#tag1", puuid: "fx-1", lock: "support", rank: "DIAMOND II" },
      { riotId: "player2#TAG2", prefer: ["top"] }, // matched by name, any case
      { riotId: "Player20#tag20", avoid: ["mid", "bottom"] }, // not saved: looked up
      { riotId: "Player99#tag99", lock: "top" }, // not found
    ],
    ...over,
  });
const importInput = (page: Page) => page.locator('input[type="file"]');

test("Teams People: Import preferences shows a confirm bar, replaces only the people in the file, and reports who was not found", async ({ page }) => {
  await open(page, "screens-app--teams-tab");
  await tabBtn(page, /^People/).click();
  // Player2 already has a preference that the file replaces; Player3 is not in the file and stays.
  await chip(page, "Player2 Jungle: not set").click();
  await chip(page, "Player2 Jungle: preferred").click();
  await chip(page, "Player2 Jungle: locked").click();
  await chip(page, "Player3 Mid: not set").click();
  await importInput(page).setInputFiles({ name: "prefs.json", mimeType: "application/json", buffer: Buffer.from(prefsFile()) });
  const bar = page.getByTestId("import-bar");
  await expect(bar).toContainText("Import 3 people? 1 will replace current preferences, 1 not found.");
  await expect(bar).toContainText("Not found: Player99#tag99");
  // Nothing changed yet.
  await expect(chip(page, "Player1 Support: not set")).toBeVisible();
  await bar.getByRole("button", { name: "Cancel" }).click();
  await expect(bar).toHaveCount(0);
  await expect(chip(page, "Player1 Support: not set")).toBeVisible();
  await importInput(page).setInputFiles({ name: "prefs.json", mimeType: "application/json", buffer: Buffer.from(prefsFile()) });
  await page.getByTestId("import-bar").getByRole("button", { name: "Import" }).click();
  await expect(chip(page, "Player1 Support: locked")).toBeVisible();
  await expect(page.getByRole("button", { name: "Player1 rank: D2" })).toHaveAttribute("data-source", "manual");
  await expect(chip(page, "Player2 Top: preferred")).toBeVisible();
  await expect(chip(page, "Player2 Jungle: not set")).toBeVisible(); // replaced, not merged
  await expect(chip(page, "Player3 Mid: preferred")).toBeVisible(); // not in the file: untouched
  await expect(page.locator(".toast")).toContainText("Imported preferences for 3 people. 1 not found: Player99#tag99");
  await expect(page.locator(".people-row")).toHaveCount(12);
});

test("Teams People: a broken or foreign file is refused with the reason", async ({ page }) => {
  await open(page, "screens-app--teams-tab");
  await tabBtn(page, /^People/).click();
  const give = (text: string) => importInput(page).setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from(text) });
  await give("{ not json");
  await expect(page.locator(".toast").last()).toContainText("not valid JSON");
  await give(JSON.stringify({ kind: "something-else", version: 1, players: [] }));
  await expect(page.locator(".toast").last()).toContainText("not a LoL Viewer team preferences file");
  await give(prefsFile({ version: 2 }));
  await expect(page.locator(".toast").last()).toContainText("unsupported version");
  await importInput(page).setInputFiles({ name: "big.json", mimeType: "application/json", buffer: Buffer.alloc(1_000_001, 32) });
  await expect(page.locator(".toast").last()).toContainText("larger than 1 MB");
  await expect(page.getByTestId("import-bar")).toHaveCount(0);
});

test("Teams People: Export preferences says how many people were saved, and has nothing to save without preferences", async ({ page }) => {
  await open(page, "screens-app--teams-tab");
  await tabBtn(page, /^People/).click();
  await page.getByRole("button", { name: "People actions" }).click();
  await page.getByRole("menuitem", { name: "Export preferences…" }).click();
  await expect(page.locator(".toast").last()).toContainText("No preferences to export yet");
  await chip(page, "Player4 Top: not set").click();
  await page.getByRole("button", { name: "People actions" }).click();
  await page.getByRole("menuitem", { name: "Export preferences…" }).click();
  await expect(page.locator(".toast").last()).toContainText("Saved preferences for 1 person.");
});

test("Teams: the browser build explains that it needs the desktop app", async ({ page }) => {
  await open(page, "screens-teams--browser");
  await expect(page.getByText("only available in the desktop app")).toBeVisible();
});
