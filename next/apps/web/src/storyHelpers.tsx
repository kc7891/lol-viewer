import type { ReactNode } from "react";
import type { LolViewerBridge, MatchState } from "@lol-viewer/protocol";
import { DEFAULT_SETTINGS, type Settings } from "@lol-viewer/core";
import { BridgeProvider, ViewStatusProvider } from "./bridge/context.tsx";
import { staticBridge, type StaticBridgeOptions } from "./bridge/mock.ts";
import { SettingsProvider } from "./state/settings.tsx";

/** Providers every story needs: a bridge pinned to one MatchState and non-persistent settings. */
export function Harness({
  match,
  settings = DEFAULT_SETTINGS,
  bridge,
  bridgeOptions,
  height = "100vh",
  width,
  children,
}: {
  match: MatchState;
  settings?: Settings;
  bridge?: LolViewerBridge;
  bridgeOptions?: StaticBridgeOptions;
  height?: string | number;
  width?: string | number;
  children: ReactNode;
}) {
  return (
    <BridgeProvider bridge={bridge ?? staticBridge(match, bridgeOptions)}>
      <ViewStatusProvider>
        <SettingsProvider initial={settings} persist={false}>
          <div style={{ height, width, display: "flex", flexDirection: "column" }}>{children}</div>
        </SettingsProvider>
      </ViewStatusProvider>
    </BridgeProvider>
  );
}
