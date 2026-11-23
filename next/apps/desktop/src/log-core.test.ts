import { describe, expect, it } from "vitest";
import { formatArgs, formatLine, formatTimestamp, isDebugMode, logFileName, rendererLevel, selectStaleLogs } from "./log-core.ts";

const d = new Date(2026, 10, 2, 3, 4, 5, 7); // local time: 2026-11-02 03:04:05.007

describe("log-core", () => {
  it("formats timestamps, lines and file names", () => {
    expect(formatTimestamp(d)).toBe("2026-11-02 03:04:05.007");
    expect(formatLine(d, "WARN", "lcu", "hello")).toBe("2026-11-02 03:04:05.007 WARN [lcu] hello");
    expect(logFileName(d)).toBe("lol-viewer-20261102-030405.log");
  });

  it("selects only the oldest of our logs beyond keep", () => {
    const names = ["lol-viewer-20260101-000000.log", "other.log", "lol-viewer-20260301-000000.log", "lol-viewer-20260201-000000.log", "lol-viewer-x.log"];
    expect(selectStaleLogs(names, 2)).toEqual(["lol-viewer-20260101-000000.log"]);
    expect(selectStaleLogs(names, 0)).toHaveLength(3);
    expect(selectStaleLogs(names, 10)).toEqual([]);
  });

  it("detects debug mode", () => {
    const exe = "/opt/LoL Viewer/lol-viewer.exe";
    expect(isDebugMode([], {}, exe)).toBe(false);
    expect(isDebugMode(["x", "--debug"], {}, exe)).toBe(true);
    expect(isDebugMode([], { LOL_VIEWER_DEBUG: "1" }, exe)).toBe(true);
    expect(isDebugMode([], { LOL_VIEWER_DEBUG: "0" }, exe)).toBe(false);
    expect(isDebugMode([], {}, "C:\\app\\LoL-Viewer-Debug.exe")).toBe(true);
    expect(isDebugMode([], {}, "/home/debugger/app/lol-viewer")).toBe(false); // only the file name counts
  });

  it("formats console arguments", () => {
    expect(formatArgs(["a", 1, { x: 2 }])).toBe('a 1 {"x":2}');
    expect(formatArgs([new Error("boom")])).toContain("boom");
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    expect(formatArgs([cyc])).toBe("[object Object]");
  });

  it("maps renderer levels", () => {
    expect([0, 1, 2, 3].map(rendererLevel)).toEqual(["DEBUG", "INFO", "WARN", "ERROR"]);
  });
});
