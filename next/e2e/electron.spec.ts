/**
 * Drives the real Electron app against the fake LCU (no League Client, no Windows).
 *
 * Verifies the riskiest PoC question: several native WebContentsViews side by
 * side, tracking the DOM slots through layout changes, resizes, overlays and a
 * new match. Saves a full-window screenshot (renderer + native views) when the
 * platform has a screen grabber, and records memory per view count.
 */
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startFakeLcu, type FakeLcu, type ScenarioLine } from "../tools/fake-lcu/src/server.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const shots = fileURLToPath(new URL("./screenshots/electron/", import.meta.url));
mkdirSync(shots, { recursive: true });

const lines = readFileSync(`${root}/scenarios/ranked-two-matches.jsonl`, "utf8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as ScenarioLine);

type ViewInfo = { viewId: string; url: string; attached: boolean; visible: boolean; bounds: { x: number; y: number; width: number; height: number } };

let app: ElectronApplication;
let page: Page;
let fake: FakeLcu;

const views = () =>
  app.evaluate(() => (globalThis as any).__lolViewer.views.describe() as ViewInfo[]);
const shown = async () => (await views()).filter((v) => v.attached && v.visible);
const memoryMB = () =>
  app.evaluate(({ app }) => Math.round(app.getAppMetrics().reduce((n, m) => n + m.memory.workingSetSize, 0) / 1024));

/** Native views are not part of page.screenshot(); grab the whole screen instead (best effort). */
function grabScreen(name: string) {
  const file = `${shots}${name}.png`;
  try {
    if (process.platform === "linux") execFileSync("import", ["-window", "root", file]);
    if (process.platform === "win32") {
      const ps = [
        "Add-Type -AssemblyName System.Windows.Forms,System.Drawing",
        "$b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds",
        "$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height",
        "$g=[System.Drawing.Graphics]::FromImage($bmp)",
        "$g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size)",
        `$bmp.Save('${file.replaceAll("'", "''")}')`,
      ].join("; ");
      execFileSync("powershell", ["-NoProfile", "-Command", ps]);
    }
  } catch {
    /* no screen grabber available: skip */
  }
}

async function slotRects(): Promise<Record<string, ViewInfo["bounds"]>> {
  return page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>("[data-view-id]")].map((el) => {
        const r = el.getBoundingClientRect();
        return [el.dataset.viewId!, { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }];
      }),
    ),
  );
}

async function expectViewsMatchSlots(count: number) {
  await expect.poll(async () => (await shown()).length, { timeout: 10_000 }).toBe(count);
  const rects = await slotRects();
  await expect
    .poll(async () => Object.fromEntries((await shown()).map((v) => [v.viewId, v.bounds])), { timeout: 5_000 })
    .toEqual(rects);
  // side by side: same top, strictly increasing x, no overlap
  const sorted = Object.values(rects).sort((a, b) => a.x - b.x);
  for (let i = 1; i < sorted.length; i++) {
    expect(sorted[i]!.y).toBe(sorted[0]!.y);
    expect(sorted[i]!.x).toBeGreaterThanOrEqual(sorted[i - 1]!.x + sorted[i - 1]!.width);
  }
}

test.beforeAll(async () => {
  fake = await startFakeLcu({ lines, autoplay: false });
  // LOL_VIEWER_EXE=<packaged executable> tests the built app (asar) instead of the dev tree.
  const exe = process.env.LOL_VIEWER_EXE;
  const sandboxArgs = process.platform === "linux" ? ["--no-sandbox"] : [];
  app = await electron.launch({
    ...(exe ? { executablePath: exe, args: sandboxArgs } : { args: [...sandboxArgs, `${root}/apps/desktop`] }),
    env: { ...process.env, LOL_LCU_LOCKFILE: fake.lockfilePath, LOL_VIEWER_E2E: "1" },
  });
  page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
});

test.afterAll(async () => {
  await app?.close();
  await fake?.close();
});

test("multiple native external views follow the layout through a whole session", async () => {
  const memory: Record<string, number> = {};
  await expect(page.getByRole("status")).toHaveText("Riot API: Connected", { timeout: 15_000 });
  memory["0 views"] = await memoryMB();

  // Manual window before any champion select: dialog hides native views, then one view opens.
  await page.getByRole("button", { name: "Add window" }).click();
  await page.getByRole("dialog", { name: "Add window" }).getByLabel("Champion", { exact: true }).fill("ahri");
  await page.getByRole("dialog", { name: "Add window" }).getByLabel("Champion", { exact: true }).press("Enter");
  await page.getByRole("button", { name: "開く", exact: true }).click();
  await expectViewsMatchSlots(1);
  expect((await shown())[0]!.url).toBe("https://lolalytics.com/lol/ahri/build/");
  await page.locator(".viewer-li").first().hover();
  await page.getByRole("button", { name: "Close Ahri build" }).click();
  await expect.poll(async () => (await shown()).length).toBe(0);

  // Step the scenario to the end of match 1 (deterministic, no timers).
  const endOfMatch1 = lines.find((l) => l.data === "EndOfGame")!.t;
  fake.advanceTo(endOfMatch1);
  await expect(page.locator(".viewer-item")).toHaveCount(7, { timeout: 15_000 });

  // 2 panes (default) -> 2 native views side by side
  await expectViewsMatchSlots(2);
  memory["2 views (just attached)"] = await memoryMB();

  // 3 panes
  await page.getByRole("button", { name: "3 panes" }).click();
  await expectViewsMatchSlots(3);
  for (const v of await shown()) expect(v.url).toMatch(/^https:\/\/lolalytics\.com\//);

  // window resize -> views follow their slots
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1280, 760));
  await expectViewsMatchSlots(3);

  // give the third-party pages a moment to paint, then grab the whole screen
  await page.waitForTimeout(4000);
  memory["3 views (pages loaded)"] = await memoryMB();
  memory["webContents (app + views)"] = await app.evaluate(({ webContents }) => webContents.getAllWebContents().length);
  grabScreen("three-panes");

  // HTML overlay -> every native view hides; closing restores them
  await page.getByRole("button", { name: "Settings" }).click();
  await expect.poll(async () => (await shown()).length).toBe(0);
  grabScreen("settings-overlay");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expectViewsMatchSlots(3);

  // back to 1 pane -> 2 views detached (kept in cache, not visible)
  await page.getByRole("button", { name: "1 pane" }).click();
  await expectViewsMatchSlots(1);

  // second match: previous match views disappear, new champion's views appear
  fake.advanceTo(Infinity);
  await expect(page.locator(".viewer-item .name").first()).toHaveText("Aatrox", { timeout: 20_000 });
  await expectViewsMatchSlots(1);
  expect((await shown())[0]!.url).toBe("https://lolalytics.com/lol/aatrox/build/");

  // the app never tried to write to the League Client
  expect(fake.rejectedWrites).toEqual([]);

  writeFileSync(`${shots}memory.json`, JSON.stringify(memory, null, 2));
  test.info().annotations.push({ type: "memory (MB, all processes)", description: JSON.stringify(memory) });
  console.log("memory MB:", memory);
});
