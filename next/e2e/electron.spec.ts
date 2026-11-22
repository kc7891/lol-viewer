/**
 * Drives the real Electron app against the fake LCU (no League Client, no Windows).
 *
 * Verifies, with the new UI, that several native WebContentsViews side by side
 * track the DOM slots of the viewer panes through auto-open, adding viewers,
 * window resizes, in-pane panels, other pages and a new match (M-001). Saves a
 * full-window screenshot (renderer + native views) when the platform has a
 * screen grabber, and records memory per view count.
 */
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getChampion, scenarioEvents, reduceAll } from "../packages/core/src/index.ts";
import { startFakeLcu, type FakeLcu, type ScenarioLine } from "../tools/fake-lcu/src/server.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const shots = fileURLToPath(new URL("./screenshots/electron/", import.meta.url));
mkdirSync(shots, { recursive: true });

const lines = readFileSync(`${root}/scenarios/ranked-two-matches.jsonl`, "utf8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as ScenarioLine);

type Bounds = { x: number; y: number; width: number; height: number };
type ViewInfo = { viewId: string; url: string; attached: boolean; visible: boolean; bounds: Bounds };

let app: ElectronApplication;
let page: Page;
let fake: FakeLcu;

const views = () => app.evaluate(() => (globalThis as any).__lolViewer.views.describe() as ViewInfo[]);
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

/** Rectangles of the slots that are laid out (the Live Game slot is display:none on the Viewers page). */
async function slotRects(): Promise<Record<string, Bounds>> {
  return page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>("[data-view-id]")]
        .map((el) => [el.dataset.viewId!, el.getBoundingClientRect()] as const)
        .filter(([, r]) => r.width > 0 && r.height > 0)
        .map(([id, r]) => [id, { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }]),
    ),
  );
}

/** `count` native views are on screen, each exactly on its slot, side by side. */
async function expectViewsMatchSlots(count: number) {
  await expect.poll(async () => (await shown()).length, { timeout: 10_000 }).toBe(count);
  const sorted = (o: Record<string, Bounds>) => JSON.stringify(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  await expect
    .poll(async () => sorted(Object.fromEntries((await shown()).map((v) => [v.viewId, v.bounds]))) === sorted(await slotRects()), { timeout: 8_000 })
    .toBe(true);
  const rects = Object.values(await slotRects()).sort((a, b) => a.x - b.x);
  for (let i = 1; i < rects.length; i++) {
    expect(rects[i]!.y).toBe(rects[0]!.y);
    expect(rects[i]!.x).toBeGreaterThanOrEqual(rects[i - 1]!.x + rects[i - 1]!.width);
  }
}

const panes = () => page.locator(".viewer-pane");
const rowNames = () => page.locator(".viewers .row .name");
const viewerIds = () => page.locator(".viewers .row").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.viewerId));

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

test("native external views follow the viewer panes through a whole session", async () => {
  const memory: Record<string, number> = {};
  await expect(page.locator(".conn")).toHaveAttribute("data-status", "connected", { timeout: 15_000 });
  await expect(page.locator(".conn")).toHaveText("Connected");
  await expect(page.getByText("No viewers yet")).toBeVisible();
  memory["0 views"] = await memoryMB();

  // ---- my pick opens the picked viewer at the left edge --------------------------------
  const endOfChampSelect1 = lines.find((l) => l.uri === "/lol-champ-select/v1/session" && l.data === null)!.t;
  const upTo = lines.filter((l) => l.t < endOfChampSelect1);
  const m1 = reduceAll(scenarioEvents(upTo as never)).match;
  const me = m1.self!;
  const mine = getChampion(me.championId)!;
  fake.advanceTo(endOfChampSelect1 - 1);
  await expect(rowNames().first()).toHaveText(mine.name, { timeout: 15_000 });
  await expect(page.locator(".pending .row")).toHaveCount(m1.enemies.length);
  await expectViewsMatchSlots(await panes().count());
  const first = (await shown()).sort((a, b) => a.bounds.x - b.bounds.x)[0]!;
  expect(first.url).toBe(`https://lolalytics.com/lol/${mine.slug}/build/${me.lane ? `?lane=${me.lane}` : ""}`);
  // the leftmost pane is the picked viewer (build)
  await expect(panes().first()).toHaveAttribute("data-mode", "build");
  const pickedCount = await panes().count();
  memory[`${pickedCount} view(s) (picked)`] = await memoryMB();

  // ---- enemy picks: + opens a Counter viewer, widths split equally -----------------------
  const enemy = getChampion(m1.enemies[0]!)!;
  const enemyRow = page.locator(`.pending .row[data-pending-id="${enemy.id}"]`);
  await expect(enemyRow).toBeVisible();
  await enemyRow.getByRole("button", { name: `Open Counter for ${enemy.name}` }).click();
  const n2 = pickedCount + 1;
  await expect(panes()).toHaveCount(n2);
  await expectViewsMatchSlots(n2);
  const widths = Object.values(await slotRects()).map((r) => r.width);
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(2);
  expect((await shown()).some((v) => v.url === `https://lolalytics.com/lol/${enemy.slug}/counters/`)).toBe(true);

  // a third viewer: still equal
  const enemy2 = getChampion(m1.enemies[1]!)!;
  await page.locator(`.pending .row[data-pending-id="${enemy2.id}"]`).getByRole("button", { name: `Open Counter for ${enemy2.name}` }).click();
  await expect(panes()).toHaveCount(n2 + 1);
  await expectViewsMatchSlots(n2 + 1);
  const total = n2 + 1;
  const widths3 = Object.values(await slotRects()).map((r) => r.width);
  expect(Math.max(...widths3) - Math.min(...widths3)).toBeLessThanOrEqual(2);
  memory[`${total} views (just attached)`] = await memoryMB();

  // ---- window resize: the views follow ---------------------------------------------------
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1280, 760));
  await expectViewsMatchSlots(total);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1600, 900));
  await expectViewsMatchSlots(total);

  // pages need a moment to paint, then grab the whole screen
  await page.waitForTimeout(4000);
  memory[`${total} views (pages loaded)`] = await memoryMB();
  memory["webContents (app + views)"] = await app.evaluate(({ webContents }) => webContents.getAllWebContents().length);
  grabScreen("viewers");

  // ---- an in-pane panel hides only that pane's native view -------------------------------
  const pane = panes().nth(1);
  const paneId = await pane.getAttribute("data-pane-id");
  await pane.getByRole("button", { name: "Champion", exact: true }).click();
  await expect(pane.getByRole("region", { name: "Select champion" })).toBeVisible();
  await expect.poll(async () => (await shown()).length).toBe(total - 1);
  const hiddenOnes = (await views()).filter((v) => v.attached && !v.visible && v.viewId === `viewer-${paneId}`);
  expect(hiddenOnes).toHaveLength(1);
  grabScreen("panel-open");
  await pane.getByRole("button", { name: "Champion", exact: true }).click();
  await expectViewsMatchSlots(total);

  // ---- hide / show / close / close all ---------------------------------------------------
  const rows = page.locator(".viewers .row");
  const secondName = (await rowNames().nth(1).textContent())!;
  await rows.nth(1).hover();
  await rows.nth(1).getByRole("button", { name: `Hide ${secondName}` }).click();
  await expectViewsMatchSlots(total - 1);
  await rows.nth(1).hover();
  await rows.nth(1).getByRole("button", { name: `Show ${secondName}` }).click();
  await expectViewsMatchSlots(total);
  await rows.nth(1).hover();
  await rows.nth(1).getByRole("button", { name: `Close ${secondName}` }).click();
  await expect(panes()).toHaveCount(total - 1);
  await expectViewsMatchSlots(total - 1);

  // ---- Live Game page: its view shows, the viewers' views hide ---------------------------
  const idsBeforeLive = await viewerIds();
  await page.getByRole("button", { name: "Live Game", exact: true }).click();
  await expect.poll(async () => (await shown()).map((v) => v.viewId)).toEqual(["live-game"]);
  await expectViewsMatchSlots(1);
  grabScreen("live-game");
  await page.getByRole("button", { name: "Viewers", exact: true }).click();
  await expectViewsMatchSlots(total - 1);
  expect((await shown()).some((v) => v.viewId === "live-game")).toBe(false);

  // ---- second match (M-001): every viewer closes, the new pick opens ----------------------
  fake.advanceTo(Infinity);
  await expect.poll(async () => (await viewerIds()).some((id) => idsBeforeLive.includes(id))).toBe(false);
  const mine2 = getChampion(reduceAll(scenarioEvents(lines as never)).match.self?.championId);
  if (mine2) await expect(rowNames().first()).toHaveText(mine2.name, { timeout: 20_000 });
  await expectViewsMatchSlots(await panes().count());
  expect((await shown()).every((v) => !idsBeforeLive.includes(v.viewId.replace("viewer-", "")))).toBe(true);
  grabScreen("second-match");

  // ---- close all ---------------------------------------------------------------------------
  await page.getByRole("button", { name: "Close all viewers" }).click();
  await expect.poll(async () => (await shown()).length).toBe(0);
  await expect(page.getByText("No viewers yet")).toBeVisible();

  // the app never tried to write to the League Client
  expect(fake.rejectedWrites).toEqual([]);

  writeFileSync(`${shots}memory.json`, JSON.stringify(memory, null, 2));
  test.info().annotations.push({ type: "memory (MB, all processes)", description: JSON.stringify(memory) });
  console.log("memory MB:", memory);
});
