import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /electron(-[a-z-]+)?\.spec\.ts/,
  outputDir: "../test-results/electron",
  reporter: [["list"]],
  timeout: 120_000,
  workers: 1,
  use: { trace: "off" },
});
