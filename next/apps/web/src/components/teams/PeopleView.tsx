import { useEffect, useMemo, useRef, useState } from "react";
import { effectiveRank, exportPrefs, matchPrefsEntries, parsePrefsFile, PREFS_FILE_MAX_BYTES, rankLabel, type TeamPlayerPref } from "@lol-viewer/core";
import { isValidRiotId, LANES, TEAMS_PREFETCH_MAX, TEAMS_RIOT_ID_LINES_MAX, type TeamPlayer, type TeamsApi, type TeamsState } from "@lol-viewer/protocol";
import { IconChevron, IconMore, IconPlus } from "../../ui/icons.tsx";
import { LANE_LABEL } from "../../ui/labels.ts";
import { AddPeoplePanel, type AddMode } from "./AddPeoplePanel.tsx";
import { LaneChips } from "./LaneChips.tsx";
import { ageLabel, byName, entryText, fetchedAtOf, freshClass, importBarText, namesText, needsFetch, PREFS_ERROR_TEXT, remainingText, type ImportPlan } from "./model.ts";
import { MenuButton, type MenuItem } from "./Popover.tsx";
import { RankBadge } from "./RankBadge.tsx";

export type PeopleFilter = "all" | "lobby" | "old";
export type PeopleSort = "name" | "rank" | "fetched";
const QUEUE: Record<number, string> = { 400: "Normal (Draft)", 430: "Normal (Blind)", 480: "Swiftplay", 490: "Quickplay" };
const date = (at: number) => new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export type PeopleViewProps = {
  api: TeamsApi;
  state: TeamsState;
  now: number;
  visible?: boolean;
  prefs: Record<string, TeamPlayerPref>;
  lastGroupId: number | null;
  onGroup: (id: number | null) => void;
  onPref: (puuid: string, pref: TeamPlayerPref) => void;
  onRank: (puuid: string, points: number | null) => void;
  onForget: (puuid: string) => void;
  /** The confirmed import: these people get exactly these preferences. */
  onImport: (matched: { puuid: string; pref: TeamPlayerPref }[]) => void;
  notify: (text: string, kind?: "info" | "success" | "warn") => void;
  /** Stories / tests. */
  initial?: { filter?: PeopleFilter; sort?: PeopleSort; query?: string; detailsOpen?: string; addMode?: AddMode; riotIds?: string; menuOpen?: boolean; importPlan?: ImportPlan; rankOpen?: string };
};

function useTick(active: boolean): number {
  const [n, setN] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setN(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return n;
}

/** People: every saved person with the same lane chips and rank badge as Match, plus fetching, adding, and the preferences file. */
export function PeopleView({ api, state, now, visible = true, prefs, lastGroupId, onGroup, onPref, onRank, onForget, onImport, notify, initial }: PeopleViewProps) {
  const { prefetch } = state;
  const [query, setQuery] = useState(initial?.query ?? "");
  const [filter, setFilter] = useState<PeopleFilter>(initial?.filter ?? "all");
  const [sort, setSort] = useState<PeopleSort>(initial?.sort ?? "name");
  const [open, setOpen] = useState<string | null>(initial?.detailsOpen ?? null);
  const [addMode, setAddMode] = useState<AddMode | null>(initial?.addMode ?? null);
  const [plan, setPlan] = useState<ImportPlan | null>(initial?.importPlan ?? null);
  const [reading, setReading] = useState(false);
  const [armed, setArmed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const lobbyIds = useMemo(() => new Set(state.lobby ? [...state.lobby.team100, ...state.lobby.team200, ...state.lobby.spectators] : []), [state.lobby]);
  const all = useMemo(() => Object.values(state.players), [state.players]);
  const counts = useMemo(() => ({ all: all.length, lobby: all.filter((p) => lobbyIds.has(p.puuid)).length, old: all.filter((p) => needsFetch(p, now)).length }), [all, lobbyIds, now]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pts = (p: TeamPlayer) => effectiveRank(p, prefs[p.puuid], now)?.points ?? -1;
    return all
      .filter((p) => (!q || `${p.gameName}#${p.tagLine}`.toLowerCase().includes(q)) && (filter === "all" || (filter === "lobby" ? lobbyIds.has(p.puuid) : needsFetch(p, now))))
      .sort((a, b) => (sort === "rank" ? pts(b) - pts(a) || byName(a, b, a.puuid, b.puuid) : sort === "fetched" ? fetchedAtOf(b) - fetchedAtOf(a) || byName(a, b, a.puuid, b.puuid) : byName(a, b, a.puuid, b.puuid)));
  }, [all, query, filter, sort, lobbyIds, prefs, now]);
  const stale = rows.filter((p) => needsFetch(p, now));

  const fetchPeople = (puuids: string[], mode: "stale" | "all") => {
    for (let i = 0; i < puuids.length; i += TEAMS_PREFETCH_MAX) api.prefetch({ puuids: puuids.slice(i, i + TEAMS_PREFETCH_MAX), mode });
  };

  // ── progress ──
  const running = prefetch.running;
  const clock = useTick(running || prefetch.pausedUntil !== null);
  const startedAt = useRef<number | null>(null);
  if (running && startedAt.current === null) startedAt.current = Date.now();
  if (!running) startedAt.current = null;
  const left = running ? remainingText(prefetch.done, prefetch.total, clock - (startedAt.current ?? clock)) : null;
  const pausedFor = prefetch.pausedUntil !== null ? Math.max(0, Math.ceil((prefetch.pausedUntil - clock) / 1000)) : 0;

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  // ── the preferences file ──
  const exportFile = async () => {
    const text = exportPrefs(prefs, state.players, Date.now());
    const count = (JSON.parse(text) as { players: unknown[] }).players.length;
    if (count === 0) return notify("No preferences to export yet. Set lane chips or ranks first.", "warn");
    try {
      const r = await api.exportPrefs(text);
      if (r.saved) notify(`Saved preferences for ${count} ${count === 1 ? "person" : "people"}.`, "success");
    } catch {
      notify("Could not save the preferences file.", "warn");
    }
  };
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > PREFS_FILE_MAX_BYTES) return notify(PREFS_ERROR_TEXT.size, "warn");
    setReading(true);
    try {
      const parsed = parsePrefsFile(await file.text());
      if (!parsed.ok) return notify(PREFS_ERROR_TEXT[parsed.error], "warn");
      const { matched, unresolved } = matchPrefsEntries(parsed.entries, state.players);
      // Not saved yet: look the Riot ID up in the client (a read), when it is connected.
      const lookups = unresolved.filter((id) => isValidRiotId(id));
      const notFound = unresolved.filter((id) => !lookups.includes(id));
      const resolved: string[] = [];
      for (let i = 0; i < lookups.length; i += TEAMS_RIOT_ID_LINES_MAX) {
        const chunk = lookups.slice(i, i + TEAMS_RIOT_ID_LINES_MAX);
        let results: Awaited<ReturnType<TeamsApi["resolveRiotIds"]>> = [];
        try {
          results = await api.resolveRiotIds(chunk);
        } catch {
          results = [];
        }
        for (const id of chunk) {
          const r = results.find((x) => x.input === id);
          const entry = parsed.entries.find((e) => e.riotId === id);
          if (r?.puuid && entry) {
            matched.push({ puuid: r.puuid, pref: entry.pref });
            resolved.push(r.puuid);
          } else notFound.push(id);
        }
      }
      if (matched.length === 0) return notify(parsed.entries.length === 0 ? "That file has no preferences in it." : `Nothing to import. Not found: ${namesText(notFound)}`, "warn");
      setPlan({ matched, notFound, replacing: matched.filter((m) => prefs[m.puuid]).length, resolved });
    } catch {
      notify("Could not read that file.", "warn");
    } finally {
      setReading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  const confirmImport = () => {
    if (!plan) return;
    onImport(plan.matched);
    if (plan.resolved?.length) fetchPeople(plan.resolved, "stale");
    const n = plan.matched.length;
    notify(`Imported preferences for ${n} ${n === 1 ? "person" : "people"}.${plan.notFound.length ? ` ${plan.notFound.length} not found: ${namesText(plan.notFound)}` : ""}`, plan.notFound.length ? "warn" : "success");
    setPlan(null);
  };

  const menu: MenuItem[] = [
    { label: "Fetch all again", onSelect: () => fetchPeople(rows.map((p) => p.puuid), "all"), disabled: rows.length === 0 },
    { label: "Export preferences…", onSelect: () => void exportFile(), separatorBefore: true },
    { label: "Import preferences…", onSelect: () => fileInput.current?.click() },
    {
      label: armed ? "Click again to clear" : "Clear all cached data",
      danger: true,
      keepOpen: !armed,
      separatorBefore: true,
      onSelect: () => {
        if (!armed) return setArmed(true);
        setArmed(false);
        api.clearCache();
        notify("Cleared all cached data.", "success");
      },
    },
  ];
  const addItems: MenuItem[] = [
    { label: "From a friend group…", onSelect: () => setAddMode("friends") },
    { label: "From recent players…", onSelect: () => setAddMode("recent") },
    { label: "By Riot ID…", onSelect: () => setAddMode("riotIds") },
  ];

  return (
    <section className="card people" aria-label="People">
      <div className="people-bar">
        <MenuButton label="Add to People" className="btn" align="left" trigger={<><IconPlus /> Add <IconChevron size={12} /></>} items={addItems} />
        <button type="button" className="btn primary" disabled={stale.length === 0} onClick={() => fetchPeople(stale.map((p) => p.puuid), "stale")}>
          Fetch missing &amp; old ({stale.length})
        </button>
        <button type="button" className="btn" disabled={!running} onClick={() => api.cancelPrefetch()}>
          Cancel
        </button>
        {running && (
          <span role="status" className="progress-text" data-testid="prefetch-progress">
            {prefetch.done} / {prefetch.total}
            {left && ` · ${left}`}
            {prefetch.failed > 0 && ` · ${prefetch.failed} failed`}
          </span>
        )}
        <span className="spacer" />
        <MenuButton label="People actions" trigger={<IconMore />} items={menu} initialOpen={initial?.menuOpen} />
        <input ref={fileInput} type="file" accept=".json,application/json" className="visually-hidden" aria-label="Import preferences file" tabIndex={-1} onChange={(e) => void onFile(e.target.files?.[0])} />
      </div>
      {reading && (
        <p className="muted" role="status">
          Reading the file…
        </p>
      )}
      {plan && (
        <div className="import-bar" role="region" aria-label="Import preferences" data-testid="import-bar">
          <span>{importBarText(plan)}</span>
          {plan.notFound.length > 0 && <span className="muted small">Not found: {namesText(plan.notFound)}</span>}
          <span className="spacer" />
          <button type="button" className="btn primary" onClick={confirmImport}>
            Import
          </button>
          <button type="button" className="btn" onClick={() => setPlan(null)}>
            Cancel
          </button>
        </div>
      )}
      {prefetch.pausedUntil !== null && pausedFor > 0 && (
        <p className="paused-note" role="status">
          The League Client is limiting requests. Resuming in {pausedFor} s.
        </p>
      )}
      <div className="people-filters">
        <div className="field">
          <label htmlFor="people-search">Search people</label>
          <input id="people-search" type="search" placeholder="Name" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="seg" role="group" aria-label="Show">
          {([["all", "All"], ["lobby", "In lobby"], ["old", "Old/missing"]] as const).map(([k, label]) => (
            <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {label} <span className="count">{counts[k]}</span>
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Sort by">
          {([["name", "Name"], ["rank", "Rank"], ["fetched", "Fetched"]] as const).map(([k, label]) => (
            <button key={k} type="button" aria-pressed={sort === k} onClick={() => setSort(k)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {all.length === 0 ? (
        <p className="muted people-empty">Nobody is saved yet. People in your custom lobby are saved on their own; use Add to bring in friends, recent players or Riot IDs.</p>
      ) : (
        <table className="people-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Rank</th>
              <th scope="col">Est.</th>
              <th scope="col">Lanes</th>
              <th scope="col">Fetched</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const isOpen = open === p.puuid;
              const at = fetchedAtOf(p);
              const fetching = state.fetching.includes(p.puuid);
              const name = p.gameName || "Unknown";
              return (
                <PeopleRow
                  key={p.puuid}
                  puuid={p.puuid}
                  open={isOpen}
                  detail={<PersonDetails p={p} now={now} />}
                  cells={
                    <>
                      <td className="pc-name">
                        <span className="pname-cell">
                          <span className="pname">{name}</span>
                          <span className="ptag">{p.tagLine && `#${p.tagLine}`}</span>
                          {lobbyIds.has(p.puuid) && <span className="origin-note">Lobby</span>}
                        </span>
                      </td>
                      <td>
                        <RankBadge name={name} player={p} pref={prefs[p.puuid]} now={now} onChange={(pts) => onRank(p.puuid, pts)} initialOpen={initial?.rankOpen === p.puuid} />
                      </td>
                      <td className="pc-est">{p.estimate ? (p.estimate.points === null ? <span className="muted">few data</span> : rankLabel(p.estimate.points, "estimate")) : <span className="muted">—</span>}</td>
                      <td>
                        <LaneChips name={name} pref={prefs[p.puuid]} player={p} onChange={(pref) => onPref(p.puuid, pref)} />
                      </td>
                      <td className="pc-fetched">
                        {fetching ? (
                          <span className="fetched" role="status">
                            Fetching…
                          </span>
                        ) : (
                          <span className="fetched" data-fresh={freshClass(at || undefined, now)}>
                            {at ? ageLabel(at, now) : "Name only"}
                          </span>
                        )}
                        {p.error && !fetching && (
                          <span className="err-flag" title={p.error}>
                            !
                          </span>
                        )}
                      </td>
                      <td className="pc-actions">
                        <button type="button" className="icon-btn" aria-label={`Details of ${name}`} title="Details" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : p.puuid)}>
                          <span className="saved-chevron" data-open={isOpen || undefined}>
                            <IconChevron size={14} />
                          </span>
                        </button>
                        <MenuButton
                          label={`More for ${name}`}
                          trigger={<IconMore />}
                          items={[
                            { label: "Refresh", onSelect: () => api.refresh(p.puuid) },
                            { label: "Forget", onSelect: () => onForget(p.puuid), danger: true },
                          ]}
                        />
                      </td>
                    </>
                  }
                />
              );
            })}
          </tbody>
        </table>
      )}
      {all.length > 0 && rows.length === 0 && <p className="muted">No one matches{query ? ` “${query}”` : " this filter"}.</p>}
      {addMode && (
        <AddPeoplePanel mode={addMode} api={api} state={state} now={now} visible={visible} lastGroupId={lastGroupId} onGroup={onGroup} onClose={() => setAddMode(null)} notify={notify} initialRiotIds={initial?.riotIds} />
      )}
    </section>
  );
}

function PeopleRow({ puuid, cells, open, detail }: { puuid: string; cells: React.ReactNode; open: boolean; detail: React.ReactNode }) {
  return (
    <>
      <tr className="people-row" data-puuid={puuid} data-open={open || undefined}>
        {cells}
      </tr>
      {open && (
        <tr className="people-details">
          <td colSpan={6}>{detail}</td>
        </tr>
      )}
    </>
  );
}

/** What was fetched about one person (rank, the estimate and the games it came from, lanes). Manual settings are not here: they are set in the row. */
function PersonDetails({ p, now }: { p: TeamPlayer; now: number }) {
  return (
    <div className="saved-details">
      <div className="detail-grid">
        <section aria-label="Rank">
          <h4>Rank</h4>
          <dl className="kv">
            <dt>Solo/Duo</dt>
            <dd>{entryText(p.rank?.solo ?? null)}</dd>
            <dt>Flex</dt>
            <dd>{entryText(p.rank?.flex ?? null)}</dd>
            <dt>Last season</dt>
            <dd>{entryText(p.rank?.prevSeason ?? null)}</dd>
            <dt>Fetched</dt>
            <dd>{p.rank ? ageLabel(p.rank.fetchedAt, now) : "Not yet"}</dd>
          </dl>
        </section>
        <section aria-label="Estimate">
          <h4>Estimate</h4>
          {p.estimate ? (
            <>
              <p>
                {p.estimate.points === null ? "Too little data" : rankLabel(p.estimate.points, "estimate")}
                <span className="muted">
                  {" "}
                  · {p.estimate.samples} players in {p.estimate.games} games
                  {p.estimate.min !== null && p.estimate.max !== null && ` · ${rankLabel(p.estimate.min, "solo")} to ${rankLabel(p.estimate.max, "solo")}`}
                </span>
              </p>
              <ul className="estimate-games">
                {p.estimate.perGame.map((g, i) => (
                  <li key={i}>
                    <span>{date(g.at)}</span>
                    <span>{QUEUE[g.queueId] ?? `Queue ${g.queueId}`}</span>
                    <span>{g.median === null ? "—" : rankLabel(g.median, "solo")}</span>
                    <span className="muted">{g.samples} players</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="muted">{p.rank?.solo || p.rank?.flex ? "Not needed: this player has a rank." : "Not estimated yet."}</p>
          )}
        </section>
        <section aria-label="Lanes">
          <h4>Lanes {p.lanes ? <span className="muted">({p.lanes.games} games)</span> : null}</h4>
          {p.lanes ? (
            <ul className="lane-bars">
              {LANES.map((l) => {
                const n = p.lanes!.counts[l] ?? 0;
                const pct = p.lanes!.games ? Math.round((n / p.lanes!.games) * 100) : 0;
                return (
                  <li key={l}>
                    <span>{LANE_LABEL[l]}</span>
                    <span className="bar">
                      <span style={{ width: `${pct}%` }} />
                    </span>
                    <span className="muted">
                      {n} · {pct}%
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted">Not fetched yet.</p>
          )}
        </section>
      </div>
      {p.previousNames.length > 0 && <p className="muted">Earlier names: {p.previousNames.join(", ")}</p>}
      {p.error && <p className="warn-text">Last problem: {p.error}</p>}
    </div>
  );
}
