import { useState, type Dispatch } from "react";
import {
  getChampion,
  opponentSuggestions,
  quickPicks,
  viewerUrl,
  type Viewer,
  type ViewerMode,
  type Workspace,
  type WorkspaceAction,
} from "@lol-viewer/core";
import type { Lane, ViewCommand } from "@lol-viewer/protocol";
import { useBridge, useViewStatus } from "../bridge/context.tsx";
import { IconBack, IconChevron, IconClose, IconExternal, IconForward, IconQr, IconRefresh } from "../ui/icons.tsx";
import { LANE_LABEL, MODES, MODE_LABEL } from "../ui/labels.ts";
import { ChampionIcon } from "./ChampionIcon.tsx";
import { ChampionPanel } from "./ChampionPanel.tsx";
import { ExternalViewSlot } from "./ExternalViewSlot.tsx";
import { LanePanel } from "./LanePanel.tsx";
import { QrPanel } from "./QrPanel.tsx";
import type { ToastKind } from "../state/toasts.tsx";

export type PanelKind = "champion" | "opponent" | "lane" | "qr";

export type ViewerPaneProps = {
  viewer: Viewer;
  ws: Workspace;
  dispatch: Dispatch<WorkspaceAction>;
  templates: Parameters<typeof viewerUrl>[1];
  /** Settings: show the QR button. */
  qrEnabled: boolean;
  /** Flash outline after the sidebar scrolls here. */
  highlighted?: boolean;
  notify: (text: string, kind?: ToastKind) => void;
  /** Stories: open with a panel already showing. */
  initialPanel?: PanelKind | null;
};

export const viewIdOf = (viewer: Pick<Viewer, "id">) => `viewer-${viewer.id}`;

export function copyText(text: string, notify: ViewerPaneProps["notify"]): void {
  const done = () => notify("Copied to clipboard", "success");
  const fail = () => notify("Could not copy. Select the address and copy it manually.", "warn");
  try {
    void navigator.clipboard.writeText(text).then(done, fail);
  } catch {
    fail();
  }
}

export function ViewerPane({ viewer, ws, dispatch, templates, qrEnabled, highlighted, notify, initialPanel = null }: ViewerPaneProps) {
  const bridge = useBridge();
  const viewId = viewIdOf(viewer);
  const status = useViewStatus(viewId);
  const [panel, setPanel] = useState<PanelKind | null>(initialPanel);

  const champ = getChampion(viewer.championId);
  const opp = getChampion(viewer.opponentId);
  const url = viewerUrl(viewer, templates);
  const currentUrl = status?.url || url;
  const aram = viewer.mode === "aram";
  const effective: PanelKind | null = panel ?? (champ ? null : "champion");
  const close = () => setPanel(null);
  const toggle = (k: PanelKind) => setPanel((p) => (p === k ? null : k));

  const navigate = (action: "back" | "forward" | "reload" | "openExternal") => {
    const cmd: ViewCommand = { type: "navigate", viewId, action };
    bridge.views?.command(cmd);
  };
  const openExternal = () => {
    if (bridge.views) navigate("openExternal");
    else if (currentUrl) window.open(currentUrl, "_blank", "noopener,noreferrer");
  };

  const picks = quickPicks(ws, viewer);
  const set = (a: WorkspaceAction) => dispatch(a);
  const pickChampion = (id: number | null) => {
    if (id != null) set({ type: "setChampion", id: viewer.id, championId: id });
    close();
  };
  const pickOpponent = (id: number | null) => {
    set({ type: "setOpponent", id: viewer.id, opponentId: id });
    close();
  };
  const pickLane = (lane: Lane | null) => {
    set({ type: "setLane", id: viewer.id, lane });
    close();
  };

  return (
    <article
      className="viewer-pane"
      aria-label={champ ? `${champ.name} viewer` : "New viewer"}
      data-pane-id={viewer.id}
      data-highlight={highlighted ? "true" : undefined}
      data-mode={viewer.mode}
    >
      <header className="pane-head">
        <div className="pane-row">
          <button
            type="button"
            className="select-btn"
            aria-label="Champion"
            aria-expanded={effective === "champion"}
            data-active={effective === "champion"}
            onClick={() => toggle("champion")}
          >
            <ChampionIcon id={viewer.championId} size={22} />
            <span className={champ ? "label" : "label placeholder"}>{champ ? champ.name : "Select champion"}</span>
            <IconChevron size={12} />
          </button>
          <span className="vs">vs</span>
          <button
            type="button"
            className="select-btn"
            aria-label="Opponent"
            aria-expanded={effective === "opponent"}
            data-active={effective === "opponent"}
            disabled={aram}
            onClick={() => toggle("opponent")}
          >
            {opp && <ChampionIcon id={opp.id} size={22} />}
            <span className={opp ? "label" : "label placeholder"}>{opp ? opp.name : "Opponent"}</span>
            <IconChevron size={12} />
          </button>
          <span className="spacer" />
          <button
            type="button"
            className="icon-btn"
            aria-label="Close viewer"
            title="Close viewer"
            onClick={() => set({ type: "closeViewer", id: viewer.id })}
          >
            <IconClose />
          </button>
        </div>
        {picks.length > 0 && (
          <div className="pane-row quick-row">
            <span className="quick-label">Quick pick</span>
            <div className="quick-picks" role="group" aria-label="Quick opponents">
              {picks.map((id) => {
                const c = getChampion(id);
                return (
                  <button
                    key={id}
                    type="button"
                    className="quick-pick"
                    title={`Set ${c?.name ?? "?"} as opponent`}
                    aria-label={`Set ${c?.name ?? "?"} as opponent`}
                    disabled={aram}
                    onClick={() => pickOpponent(id)}
                  >
                    <ChampionIcon id={id} size={22} />
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="pane-row">
          <div className="seg" role="group" aria-label="Page type">
            {MODES.map((m: ViewerMode) => (
              <button key={m} type="button" aria-pressed={viewer.mode === m} onClick={() => set({ type: "setMode", id: viewer.id, mode: m })}>
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="select-btn lane"
            aria-label="Lane"
            aria-expanded={effective === "lane"}
            data-active={effective === "lane"}
            disabled={aram}
            onClick={() => toggle("lane")}
          >
            <span className={viewer.lane ? "label" : "label placeholder"}>{viewer.lane ? LANE_LABEL[viewer.lane] : "Any lane"}</span>
            <IconChevron size={12} />
          </button>
          <div className="nav-group">
          <button type="button" className="icon-btn" aria-label="Back" title="Back" disabled={!status?.canGoBack} onClick={() => navigate("back")}>
            <IconBack />
          </button>
          <button type="button" className="icon-btn" aria-label="Forward" title="Forward" disabled={!status?.canGoForward} onClick={() => navigate("forward")}>
            <IconForward />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Reopen page"
            title="Reopen the page"
            disabled={!champ}
            onClick={() => set({ type: "reopen", id: viewer.id })}
          >
            <IconRefresh />
          </button>
          {qrEnabled && (
            <button
              type="button"
              className="icon-btn text"
              aria-label="QR"
              title="Show a QR code of this page"
              aria-pressed={effective === "qr"}
              disabled={!currentUrl}
              onClick={() => toggle("qr")}
            >
              <IconQr />
              <span>QR</span>
            </button>
          )}
          <button type="button" className="icon-btn" aria-label="Open in browser" title="Open in your default browser" disabled={!currentUrl} onClick={openExternal}>
            <IconExternal />
          </button>
          </div>
        </div>
        {status?.status === "loading" && <div className="loading-bar" role="progressbar" aria-label="Loading" />}
      </header>

      <div className="pane-body">
        {url ? (
          <ExternalViewSlot viewId={viewId} url={url} nav={viewer.nav} active={effective == null} />
        ) : (
          <div className="pane-empty">Choose a champion to open its page.</div>
        )}
        {effective === "champion" && <ChampionPanel title="Select champion" value={viewer.championId} onPick={pickChampion} onClose={close} />}
        {effective === "opponent" && (
          <ChampionPanel
            title="Select opponent"
            value={viewer.opponentId}
            allowNone
            suggested={opponentSuggestions(ws, viewer)}
            onPick={pickOpponent}
            onClose={close}
          />
        )}
        {effective === "lane" && <LanePanel value={viewer.lane} onPick={pickLane} onClose={close} />}
        {effective === "qr" && currentUrl && <QrPanel url={currentUrl} onCopy={(u) => copyText(u, notify)} onClose={close} />}
      </div>
    </article>
  );
}
