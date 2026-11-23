// Bundles main + preload with esbuild and copies the web build next to them.
import { build } from "esbuild";
import { cpSync, existsSync, rmSync } from "node:fs";

const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: true,
  logLevel: "warning",
  // koffi is a native module: it stays in node_modules (unpacked from the asar) and is required lazily on Windows only.
  external: ["electron", "bufferutil", "utf-8-validate", "koffi"],
};

rmSync("out", { recursive: true, force: true });
await build({ ...common, entryPoints: ["src/main.ts"], outfile: "out/main.cjs" });
await build({ ...common, entryPoints: ["src/preload.ts"], outfile: "out/preload.cjs" });
await build({ ...common, entryPoints: ["src/overlay-preload.ts"], outfile: "out/overlay-preload.cjs" });

const web = "../web/dist";
if (!existsSync(`${web}/index.html`)) throw new Error("run `pnpm web:build` first");
cpSync(web, "out/web", { recursive: true });
console.log("desktop build -> out/");
