import { useEffect, useMemo, useState } from "react";
import { autoViewers, defaultCooldownChampion, viewerId, type ViewerTarget } from "@lol-viewer/core";
import { SuppressViewsProvider, useMatchState } from "./bridge/context.tsx";
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
};

export function App({ initialLayout = 2, toolbarExtra, initialSettingsOpen = false }: AppProps) {
  const state = useMatchState();
  const viewers = useMemo(() => autoViewers(state), [state]);
  const [layout, setLayout] = useState<Layout>(initialLayout);
  const [selected, setSelected] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(initialSettingsOpen);
  const [cooldownPick, setCooldownPick] = useState<number | null>(null);
  const cooldownChampionId = cooldownPick ?? defaultCooldownChampion(state);

  // New match -> drop the previous selections (the auto viewers already reset).
  useEffect(() => {
    setSelected([]);
    setCooldownPick(null);
  }, [state.matchSeq]);

  const byId = new Map(viewers.map((v) => [viewerId(v), v]));
  const visibleIds = [...selected.filter((id) => byId.has(id)), ...viewers.map(viewerId)]
    .filter((id, i, a) => a.indexOf(id) === i)
    .slice(0, layout);
  const visible = visibleIds.map((id) => byId.get(id)!) as ViewerTarget[];

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [id, ...s].slice(0, layout)));

  return (
    <SuppressViewsProvider value={settingsOpen}>
      <div className="app">
        <aside className="sidebar">
          <div className="sidebar-header">Windows ({viewers.length})</div>
          <ul className="viewer-list">
            {viewers.map((v) => {
              const id = viewerId(v);
              return (
                <li key={id}>
                  <button className="viewer-item" aria-pressed={visibleIds.includes(id)} onClick={() => toggle(id)}>
                    <ChampionIcon id={v.championId} size={30} />
                    <span>
                      <div className="name">{viewerTitle(v)}</div>
                      <div className="kind">{v.kind}</div>
                    </span>
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
            <div className="empty-state">Waiting for champion select…</div>
          ) : (
            <div className="viewer-grid" style={{ gridTemplateColumns: `repeat(${visible.length}, minmax(0, 1fr))` }}>
              {visible.map((v) => (
                <ViewerPane key={viewerId(v)} target={v} />
              ))}
            </div>
          )}
        </main>
      </div>

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
