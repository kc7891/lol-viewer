import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { LolViewerBridge } from "@lol-viewer/protocol";
import { App } from "./App.tsx";
import { BridgeProvider } from "./bridge/context.tsx";
import { createHubBridge } from "./bridge/hub.ts";
import { createMockBridge, type MockPlayer } from "./bridge/mock.ts";
import { MockBar } from "./MockBar.tsx";
import "./styles.css";

/**
 * Bridge selection:
 *  - Electron: preload injected window.lolViewer
 *  - ?hub=ws://127.0.0.1:PORT/api/stream?token=…  -> live Hub (phone / 2nd screen)
 *  - otherwise: scenario mock (dev server, PR preview)
 */
function pickBridge(): { bridge: LolViewerBridge; mock?: MockPlayer } {
  if (window.lolViewer) return { bridge: window.lolViewer };
  const hub = new URLSearchParams(location.search).get("hub");
  if (hub) return { bridge: createHubBridge(hub) };
  const mock = createMockBridge();
  if (new URLSearchParams(location.search).has("autoplay")) mock.play(10);
  return { bridge: mock, mock };
}

const { bridge, mock } = pickBridge();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BridgeProvider bridge={bridge}>
      <App toolbarExtra={mock ? <MockBar player={mock} /> : undefined} />
    </BridgeProvider>
  </StrictMode>,
);
