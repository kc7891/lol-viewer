import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.tsx"],
  framework: { name: "@storybook/react-vite", options: {} },
  core: { disableTelemetry: true },
  // The app's production CSP plugin would block Storybook's own inline scripts.
  viteFinal: (cfg) => ({
    ...cfg,
    plugins: (cfg.plugins ?? []).flat().filter((p) => !(p && typeof p === "object" && "name" in p && p.name === "lol-viewer-csp")),
  }),
};
export default config;
