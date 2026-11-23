/** Pure helpers for file logging (no Electron imports, unit-tested). */

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** `YYYY-MM-DD HH:mm:ss.SSS` in local time. */
export function formatTimestamp(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  );
}

/** `YYYY-MM-DD HH:mm:ss.SSS LEVEL [scope] message`. Newlines in the message are kept as continuation lines. */
export function formatLine(d: Date, level: LogLevel, scope: string, message: string): string {
  return `${formatTimestamp(d)} ${level} [${scope}] ${message}`;
}

export const LOG_PREFIX = "lol-viewer-";
export const LOG_EXT = ".log";

/** `lol-viewer-YYYYMMDD-HHMMSS.log` (local time). */
export function logFileName(d: Date): string {
  return (
    `${LOG_PREFIX}${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${LOG_EXT}`
  );
}

const LOG_NAME = /^lol-viewer-\d{8}-\d{6}\.log$/;

/** Names of our log files that should be deleted so that only the newest `keep` remain. Other files are never touched. */
export function selectStaleLogs(names: readonly string[], keep: number): string[] {
  const ours = names.filter((n) => LOG_NAME.test(n)).sort(); // timestamp in name => lexical order = chronological
  return ours.slice(0, Math.max(0, ours.length - Math.max(0, keep)));
}

/** Debug mode: `--debug`, LOL_VIEWER_DEBUG=1, or an executable name containing "debug" (legacy convention). */
export function isDebugMode(argv: readonly string[], env: Record<string, string | undefined>, execPath: string): boolean {
  if (argv.includes("--debug")) return true;
  if (env.LOL_VIEWER_DEBUG === "1") return true;
  const base = execPath.split(/[\\/]/).pop() ?? "";
  return base.toLowerCase().includes("debug");
}

/** Renders console.* style arguments as one string (Errors with stack, objects as JSON). */
export function formatArgs(args: readonly unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      if (a instanceof Error) return a.stack ?? `${a.name}: ${a.message}`;
      try {
        return JSON.stringify(a) ?? String(a);
      } catch {
        return String(a);
      }
    })
    .join(" ");
}

/** Maps Chromium console-message level (0 verbose,1 info,2 warning,3 error) to a LogLevel. */
export function rendererLevel(level: number): LogLevel {
  return level >= 3 ? "ERROR" : level === 2 ? "WARN" : level === 0 ? "DEBUG" : "INFO";
}
