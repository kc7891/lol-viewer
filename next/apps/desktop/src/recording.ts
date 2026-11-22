/**
 * Session recording in the desktop app (Settings → 試合を記録).
 * Writes masked scenario files that tools/fake-lcu can replay.
 */
import { app, shell } from "electron";
import { join } from "node:path";
import { startLiveClientPoller, type LcuConnector, type RawLcuEvent } from "@lol-viewer/lcu";
import { createFileRecorder, type FileRecorder } from "@lol-viewer/recorder";
import type { RecorderStatus } from "@lol-viewer/protocol";

export class RecordingController {
  #connector: LcuConnector;
  #onStatus: (s: RecorderStatus) => void;
  #file: FileRecorder | null = null;
  #lastFile: string | null = null;
  #startedAt: number | null = null;
  #live: { stop: () => void } | null = null;
  #notify: ReturnType<typeof setTimeout> | null = null;

  constructor(connector: LcuConnector, onStatus: (s: RecorderStatus) => void) {
    this.#connector = connector;
    this.#onStatus = onStatus;
  }

  get folder(): string {
    return process.env.LOL_VIEWER_RECORDINGS_DIR ?? join(app.getPath("documents"), "LoL Viewer Next", "recordings");
  }

  status(): RecorderStatus {
    return {
      recording: this.#file != null,
      file: this.#file?.path ?? this.#lastFile,
      lines: this.#file?.recorder.lines ?? 0,
      startedAt: this.#startedAt,
      folder: this.folder,
    };
  }

  /** Called for every raw LCU event; cheap no-op while not recording. */
  onLcuEvent(e: RawLcuEvent): void {
    if (!this.#file) return;
    this.#file.recorder.record(e);
    this.#scheduleNotify();
  }

  async start(): Promise<RecorderStatus> {
    if (this.#file) return this.status();
    this.#file = createFileRecorder(this.folder, { app: "lol-viewer-next", version: app.getVersion() });
    this.#startedAt = Date.now();
    // Seed with the current state so a recording started mid-champ-select is replayable.
    for (const e of await this.#connector.snapshot()) this.onLcuEvent(e);
    this.#live = startLiveClientPoller({ onData: (e) => this.onLcuEvent(e) });
    this.#onStatus(this.status());
    return this.status();
  }

  async stop(): Promise<RecorderStatus> {
    const f = this.#file;
    if (!f) return this.status();
    this.#live?.stop();
    this.#live = null;
    this.#file = null;
    this.#lastFile = f.path;
    this.#startedAt = null;
    await f.close();
    this.#onStatus(this.status());
    return this.status();
  }

  openFolder(): void {
    void shell.openPath(this.folder);
  }

  #scheduleNotify(): void {
    if (this.#notify) return;
    this.#notify = setTimeout(() => {
      this.#notify = null;
      this.#onStatus(this.status());
    }, 500);
  }
}
