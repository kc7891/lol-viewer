/**
 * Settings → 試合を記録 in the real app: record a session from the fake LCU
 * (with real-looking identities), then check the file replays to the same
 * match and contains no personal data.
 */
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseScenario, reduceAll, scenarioEvents } from "../packages/core/src/index.ts";
import { findUnmaskedPii } from "../packages/recorder/src/mask.ts";
import { startFakeLcu, type FakeLcu, type ScenarioLine } from "../tools/fake-lcu/src/server.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = readFileSync(`${root}/scenarios/ranked-two-matches.jsonl`, "utf8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as ScenarioLine);

const withIdentities = source.map((l) => {
  if (l.uri !== "/lol-champ-select/v1/session" || !l.data) return l;
  const d = structuredClone(l.data) as { myTeam: Record<string, unknown>[] };
  d.myTeam.forEach((p, i) => Object.assign(p, { puuid: `secret-puuid-${i}`, gameName: `SecretName${i}`, tagLine: "JP1" }));
  return { ...l, data: d };
});

let app: ElectronApplication;
let page: Page;
let fake: FakeLcu;
const recordings = mkdtempSync(join(tmpdir(), "lv-recordings-"));

test.beforeAll(async () => {
  fake = await startFakeLcu({ lines: withIdentities, autoplay: false });
  const exe = process.env.LOL_VIEWER_EXE;
  const sandboxArgs = process.platform === "linux" ? ["--no-sandbox"] : [];
  app = await electron.launch({
    ...(exe ? { executablePath: exe, args: sandboxArgs } : { args: [...sandboxArgs, `${root}/apps/desktop`] }),
    env: {
      ...process.env,
      LOL_LCU_LOCKFILE: fake.lockfilePath,
      LOL_LIVE_CLIENT_URL: `http://127.0.0.1:${fake.port}`,
      LOL_VIEWER_RECORDINGS_DIR: recordings,
      LOL_VIEWER_E2E: "1",
    },
  });
  page = await app.firstWindow();
});

test.afterAll(async () => {
  await app?.close();
  await fake?.close();
});

test("records a session from Settings, masked and replayable", async () => {
  await expect(page.getByRole("status").first()).toHaveText("Riot API: Connected", { timeout: 15_000 });

  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("button", { name: "記録を開始" }).click();
  await expect(settings.getByText(/記録中/)).toBeVisible();

  // Play both matches step by step while recording.
  for (const l of withIdentities) {
    fake.advanceTo(l.t);
    await page.waitForTimeout(10);
  }
  await expect(settings.getByText(/記録中.*件/)).toContainText(/[1-9]\d* 件/, { timeout: 10_000 });
  await page.waitForTimeout(500);

  await settings.getByRole("button", { name: "記録を停止" }).click();
  await expect(settings.getByText(/保存しました/)).toBeVisible();

  const files = readdirSync(recordings).filter((f) => f.endsWith(".jsonl"));
  expect(files).toHaveLength(1);
  const text = readFileSync(join(recordings, files[0]!), "utf8");
  expect(text.split("\n")[0]).toMatch(/^\/\/ recorded by lol-viewer-next .*personal data masked/);
  for (const secret of ["secret-puuid", "SecretName", "JP1"]) expect(text).not.toContain(secret);

  const replayed = parseScenario(text);
  expect(replayed.flatMap((l) => findUnmaskedPii(l.data))).toEqual([]);
  const want = reduceAll(scenarioEvents(parseScenario(source.map((l) => JSON.stringify(l)).join("\n"))));
  const got = reduceAll(scenarioEvents(replayed));
  expect(got.matchSeq).toBe(want.matchSeq);
  expect(got.self).toEqual(want.self);
  expect(got.matchups).toEqual(want.matchups);
  expect(fake.rejectedWrites).toEqual([]);
});
