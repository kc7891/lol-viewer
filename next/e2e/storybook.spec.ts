/**
 * Renders every story in a real Chromium on Linux and saves a screenshot to
 * e2e/screenshots/storybook/<story-id>.png (uploaded as a CI artifact, and
 * readable by an AI agent to check the UI with its own eyes).
 */
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const shotDir = fileURLToPath(new URL("./screenshots/storybook/", import.meta.url));

type Index = { entries: Record<string, { id: string; type: string; title: string; name: string }> };
const index = JSON.parse(readFileSync(new URL("../apps/web/storybook-static/index.json", import.meta.url), "utf8")) as Index;
const stories = Object.values(index.entries).filter((e) => e.type === "story");

test("storybook has stories", () => {
  expect(stories.length).toBeGreaterThan(10);
});

for (const story of stories) {
  test(`${story.title} / ${story.name}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && !m.text().includes("ddragon") && errors.push(m.text()));

    await page.goto(`/iframe.html?id=${story.id}&viewMode=story`);
    await page.locator("#storybook-root > *").first().waitFor();
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${shotDir}${story.id}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
}

test("App: complete champ select shows all 10 champions and 2 panes", async ({ page }) => {
  await page.goto("/iframe.html?id=screens-app--champ-select-complete&viewMode=story");
  const rows = page.locator(".matchup-row");
  await expect(rows).toHaveCount(5);
  await expect(page.locator(".matchup-row .side .label:not(.empty)")).toHaveCount(10);
  await expect(page.locator(".viewer-pane")).toHaveCount(2);
  await expect(page.locator('.matchup-row[data-lane="middle"] .self-badge')).toBeVisible();
});

test("App: second match resets the previous picks", async ({ page }) => {
  await page.goto("/iframe.html?id=screens-app--second-match-resets&viewMode=story");
  await expect(page.locator(".matchup-row .side .label:not(.empty)")).toHaveCount(2);
  const names = await page.locator(".viewer-item .name").allTextContents();
  expect(names).toEqual(["Aatrox", "Aatrox vs Darius", "Darius"]);
});

test("App: cooldowns default to my lane opponent and follow clicks", async ({ page }) => {
  await page.goto("/iframe.html?id=screens-app--champ-select-complete&viewMode=story");
  const panel = page.getByRole("region", { name: "Cooldowns" });
  await expect(panel.locator(".cooldowns-champ")).toContainText("Zed"); // Ahri (me, mid) vs Zed
  await expect(panel.locator("tr")).toHaveCount(4);

  await page.locator('.matchup-row[data-lane="top"] button.side.enemy').click(); // Garen
  await expect(panel.locator(".cooldowns-champ")).toContainText("Garen");
  await expect(page.locator('.matchup-row[data-lane="top"] button.side.enemy')).toHaveAttribute("aria-pressed", "true");
});

test("CooldownPanel: numbers per rank, dash when Data Dragon has none", async ({ page }) => {
  await page.goto("/iframe.html?id=components-cooldownpanel--ahri&viewMode=story");
  await expect(page.locator('tr[data-spell="W"] .spell-cd')).toHaveText("9 / 8 / 7 / 6 / 5 s");
  await expect(page.locator('tr[data-spell="R"] .spell-cd')).toHaveText("140 / 120 / 100 s");
  await page.goto("/iframe.html?id=components-cooldownpanel--gangplank&viewMode=story");
  await expect(page.locator('tr[data-spell="E"] .spell-cd')).toHaveText("—");
});
