/**
 * Settings > LCU check in the real app (M-039): run the probe against the fake LCU (synthetic
 * scenario), check the report shows the steps and none of the scenario's identities, and that
 * nothing but GET reached the client.
 */
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseScenario } from "../packages/core/src/index.ts";
import { startFakeLcu, type FakeLcu } from "../tools/fake-lcu/src/server.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const lines = parseScenario(readFileSync(`${root}/scenarios/lcu-probe.jsonl`, "utf8"));
const RIOT_ID = "player-2#tag-1"; // the scenario's own Riot ID

let app: ElectronApplication;
let page: Page;
let fake: FakeLcu;

test.beforeAll(async () => {
  fake = await startFakeLcu({ lines });
  await fake.done;
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

test("LCU check runs every step against the fake client and shows no identities", async () => {
  await expect(page.locator(".conn")).toHaveAttribute("data-status", "connected", { timeout: 15_000 });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const card = page.getByRole("region", { name: "LCU check" });
  await card.getByLabel("Riot ID to look up (optional)").fill(RIOT_ID);
  await card.getByRole("button", { name: "Run check" }).click();
  await expect(card.getByRole("button", { name: "Run check" })).toBeDisabled();

  const report = card.getByLabel("LCU check report");
  await expect(report).toHaveValue(/recently-played/, { timeout: 60_000 });
  await expect(card.getByRole("button", { name: "Run check" })).toBeEnabled();
  const text = await report.inputValue();

  expect(text).toMatch(/current-summoner +200 +\d+ms/);
  expect(text).toMatch(/lobby +404 +\d+ms +not in a lobby/);
  expect(text).toMatch(/friends +200 +\d+ms.*\n.*count=2 puuid=yes gameName=yes gameTag=yes groupId=yes groupName=yes displayGroupId=no/);
  expect(text).toMatch(/ranked-stats batch json +200 .*returned=2/);
  expect(text).toMatch(/ranked-stats batch comma +404/);
  expect(text).toMatch(/matches \(self, 0-20\) +200[^\n]*\n\s+games=3 /);
  expect(text).toMatch(/game \(detail\) +200[^\n]*\n\s+participants=2 identities=2 identityHasPuuid=yes/);
  expect(text).toMatch(/summoners\?name \(self\) +200 .*puuid=match/);
  expect(text).toMatch(/summoners\?name \(input\) +200 .*hasPuuid=yes/);
  expect(text).toContain("tier:\"GOLD\"");

  // No identity from the scenario, and not the Riot ID typed in.
  for (const secret of ["player-", "tag-", RIOT_ID]) expect(text).not.toContain(secret);
  expect(text).not.toMatch(/rate test/);

  await card.getByRole("button", { name: "Copy report" }).click();
  await expect(card.getByText(/Copied\.|Press Ctrl\+C/)).toBeVisible();
  expect(fake.rejectedWrites).toEqual([]);
});
