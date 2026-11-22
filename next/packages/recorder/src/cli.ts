/**
 * Usage (on the PC running League of Legends):
 *   pnpm record [--out <dir>]
 * Records League Client events (personal data masked) until Ctrl+C.
 * The app has the same feature under Settings → 試合を記録.
 */
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { startLcuConnector, startLiveClientPoller } from "@lol-viewer/lcu";
import { createFileRecorder } from "./recorder.ts";

const { values } = parseArgs({ options: { out: { type: "string", default: "recordings" } } });
const file = createFileRecorder(resolve(values.out!), { app: "lol-viewer-next-cli", version: "0" });
console.log(`[record] writing ${file.path}`);
console.log("[record] waiting for the League Client… (Ctrl+C to stop)");

const conn = startLcuConnector({
  onEvent: (e) => file.recorder.record(e),
  onStatus: (s) => console.log(`[record] League Client: ${s}`),
});
const live = startLiveClientPoller({ onData: (e) => file.recorder.record(e) });
const progress = setInterval(() => process.stdout.write(`\r[record] ${file.recorder.lines} events`), 1000);

process.on("SIGINT", async () => {
  clearInterval(progress);
  live.stop();
  conn.stop();
  await file.close();
  console.log(`\n[record] saved ${file.path}`);
  process.exit(0);
});
