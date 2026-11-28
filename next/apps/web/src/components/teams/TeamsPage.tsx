import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyPrefsImport, applyRoster, missingPeopleText, type BalanceView, type SavedMatchup, type SavedRoster, type TeamPlayerPref } from "@lol-viewer/core";
import { useBridge } from "../../bridge/context.tsx";
import { useSettings } from "../../state/settings.tsx";
import { useTeamsState } from "../../state/teams.ts";
import type { ToastKind } from "../../state/toasts.tsx";
import type { AddMode } from "./AddPeoplePanel.tsx";
import { MatchView } from "./MatchView.tsx";
import { MatchupsView } from "./MatchupsView.tsx";
import { candidatesOf, sortCandidates, withPrefValue, type ImportPlan, type LoadedRoster, type Membership, type SavedOpen } from "./model.ts";
import { PeopleView, type PeopleFilter, type PeopleSort } from "./PeopleView.tsx";

export type TeamsSubPage = "match" | "people" | "matchups";

/** Stories and tests only: start the page in a given state. */
export type TeamsPageInitial = {
  page?: TeamsSubPage;
  moved?: Record<string, Membership>;
  extras?: string[];
  priority?: BalanceView;
  preview?: boolean;
  addPeopleOpen?: boolean;
  rankOpen?: string;
  filter?: PeopleFilter;
  sort?: PeopleSort;
  query?: string;
  detailsOpen?: string;
  addMode?: AddMode;
  riotIds?: string;
  menuOpen?: boolean;
  importPlan?: ImportPlan;
  /** Match: the Rosters menu open, or its Save / Manage dialog; with `rosterEditing` the manage row of that roster is in rename. */
  rosters?: "menu" | "save" | "manage";
  rosterEditing?: string;
  saveMatchupOpen?: boolean;
  /** Open this saved matchup in Match once the page has its state (as Open in Match does). */
  openMatchupId?: string;
  /** Matchups: the card menu of this matchup open. */
  matchupMenuId?: string;
  matchupQuery?: string;
};

export type TeamsPageProps = {
  notify: (text: string, kind?: ToastKind) => void;
  initial?: TeamsPageInitial;
  /** False while another page is shown (the page stays mounted): nothing is requested from the League Client then. Default true. */
  visible?: boolean;
};

const LEGEND = "★ prefer · 🔒 lock · ✕ avoid · underline = from match history";

/** Teams (M-038, reworked in M-040): Match (who plays, the proposals) and People (everybody saved, preferences, fetching, the preferences file). */
export function TeamsPage({ notify, initial, visible = true }: TeamsPageProps) {
  const api = useBridge().teams;
  const state = useTeamsState(api);
  const { settings, update } = useSettings();
  const prefs = settings.teamPlayers;
  const [page, setPage] = useState<TeamsSubPage>(initial?.page ?? "match");

  // Who plays and who sits out is only for this lobby, so it is not saved.
  const [moved, setMoved] = useState<Record<string, Membership>>(initial?.moved ?? {});
  const [extras, setExtras] = useState<string[]>(initial?.extras ?? []);

  // People whose choice a loaded roster / Open in Match made: it stays when the lobby goes away (M-042, design 2.2).
  const [kept, setKept] = useState<string[]>([]);
  const [loaded, setLoaded] = useState<{ id: string; applied: string[] } | null>(null);
  const [openedRaw, setOpened] = useState<SavedOpen | null>(null);
  const clearOpened = useCallback(() => setOpened(null), []);
  const token = useRef(0);

  const lobby = state?.lobby ?? null;
  const players = state?.players;
  // Leaving the lobby drops the lobby-derived choices; the people added by hand and the ones a loaded roster placed stay.
  useEffect(() => {
    if (lobby === null) setMoved((m) => (Object.keys(m).length ? Object.fromEntries(Object.entries(m).filter(([id]) => extras.includes(id) || kept.includes(id))) : m));
  }, [lobby, extras, kept]);

  // The names shown follow the saved lists: a renamed roster / matchup shows its new name, a deleted one is gone.
  const loadedRoster: LoadedRoster | null = useMemo(() => {
    const r = loaded && settings.teamRosters.find((x) => x.id === loaded.id);
    return loaded && r ? { name: r.name, applied: loaded.applied } : null;
  }, [loaded, settings.teamRosters]);
  const opened: SavedOpen | null = useMemo(() => {
    const m = openedRaw && settings.teamMatchups.find((x) => x.id === openedRaw.id);
    return openedRaw && m ? { ...openedRaw, name: m.name } : null;
  }, [openedRaw, settings.teamMatchups]);

  const now = useMemo(() => Date.now(), [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const candidates = useMemo(() => sortCandidates(candidatesOf(lobby, extras.filter((id) => players?.[id])), players), [lobby, extras, players]);

  // Put the people of a roster or a saved matchup into Match: they play, the rest sit out, saved people not listed join (M-042).
  // Every member saved in People is also kept in `extras`, so the list and the checks stay when the lobby changes (a lobby person
  // who is also an extra shows once, as a lobby person).
  const place = (name: string, puuids: readonly string[]): { applied: string[]; missing: number } => {
    const r = applyRoster(candidates, { puuids }, players ?? {});
    setMoved(r.moved);
    setKept(Object.keys(r.moved));
    const members = puuids.filter((id) => players && Object.hasOwn(players, id));
    setExtras((e) => [...e, ...members.filter((id) => !e.includes(id))]);
    setPage("match");
    if (r.missing.length) notify(missingPeopleText(name, r.missing.length), "warn");
    return { applied: Object.keys(r.moved).filter((id) => r.moved[id] === "in"), missing: r.missing.length };
  };
  const loadRoster = (roster: SavedRoster) => {
    const { applied } = place(roster.name, roster.puuids);
    setLoaded({ id: roster.id, applied });
    setOpened(null);
  };
  const openMatchup = (m: SavedMatchup) => {
    const { missing } = place(m.name, [...m.blue, ...m.red].map((s) => s.puuid));
    setLoaded(null);
    // With people missing there is no such proposal: Match shows the usual ones.
    setOpened(missing ? null : { token: ++token.current, id: m.id, name: m.name, blue: m.blue, red: m.red, priority: m.priority });
  };
  const openFromStory = useRef(initial?.openMatchupId);
  useEffect(() => {
    if (!state || !openFromStory.current) return;
    const m = settings.teamMatchups.find((x) => x.id === openFromStory.current);
    openFromStory.current = undefined;
    if (m) openMatchup(m);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const setPref = useCallback((puuid: string, pref: TeamPlayerPref) => update({ teamPlayers: withPrefValue(settings.teamPlayers, puuid, pref) }), [settings.teamPlayers, update]);
  const setRank = useCallback(
    (puuid: string, points: number | null) => {
      const { rankOverride: _old, ...rest } = settings.teamPlayers[puuid] ?? {};
      setPref(puuid, points === null ? rest : { ...rest, rankOverride: points });
    },
    [settings.teamPlayers, setPref],
  );
  const add = (puuid: string) => {
    setExtras((e) => (e.includes(puuid) ? e : [...e, puuid]));
    setMoved((m) => ({ ...m, [puuid]: "in" }));
  };
  const removeExtra = (puuid: string) => {
    setExtras((e) => e.filter((x) => x !== puuid));
    setKept((k) => k.filter((x) => x !== puuid));
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

  const tabs: { id: TeamsSubPage; label: string; count?: number }[] = [
    { id: "match", label: "Match" },
    { id: "people", label: "People", count: Object.keys(state.players).length },
    { id: "matchups", label: "Matchups", count: settings.teamMatchups.length },
  ];
  return (
    <div className="teams-page">
      <div className="teams-inner">
        <div className="teams-top">
          <div className="tabs-row" role="tablist" aria-label="Teams">
            {tabs.map((t) => (
              <button key={t.id} type="button" role="tab" id={`teams-tab-${t.id}`} aria-selected={page === t.id} aria-controls={`teams-panel-${t.id}`} className="subtab" onClick={() => setPage(t.id)}>
                {t.label}
                {t.count !== undefined && <span className="count">{t.count}</span>}
              </button>
            ))}
          </div>
          <p className="legend" data-testid="legend">
            {LEGEND}
          </p>
        </div>
        <div id="teams-panel-match" role="tabpanel" aria-labelledby="teams-tab-match" hidden={page !== "match"}>
          <MatchView
            state={state}
            now={now}
            prefs={prefs}
            candidates={candidates}
            moved={moved}
            notify={notify}
            onToggle={(puuid, on) => setMoved((m) => ({ ...m, [puuid]: on ? "in" : "out" }))}
            onPref={setPref}
            onRank={setRank}
            onRefresh={(puuid) => api.refresh(puuid)}
            onAdd={add}
            onRemove={removeExtra}
            onLoadRoster={loadRoster}
            loadedRoster={loadedRoster}
            openedMatchup={opened}
            onClearOpened={clearOpened}
            initial={{ priority: initial?.priority, preview: initial?.preview, addOpen: initial?.addPeopleOpen, rankOpen: initial?.page === "people" ? undefined : initial?.rankOpen, rosters: initial?.rosters, rosterEditing: initial?.rosterEditing, saveMatchup: initial?.saveMatchupOpen }}
          />
        </div>
        <div id="teams-panel-people" role="tabpanel" aria-labelledby="teams-tab-people" hidden={page !== "people"}>
          <PeopleView
            api={api}
            state={state}
            now={now}
            visible={visible && page === "people"}
            prefs={prefs}
            lastGroupId={settings.teams.lastGroupId}
            onGroup={(id) => update({ teams: { ...settings.teams, lastGroupId: id } })}
            onPref={setPref}
            onRank={setRank}
            onForget={forget}
            onImport={(matched) => update({ teamPlayers: applyPrefsImport(settings.teamPlayers, matched) })}
            notify={notify}
            initial={{ ...initial, rankOpen: initial?.page === "people" ? initial.rankOpen : undefined }}
          />
        </div>
        <div id="teams-panel-matchups" role="tabpanel" aria-labelledby="teams-tab-matchups" hidden={page !== "matchups"}>
          <MatchupsView state={state} now={now} prefs={prefs} notify={notify} onOpen={openMatchup} initial={{ menuId: initial?.matchupMenuId, query: initial?.matchupQuery }} />
        </div>
      </div>
    </div>
  );
}
