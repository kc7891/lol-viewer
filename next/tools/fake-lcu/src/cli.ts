/**
 * Usage: pnpm fake-lcu [scenario.jsonl] [--speed 2] [--port 0] [--manual]
 * Prints the lockfile path; point the app at it with LOL_LCU_LOCKFILE=<path>.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { startFakeLcu, type ScenarioLine } from "./server.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    speed: { type: "string", default: "1" },
    port: { type: "string", default: "0" },
    manual: { type: "boolean", default: false },
  },
});

const file = resolve(positionals[0] ?? new URL("../../../scenarios/ranked-two-matches.jsonl", import.meta.url).pathname);
const lines = (await readFile(file, "utf8"))
  .split("\n")
  .filter((l) => l.trim() && !l.startsWith("//"))
  .map((l) => JSON.parse(l) as ScenarioLine);

const fake = await startFakeLcu({
  lines,
  speed: Number(values.speed),
  port: Number(values.port),
  autoplay: !values.manual,
  log: (m) => console.log(`[fake-lcu] ${m}`),
});
console.log(`[fake-lcu] listening on 127.0.0.1:${fake.port}`);
console.log(`[fake-lcu] LOL_LCU_LOCKFILE=${fake.lockfilePath}`);
await fake.done;
console.log("[fake-lcu] scenario finished (server stays up; Ctrl+C to quit)");
