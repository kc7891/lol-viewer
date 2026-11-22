/**
 * Update flow against an INSTALLED app (Windows CI only; see e2e/windows/update-flow.ps1). Skipped unless LV_UPDATE_E2E is set.
 *   LV_UPDATE_E2E=update   the installed old version finds the new one on LOL_VIEWER_UPDATE_URL, downloads it and
 *                          clicks "Restart and update". The app quits; the installer then starts the new version.
 *   LV_UPDATE_E2E=verify   launches the installed app again and checks Settings > Version shows LV_EXPECT_VERSION.
 * Updates are off under LOL_VIEWER_E2E=1, so the "update" phase runs without it.
 */
import { _electron as electron, expect, test } from "@playwright/test";

const phase = process.env.LV_UPDATE_E2E;
const exe = process.env.LOL_VIEWER_EXE;
test.skip(!phase || !exe, "LV_UPDATE_E2E and LOL_VIEWER_EXE are set only by the Windows update job");
test.setTimeout(240_000);
const sandboxArgs = process.platform === "linux" ? ["--no-sandbox"] : [];

test("update: check, download, restart and update", async () => {
  test.skip(phase !== "update");
  const feed = process.env.LOL_VIEWER_UPDATE_URL;
  expect(feed, "LOL_VIEWER_UPDATE_URL").toBeTruthy();
  const env = { ...process.env } as Record<string, string>;
  delete env.LOL_VIEWER_E2E;
  delete env.LOL_VIEWER_DISABLE_UPDATES;
  const app = await electron.launch({ executablePath: exe!, args: sandboxArgs, env });
  const proc = app.process();
  const exited = new Promise<void>((r) => proc.once("exit", () => r()));
  const page = await app.firstWindow();
  await page.getByRole("button", { name: "Settings", exact: true }).click();

  await expect(page.getByTestId("version")).toContainText(process.env.LV_OLD_VERSION ?? "");
  // The startup check runs a few seconds after launch; a manual click is the fallback if it already finished.
  const status = page.getByTestId("update-status");
  await expect(status).toHaveText("A new version is available.", { timeout: 40_000 });
  await expect(page.getByTestId("latest-version")).toHaveText(process.env.LV_NEW_VERSION ?? /.+/);
  await expect(page.getByRole("img", { name: "Update available" })).toBeVisible();

  await page.getByRole("button", { name: "Download" }).click();
  await expect(status).toHaveText("Ready to install. The app restarts.", { timeout: 120_000 });
  await page.getByRole("button", { name: "Restart and update" }).click();
  await exited; // quitAndInstall: the app exits, the silent installer replaces it and starts the new version
});

test("verify: the installed app now reports the new version", async () => {
  test.skip(phase !== "verify");
  const want = process.env.LV_EXPECT_VERSION;
  expect(want, "LV_EXPECT_VERSION").toBeTruthy();
  const app = await electron.launch({ executablePath: exe!, args: sandboxArgs, env: { ...process.env, LOL_VIEWER_E2E: "1" } as Record<string, string> });
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByTestId("version")).toContainText(`${want} (win32)`);
    await expect(page.getByTestId("update-status")).toHaveText("Update checks are off in this build.");
  } finally {
    await app.close();
  }
});
