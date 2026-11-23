import { useCallback, useMemo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { canAddViewer, defaultCooldownChampion, isFeatureOn, liveGameUrl, MAX_VIEWERS, type Side, type UrlTemplateKey, type UrlTemplates, type Workspace } from "@lol-viewer/core";
import { SuppressViews, useBridge, useMatchState, useUpdateStatus } from "./bridge/context.tsx";
import { CooldownPanel } from "./components/CooldownPanel.tsx";
import { LivePage } from "./components/LivePage.tsx";
import { MatchupSection } from "./components/MatchupSection.tsx";
import { PaneStrip } from "./components/PaneStrip.tsx";
import { SettingsPage } from "./components/SettingsPage.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { Toasts } from "./components/Toasts.tsx";
import { TopBar, type Page } from "./components/TopBar.tsx";
import type { PanelKind } from "./components/ViewerPane.tsx";
import { ViewersSection } from "./components/ViewersSection.tsx";
import { useSettings } from "./state/settings.tsx";
import { useToasts, type Toast } from "./state/toasts.tsx";
import { useWorkspace } from "./state/workspace.ts";

export type AppProps = {
  /** Extra controls in the top bar (e.g. mock playback). */
  toolbarExtra?: ReactNode;
  /** Red dot on Settings. */
  updateAvailable?: boolean;
  // Stories and tests only:
  initialWorkspace?: Workspace;
  initialPage?: Page;
  initialToasts?: Toast[];
  /** Stories keep toasts on screen; the app lets them fade. */
  autoDismissToasts?: boolean;
  initialPanels?: Record<number, PanelKind>;
  initialLiveQr?: boolean;
  urlsInitialDraft?: UrlTemplates;
  urlsInitialErrors?: UrlTemplateKey[];
};

export function App({
  toolbarExtra,
  updateAvailable,
  initialWorkspace: initialWs,
  initialPage = "viewers",
  initialToasts,
  autoDismissToasts = true,
  initialPanels,
  initialLiveQr,
  urlsInitialDraft,
  urlsInitialErrors,
}: AppProps) {
  const bridge = useBridge();
  const rawMatch = useMatchState();
  const { settings, update } = useSettings();
  const liveOn = isFeatureOn(settings, "liveClientData");
  // M-025: with the flag off the app behaves as before, whatever the bridge sends.
  const match = useMemo(() => (liveOn || rawMatch.live == null ? rawMatch : { ...rawMatch, live: null }), [rawMatch, liveOn]);
  useEffect(() => {
    bridge.live?.setEnabled(liveOn);
  }, [bridge, liveOn]);
  const updateStatus = useUpdateStatus();
  const updateDot = updateAvailable ?? (updateStatus?.state === "available" || updateStatus?.state === "downloaded");
  const [ws, dispatch] = useWorkspace(match, initialWs);
  const { toasts, push: notify, dismiss } = useToasts(initialToasts, autoDismissToasts);

  const [page, setPage] = useState<Page>(initialPage);
  const [focusLcu, setFocusLcu] = useState(0);
  const [liveNav, setLiveNav] = useState(0);

  // Sidebar width: live while dragging, saved on release.
  const [sbWidth, setSbWidth] = useState(settings.sidebarWidth);
  const [sbDrag, setSbDrag] = useState(false);

  // Cooldowns follow the matchup click; a new match goes back to the default.
  const [cooldownPick, setCooldownPick] = useState<number | null>(null);
  const matchSeq = ws.last?.matchSeq;
  useEffect(() => setCooldownPick(null), [matchSeq]);
  const cooldownChampion = cooldownPick ?? defaultCooldownChampion(ws);

  // Sidebar click / new viewer: scroll the pane into view and flash it.
  const [focus, setFocus] = useState<{ id: number; n: number } | null>(null);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const focusN = useRef(0);
  const focusViewer = useCallback((id: number) => setFocus({ id, n: ++focusN.current }), []);
  useLayoutEffect(() => {
    if (!focus) return;
    document.querySelector(`[data-pane-id="${focus.id}"]`)?.scrollIntoView({ inline: "nearest", block: "nearest" });
    setHighlightId(focus.id);
    const t = setTimeout(() => setHighlightId(null), 1400);
    return () => clearTimeout(t);
  }, [focus]);

  const limitReached = () => {
    notify(`Viewer limit reached (${MAX_VIEWERS}). Close one first.`, "warn");
  };
  const add = () => {
    if (!canAddViewer(ws)) return limitReached();
    dispatch({ type: "addViewer" });
    focusViewer(ws.nextId);
  };
  const openRow = (index: number) => {
    if (!canAddViewer(ws)) return limitReached();
    dispatch({ type: "openRow", index });
    focusViewer(ws.nextId);
  };
  const openPending = (championId: number) => {
    if (!canAddViewer(ws)) return limitReached();
    dispatch({ type: "openPending", championId });
    focusViewer(ws.nextId);
  };
  const refresh = () => {
    dispatch({ type: "refreshMatchup" });
    bridge.lcu?.resync();
    notify("Matchup refreshed.");
  };

  const goSettings = () => {
    setPage("settings");
    setFocusLcu((n) => n + 1);
  };

  return (
    <div className="app">
      <TopBar
        page={page}
        onPage={setPage}
        connection={match.connection}
        phase={match.phase}
        updateAvailable={updateDot}
        onConnectionClick={goSettings}
        extra={toolbarExtra}
      />
      <div className="pages">
        <SuppressViews when={page !== "viewers" || sbDrag}>
          <div className="page viewers-page" hidden={page !== "viewers"}>
            <Sidebar
              width={sbWidth}
              onWidth={setSbWidth}
              onCommitWidth={(w) => update({ sidebarWidth: w })}
              onDragging={setSbDrag}
              footer={<Toasts toasts={toasts} onDismiss={dismiss} />}
            >
              <MatchupSection
                ws={ws}
                selectedChampionId={cooldownChampion}
                onSelectChampion={setCooldownPick}
                onSwap={(side: Side, from, to) => dispatch({ type: "swapRows", side, from, to })}
                onOpenRow={openRow}
                onRefresh={refresh}
              />
              <CooldownPanel championId={cooldownChampion} />
              <ViewersSection
                ws={ws}
                onAdd={add}
                onCloseAll={() => dispatch({ type: "closeAll" })}
                onClose={(id) => dispatch({ type: "closeViewer", id })}
                onToggleHidden={(id) => dispatch({ type: "toggleHidden", id })}
                onFocus={focusViewer}
                onOpenPending={openPending}
                onRemovePending={(championId) => dispatch({ type: "removePending", championId })}
              />
            </Sidebar>
            <main className="main">
              <PaneStrip
                ws={ws}
                dispatch={dispatch}
                templates={settings.urls}
                qrEnabled={settings.qrButton}
                highlightId={highlightId}
                notify={notify}
                initialPanels={initialPanels}
                onAdd={add}
              />
            </main>
          </div>
        </SuppressViews>

        <LivePage
          url={liveGameUrl(settings.urls)}
          nav={liveNav}
          active={page === "live"}
          qrEnabled={settings.qrButton}
          notify={notify}
          initialQr={initialLiveQr}
        />

        <div className="page settings-wrap" hidden={page !== "settings"}>
          <SettingsPage
            connection={match.connection}
            ws={ws}
            dispatch={dispatch}
            notify={notify}
            onUrlsSaved={() => setLiveNav((n) => n + 1)}
            focusLcu={focusLcu}
            urlsInitialDraft={urlsInitialDraft}
            urlsInitialErrors={urlsInitialErrors}
          />
        </div>
      </div>
      {page === "settings" && toasts.length > 0 && <div className="toasts-floating"><Toasts toasts={toasts} onDismiss={dismiss} /></div>}
    </div>
  );
}
