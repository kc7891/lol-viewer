/**
 * Key source for the in-game overlay (M-034, 🔴): reads ONLY the Tab key state and looks at the
 * foreground window (class name and bounds). Windows only: koffi is required lazily, so Linux (and
 * a Windows run with the flag off) never loads it. No hooks, no registration: the game still gets Tab.
 *
 *   LOL_OVERLAY_FAKE_KEYS=<file>  tests only: the file holds `tab` or `none`; the game is always in front.
 */
import { readFileSync } from "node:fs";
import type { KeySource, Rect } from "./overlay-core.ts";

/** Window class of the League of Legends game client (to be confirmed on a real PC, design §11). */
export const GAME_WINDOW_CLASS = "RiotWindowClass";
const VK_TAB = 0x09;

export function fakeKeySource(file: string): KeySource {
  return {
    isTabDown: () => {
      try {
        return readFileSync(file, "utf8").trim() === "tab";
      } catch {
        return false;
      }
    },
    isGameForeground: () => true,
  };
}

function win32KeySource(): KeySource {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const koffi = require("koffi") as typeof import("koffi");
  const user32 = koffi.load("user32.dll");
  const GetAsyncKeyState = user32.func("short __stdcall GetAsyncKeyState(int vKey)");
  const GetForegroundWindow = user32.func("void* __stdcall GetForegroundWindow()");
  const GetClassNameW = user32.func("int __stdcall GetClassNameW(void* hWnd, _Out_ uint16_t* buf, int max)");
  const GetWindowRect = user32.func("int __stdcall GetWindowRect(void* hWnd, _Out_ int32_t* rect)");

  const foreground = (): unknown => GetForegroundWindow();
  return {
    isTabDown: () => (GetAsyncKeyState(VK_TAB) & 0x8000) !== 0,
    isGameForeground: () => {
      const hwnd = foreground();
      if (!hwnd) return false;
      const buf = new Uint16Array(256);
      const n = GetClassNameW(hwnd, buf, buf.length) as number;
      return n > 0 && String.fromCharCode(...buf.subarray(0, n)) === GAME_WINDOW_CLASS;
    },
    gameRect: (): Rect | null => {
      const hwnd = foreground();
      if (!hwnd) return null;
      const r = new Int32Array(4); // left, top, right, bottom
      if (!GetWindowRect(hwnd, r)) return null;
      const width = r[2]! - r[0]!;
      const height = r[3]! - r[1]!;
      return width > 0 && height > 0 ? { x: r[0]!, y: r[1]!, width, height } : null;
    },
  };
}

/** The key source for this OS, or null where there is none. Throws when koffi cannot be loaded (the caller logs it). */
export function createKeySource(): KeySource | null {
  const fake = process.env.LOL_OVERLAY_FAKE_KEYS;
  if (fake) return fakeKeySource(fake);
  if (process.platform !== "win32") return null;
  return win32KeySource();
}
