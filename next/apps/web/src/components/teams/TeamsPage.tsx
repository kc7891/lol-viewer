import { useCallback, useEffect, useMemo, useState } from "react";
import { effectiveRank, rankLabel, type BalancePlayer, type BalanceView } from "@lol-viewer/core";
import { useBridge } from "../../bridge/context.tsx";
import { useSettings } from "../../state/settings.tsx";
import { useTeamsState } from "../../state/teams.ts";
import type { ToastKind } from "../../state/toasts.tsx";
import { balancePlayerOf, candidatesOf, lanesOf, membershipOf, withPref, type Membership } from "./model.ts";
import type { PrefPatch } from "./PlayerPrefs.tsx";
import { PlayerRow } from "./PlayerRow.tsx";
import { PrefetchPanel, type PrefetchTab } from "./PrefetchPanel.tsx";
import { ProposalPanel, type PersonInfo } from "./ProposalPanel.tsx";

/** Stories and tests only: start the page in a given state. */
export type TeamsPageInitial = {
  prefetchOpen?: boolean;
  tab?: PrefetchTab;
  moved?: Record<string, Membership>;
  extras?: string[];
  prefsOpen?: string;
  savedOpen?: string;
  riotIds?: string;
  view?: BalanceView;
};

export type TeamsPageProps = {
  notify: (text: string, kind?: ToastKind) => void;
  initial?: TeamsPageInitial;
};

/** Teams (M-038): who plays, manual settings, proposals, Copy for Discord, and the prefetch panel. */
export function TeamsPage({ notify, initial }: TeamsPageProps) {
  const api = useBridge().teams;
  const state = useTeamsState(api);
  const { settings, update } = useSettings();
  const prefs = settings.teamPlayers;

  // Who plays and who sits out is only for this lobby, so it is not saved.
  const [moved, setMoved] = useState<Record<string, Membership>>(initial?.moved ?? {});
  const [extras, setExtras] = useState<string[]>(initial?.extras ?? []);
  const [prefsOpen, setPrefsOpen] = useState<string | null>(initial?.prefsOpen ?? null);
  const [tab, setTab] = useState<PrefetchTab>(initial?.tab ?? "friends");
  const [prefetchOpen, setPrefetchOpen] = useState<boolean | null>(initial?.prefetchOpen ?? null);

  const lobby = state?.lobby ?? null;
  const players = state?.players;
  // Leaving the lobby drops the lobby-derived choices (the people added by hand stay).
  useEffect(() => {
    if (lobby === null) setMoved((m) => (Object.keys(m).length ? Object.fromEntries(Object.entries(m).filter(([id]) => extras.includes(id))) : m));
  }, [lobby, extras]);

  const now = useMemo(() => Date.now(), [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const candidates = useMemo(() => candidatesOf(lobby, extras.filter((id) => players?.[id])), [lobby, extras, players]);
  const inList = useMemo(() => candidates.filter((c) => membershipOf(c, moved) === "in"), [candidates, moved]);
  const bench = useMemo(() => candidates.filter((c) => membershipOf(c, moved) === "out"), [candidates, moved]);

  const balancePlayers: BalancePlayer[] = useMemo(
    () => inList.map((c) => balancePlayerOf(c.puuid, players?.[c.puuid], prefs[c.puuid], now)),
    [inList, players, prefs, now],
  );
  const info = useMemo(() => {
    const out: Record<string, PersonInfo> = {};
    for (const c of inList) {
      const p = players?.[c.puuid];
      const eff = effectiveRank(p, prefs[c.puuid], now);
      out[c.puuid] = {
        name: { gameName: p?.gameName || "?", tagLine: p?.tagLine ?? "" },
        rank: { label: eff ? rankLabel(eff.points, eff.source) : "—", points: eff?.points ?? null, source: eff?.source },
        main: lanesOf(p, prefs[c.puuid]).mains[0] ?? null,
      };
    }
    return out;
  }, [inList, players, prefs, now]);

  const setPref = useCallback((puuid: string, patch: PrefPatch) => update({ teamPlayers: withPref(settings.teamPlayers, puuid, patch) }), [settings.teamPlayers, update]);
  const move = (puuid: string, to: Membership) => setMoved((m) => ({ ...m, [puuid]: to }));
  const add = (puuid: string) => {
    setExtras((e) => (e.includes(puuid) ? e : [...e, puuid]));
    setMoved((m) => ({ ...m, [puuid]: "in" }));
    notify("Added to Players.", "success");
  };
  const removeExtra = (puuid: string) => {
    setExtras((e) => e.filter((x) => x !== puuid));
    setPrefsOpen((o) => (o === puuid ? null : o));
  };
  const forget = (puuid: string) => {
    api?.forget(puuid);
    removeExtra(puuid);
  };

  if (!api) {
    return (
      <div className="teams-page">
        <div className="teams-inner">
          <section className="card" aria-label="Teams">
            <h2>Teams</h2>
            <p className="desc muted">Teams reads the League Client, so it is only available in the desktop app.</p>
          </section>
        </div>
      </div>
    );
  }
  if (!state) {
    return (
      <div className="teams-page">
        <div className="teams-inner">
          <p className="muted" role="status">
            Loading…
          </p>
        </div>
      </div>
    );
  }

  const fetching = new Set(state.fetching);
  const listed = new Set(candidates.map((c) => c.puuid));
  const row = (c: (typeof candidates)[number], side: Membership) => (
    <PlayerRow
      key={c.puuid}
      puuid={c.puuid}
      player={players?.[c.puuid]}
      pref={prefs[c.puuid]}
      origin={c.origin}
      side={side}
      fetching={fetching.has(c.puuid)}
      now={now}
      open={prefsOpen === c.puuid}
      onMove={() => move(c.puuid, side === "in" ? "out" : "in")}
      onToggleOpen={() => setPrefsOpen(prefsOpen === c.puuid ? null : c.puuid)}
      onPref={(patch) => setPref(c.puuid, patch)}
      onRemove={c.origin === "added" ? () => removeExtra(c.puuid) : undefined}
    />
  );

  return (
    <div className="teams-page">
      <div className="teams-inner">
        <PrefetchPanel
          api={api}
          state={state}
          now={now}
          open={prefetchOpen ?? lobby === null}
          onToggle={() => setPrefetchOpen(!(prefetchOpen ?? lobby === null))}
          tab={tab}
          onTab={setTab}
          prefs={prefs}
          onPref={setPref}
          lastGroupId={settings.teams.lastGroupId}
          onGroup={(id) => update({ teams: { ...settings.teams, lastGroupId: id } })}
          listed={listed}
          onAdd={add}
          onForget={forget}
          notify={notify}
          initialRiotIds={initial?.riotIds}
          initialSavedOpen={initial?.savedOpen}
        />
        <div className="teams-grid">
          <div className="teams-left">
            <p className="lobby-line" data-testid="lobby-line">
              {lobby ? `Custom lobby · ${candidates.filter((c) => c.origin !== "added").length} people` : "Not in a custom lobby. Add people from Prefetch › Saved, or enter a custom lobby."}
            </p>
            <section className="card team-list" aria-label="Players">
              <h2>Players ({inList.length})</h2>
              {inList.length === 0 ? <p className="muted">Nobody yet.</p> : <ul>{inList.map((c) => row(c, "in"))}</ul>}
            </section>
            <section className="card team-list" aria-label="Bench">
              <h2>Bench ({bench.length})</h2>
              {bench.length === 0 ? <p className="muted">Nobody on the bench.</p> : <ul>{bench.map((c) => row(c, "out"))}</ul>}
            </section>
          </div>
          <ProposalPanel players={balancePlayers} info={info} notify={notify} initialView={initial?.view} />
        </div>
      </div>
    </div>
  );
}
