/**
 * Main-process logging. Always mirrors to the console; writes a file under app.getPath("logs")
 * only in debug mode (see isDebugMode). NEVER pass LCU tokens/passwords to these functions.
 */
import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { formatArgs, formatLine, isDebugMode, logFileName, rendererLevel, selectStaleLogs, type LogLevel } from "./log-core.ts";

const KEEP = 10;
let file: string | null = null;

export const debugEnabled = (): boolean => isDebugMode(process.argv, process.env, process.execPath);

/** Call once at startup (before app ready is fine). Creates the log file in debug mode and prunes old ones. */
export function initLogging(): void {
  if (!debugEnabled()) return;
  try {
    const dir = app.getPath("logs");
    mkdirSync(dir, { recursive: true });
    for (const n of selectStaleLogs(readdirSync(dir), KEEP - 1)) {
      try {
        unlinkSync(join(dir, n));
      } catch {
        /* ignore */
      }
    }
    file = join(dir, logFileName(new Date()));
  } catch (e) {
    console.warn("[log] cannot set up log file", e);
  }
}

export const logFilePath = (): string | null => file;

function write(level: LogLevel, scope: string, message: string): void {
  const line = formatLine(new Date(), level, scope, message);
  (level === "ERROR" ? console.error : level === "WARN" ? console.warn : console.log)(line);
  if (!file) return;
  try {
    appendFileSync(file, line + "\n");
  } catch {
    file = null; // give up silently; console still works
  }
}

export const log = {
  debug: (scope: string, ...a: unknown[]) => write("DEBUG", scope, formatArgs(a)),
  info: (scope: string, ...a: unknown[]) => write("INFO", scope, formatArgs(a)),
  warn: (scope: string, ...a: unknown[]) => write("WARN", scope, formatArgs(a)),
  error: (scope: string, ...a: unknown[]) => write("ERROR", scope, formatArgs(a)),
};

/** Uncaught errors always reach the console; they reach the file only in debug mode (via write). */
export function installProcessHandlers(): void {
  process.on("uncaughtException", (e) => log.error("main", "uncaughtException", e));
  process.on("unhandledRejection", (e) => log.error("main", "unhandledRejection", e));
}

/** Debug mode only: write renderer console output to the file (the console already shows it in dev). */
export function attachRendererLogging(contents: Electron.WebContents, scope = "renderer"): void {
  if (!debugEnabled()) return;
  contents.on("console-message", (details) => {
    // Electron 35+: single details object
    const d = details as unknown as { level: string | number; message: string; lineNumber: number; sourceId: string };
    const lv = typeof d.level === "number" ? d.level : ({ debug: 0, info: 1, warning: 2, error: 3 } as Record<string, number>)[d.level] ?? 1;
    write(rendererLevel(lv), scope, `${d.message} (${d.sourceId}:${d.lineNumber})`);
  });
}
