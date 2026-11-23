import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_SETTINGS, DEFAULT_URL_TEMPLATES, UI_SCALE, parseSettings, type Settings, type UrlTemplates } from "@lol-viewer/core";

export const SETTINGS_STORAGE_KEY = "lol-viewer.settings";

/** localStorage can throw (blocked, private window) or hold garbage; either way fall back to defaults. */
export function loadSettings(): Settings {
  try {
    const text = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    return parseSettings(text ? JSON.parse(text) : null);
  } catch {
    return parseSettings(null);
  }
}

function saveSettings(s: Settings): void {
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: the setting still applies for this session */
  }
}

export type SettingsApi = {
  settings: Settings;
  /** Merge a patch (also persists when persistence is on). */
  update(patch: Partial<Settings>): void;
  setUrls(urls: UrlTemplates): void;
  resetUrls(): void;
};

const SettingsContext = createContext<SettingsApi | null>(null);

export function SettingsProvider({
  initial,
  persist = true,
  children,
}: {
  initial?: Settings;
  /** Stories pass false so they never read or write the viewer's real settings. */
  persist?: boolean;
  children: ReactNode;
}) {
  const [settings, setSettings] = useState<Settings>(() => initial ?? (persist ? loadSettings() : DEFAULT_SETTINGS));

  // M-012: the UI size applies immediately, no restart.
  useLayoutEffect(() => {
    document.documentElement.style.setProperty("--ui-scale", String(UI_SCALE[settings.uiSize]));
  }, [settings.uiSize]);

  const commit = useCallback(
    (next: Settings) => {
      setSettings(next);
      if (persist) saveSettings(next);
    },
    [persist],
  );

  const api = useMemo<SettingsApi>(
    () => ({
      settings,
      update: (patch) => commit({ ...settings, ...patch }),
      setUrls: (urls) => commit({ ...settings, urls }),
      resetUrls: () => commit({ ...settings, urls: { ...DEFAULT_URL_TEMPLATES } }),
    }),
    [settings, commit],
  );

  return <SettingsContext.Provider value={api}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsApi {
  const s = useContext(SettingsContext);
  if (!s) throw new Error("SettingsProvider missing");
  return s;
}
