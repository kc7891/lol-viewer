import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { join } from "node:path";
import { createMasker, type Masker } from "./mask.ts";

export type RawEvent = { uri: string; eventType: "Create" | "Update" | "Delete"; data: unknown };

export type RecorderMeta = { app: string; version: string; note?: string };

/**
 * Turns raw events into scenario lines ({"t", "uri", "eventType", "data"}),
 * masking personal data first. Output is exactly what tools/fake-lcu replays
 * and what core's parseScenario reads.
 */
export class SessionRecorder {
  readonly #write: (line: string) => void;
  readonly #now: () => number;
  readonly #mask: Masker;
  readonly #t0: number;
  #lines = 0;

  constructor(write: (line: string) => void, meta: RecorderMeta, now: () => number = Date.now) {
    this.#write = write;
    this.#now = now;
    this.#mask = createMasker();
    this.#t0 = now();
    const started = new Date(this.#t0).toISOString();
    this.#write(`// recorded by ${meta.app} ${meta.version} at ${started}; personal data masked${meta.note ? `; ${meta.note}` : ""}`);
  }

  get lines(): number {
    return this.#lines;
  }

  record(e: RawEvent): void {
    const line = { t: Math.max(0, this.#now() - this.#t0), uri: e.uri, eventType: e.eventType, data: this.#mask(e.data) };
    this.#write(JSON.stringify(line));
    this.#lines++;
  }
}

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export type FileRecorder = { recorder: SessionRecorder; path: string; close: () => Promise<void> };

/** Starts a recording file `<dir>/session-YYYYMMDD-HHMMSS.jsonl`. */
export function createFileRecorder(dir: string, meta: RecorderMeta): FileRecorder {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `session-${stamp(new Date())}.jsonl`);
  const stream: WriteStream = createWriteStream(path, { encoding: "utf8", flags: "wx" });
  const recorder = new SessionRecorder((l) => stream.write(l + "\n"), meta);
  return {
    recorder,
    path,
    close: () => new Promise<void>((resolve) => stream.end(resolve)),
  };
}
