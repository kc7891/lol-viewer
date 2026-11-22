import { useCallback, useEffect, useMemo, useState } from "react";
import { autoViewers, defaultCooldownChampion, viewerId, type ViewerTarget } from "@lol-viewer/core";
import { SuppressViewsProvider, useMatchState } from "./bridge/context.tsx";
import { AddViewerDialog } from "./components/AddViewerDialog.tsx";
import { ChampionIcon } from "./components/ChampionIcon.tsx";
import { ConnectionStatus } from "./components/ConnectionStatus.tsx";
import { CooldownPanel } from "./components/CooldownPanel.tsx";
import { MatchupList } from "./components/MatchupList.tsx";
import { ViewerPane, viewerTitle } from "./components/ViewerPane.tsx";
import type { ReactNode } from "react";

export type Layout = 1 | 2 | 3;

export type AppProps = {
  initialLayout?: Layout;
  /** Extra controls rendered in the toolbar (e.g. mock playback). */
  toolbarExtra?: ReactNode;
  initialSettingsOpen?: boolean;
  initialAddOpen?: boolean;
  /** Viewers opened by hand (stories / tests). */
  initialManualViewers?: ViewerTarget[];
};

export function App({
  initialLayout = 2,
  toolbarExtra,
  initialSettingsOpen = false,
  initialAddOpen = false,
  initialManualViewers = [],
}: AppProps) {
  const state = useMatchState();
  const [manual, setManual] = useState<ViewerTarget[]>(initialManualViewers);
  /** Auto viewers the user closed during this match. */
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const viewers = useMemo(() => {
    const out: ViewerTarget[] = [];
    const seen = new Set<string>();
    for (const v of [...manual, ...autoViewers(state)]) {
      const id = viewerId(v);
      if (seen.has(id) || dismissed.has(id)) continue;
      seen.add(id);
      out.push(v);
    }
    return out;
  }, [manual, state, dismissed]);
  const [layout, setLayout] = useState<Layout>(initialLayout);
  const [selected, setSelected] = useState<string[]>(() => initialManualViewers.map(viewerId));
  const [settingsOpen, setSettingsOpen] = useState(initialSettingsOpen);
  const [addOpen, setAddOpen] = useState(initialAddOpen);
  const [cooldownPick, setCooldownPick] = useState<number | null>(null);
  const cooldownChampionId = cooldownPick ?? defaultCooldownChampion(state);

  // New match -> drop the previous selections (the auto viewers already reset).
  // Manually opened viewers are kept: the user asked for them explicitly.
  useEffect(() => {
    setSelected((s) => s.filter((id) => manual.some((m) => viewerId(m) === id)));
    setDismissed(new Set());
    setCooldownPick(null);
  }, [state.matchSeq]);

  const addViewer = useCallback((t: ViewerTarget) => {
    const id = viewerId(t);
    setManual((m) => [t, ...m.filter((x) => viewerId(x) !== id)]);
    setDismissed((d) => {
      const n = new Set(d);
      n.delete(id);
      return n;
    });
    setSelected((s) => [id, ...s.filter((x) => x !== id)]);
    setAddOpen(false);
  }, []);

  const closeViewer = (id: string) => {
    setSelected((s) => s.filter((x) => x !== id));
    if (manual.some((m) => viewerId(m) === id)) setManual((m) => m.filter((x) => viewerId(x) !== id));
    else setDismissed((d) => new Set(d).add(id));
  };

  const byId = new Map(viewers.map((v) => [viewerId(v), v]));
  const visibleIds = [...selected.filter((id) => byId.has(id)), ...viewers.map(viewerId)]
    .filter((id, i, a) => a.indexOf(id) === i)
    .slice(0, layout);
  const visible = visibleIds.map((id) => byId.get(id)!) as ViewerTarget[];

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [id, ...s].slice(0, layout)));

  return (
    <SuppressViewsProvider value={settingsOpen || addOpen}>
      <div className="app">
        <aside className="sidebar">
          <div className="sidebar-header">
            <span>Windows ({viewers.length})</span>
            <button type="button" className="icon-btn" aria-label="Add window" title="ウィンドウを開く" onClick={() => setAddOpen(true)}>
              +
            </button>
          </div>
          <ul className="viewer-list">
            {viewers.map((v) => {
              const id = viewerId(v);
              return (
                <li key={id} className="viewer-li">
                  <button className="viewer-item" aria-pressed={visibleIds.includes(id)} onClick={() => toggle(id)}>
                    <ChampionIcon id={v.championId} size={30} />
                    <span>
                      <div className="name">{viewerTitle(v)}</div>
                      <div className="kind">{v.kind}</div>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="viewer-close"
                    aria-label={`Close ${viewerTitle(v)} ${v.kind}`}
                    title="閉じる"
                    onClick={() => closeViewer(id)}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
          <ConnectionStatus status={state.connection} />
        </aside>

        <main className="main">
          <div className="top-area">
            <MatchupList state={state} selectedChampionId={cooldownChampionId} onSelectChampion={setCooldownPick} />
            <CooldownPanel championId={cooldownChampionId} />
          </div>
          <div className="toolbar">
            <div className="seg" role="group" aria-label="Layout">
              {([1, 2, 3] as const).map((n) => (
                <button key={n} aria-pressed={layout === n} onClick={() => setLayout(n)}>
                  {n} pane{n > 1 ? "s" : ""}
                </button>
              ))}
            </div>
            <span className="phase">Phase: {state.phase}</span>
            <span className="spacer" />
            {toolbarExtra}
            <button className="btn" onClick={() => setSettingsOpen(true)}>
              Settings
            </button>
          </div>
          {visible.length === 0 ? (
            <div className="empty-state">
              <div>Waiting for champion select…</div>
              <button type="button" className="btn" onClick={() => setAddOpen(true)}>
                ＋ ウィンドウを開く
              </button>
            </div>
          ) : (
            <div className="viewer-grid" style={{ gridTemplateColumns: `repeat(${visible.length}, minmax(0, 1fr))` }}>
              {visible.map((v) => (
                <ViewerPane key={viewerId(v)} target={v} />
              ))}
            </div>
          )}
        </main>
      </div>

      {addOpen && <AddViewerDialog onAdd={addViewer} onClose={() => setAddOpen(false)} defaultLane={state.self?.lane} />}

      {settingsOpen && (
        <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <div className="modal" role="dialog" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Settings</h3>
            <p style={{ color: "var(--muted-foreground)" }}>
              While this dialog is open, native external views are hidden so the HTML overlay stays visible.
            </p>
            <button className="btn" onClick={() => setSettingsOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </SuppressViewsProvider>
  );
}
