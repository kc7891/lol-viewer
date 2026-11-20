import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "storybook.spec.ts",
  outputDir: "../test-results/storybook",
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:6007",
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    trace: "off",
  },
  webServer: {
    command: "tsx e2e/serve-static.ts apps/web/storybook-static 6007",
    cwd: "..",
    url: "http://127.0.0.1:6007/index.json",
    reuseExistingServer: true,
  },
});
