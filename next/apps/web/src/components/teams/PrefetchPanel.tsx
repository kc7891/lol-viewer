import { useEffect, useMemo, useRef, useState } from "react";
import { parseRiotIdLines, type TeamPlayerPref } from "@lol-viewer/core";
import { TEAMS_PREFETCH_MAX, type FriendEntry, type FriendGroup, type RecentPlayer, type RiotIdResult, type TeamsApi, type TeamsState } from "@lol-viewer/protocol";
import { IconChevron, IconRefresh } from "../../ui/icons.tsx";
import { ageLabel, freshClass, remainingText } from "./model.ts";
import type { PrefPatch } from "./PlayerPrefs.tsx";
import { SavedList } from "./SavedList.tsx";

export type PrefetchTab = "friends" | "recent" | "riotIds" | "lobby" | "saved";
const TABS: { id: PrefetchTab; label: string }[] = [
  { id: "friends", label: "Friends" },
  { id: "recent", label: "Recent" },
  { id: "riotIds", label: "Riot IDs" },
  { id: "lobby", label: "Lobby" },
];
const cleanGroup = (name: string) => name.replace(/^\*+/, "");
const RIOT_ERROR: Record<NonNullable<RiotIdResult["error"]>, string> = { format: "Use name#tag", "not-found": "Not found", failed: "Could not look up" };

export type PrefetchPanelProps = {
  api: TeamsApi;
  state: TeamsState;
  now: number;
  /** The Teams page is shown. Friends and recent players are loaded only then, with the panel open and their tab selected. Default true. */
  visible?: boolean;
  open: boolean;
  onToggle: () => void;
  tab: PrefetchTab;
  onTab: (t: PrefetchTab) => void;
  prefs: Record<string, TeamPlayerPref>;
  onPref: (puuid: string, patch: PrefPatch) => void;
  /** Persisted choices (settings.teams.lastGroupId). */
  lastGroupId: number | null;
  onGroup: (id: number | null) => void;
  listed: ReadonlySet<string>;
  onAdd: (puuid: string) => void;
  onForget: (puuid: string) => void;
  notify: (text: string, kind?: "info" | "success" | "warn") => void;
  /** Stories / tests. */
  initialRiotIds?: string;
  initialSavedOpen?: string;
};

type Loaded<T> = { state: "idle" | "loading" | "ready" | "failed"; data: T | null };

function useTick(active: boolean): number {
  const [n, setN] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setN(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return n;
}

export function PrefetchPanel(p: PrefetchPanelProps) {
  const { api, state, now } = p;
  const { prefetch } = state;
  const lobbyIds = useMemo(() => (state.lobby ? [...state.lobby.team100, ...state.lobby.team200, ...state.lobby.spectators] : []), [state.lobby]);
  const nameOf = (id: string) => state.players[id]?.gameName || "Loading…";

  // ── what each tab offers, and what is ticked ──
  const [friends, setFriends] = useState<Loaded<{ groups: FriendGroup[]; friends: FriendEntry[]; self: { puuid: string; gameName: string; tagLine: string } | null }>>({ state: "idle", data: null });
  const [recent, setRecent] = useState<Loaded<RecentPlayer[]>>({ state: "idle", data: null });
  const [groupId, setGroupId] = useState<number | "all">(p.lastGroupId ?? "all");
  const [friendTicks, setFriendTicks] = useState<Set<string>>(new Set());
  const [includeMe, setIncludeMe] = useState(false);
  const [recentQuery, setRecentQuery] = useState("");
  const [recentTicks, setRecentTicks] = useState<Set<string>>(new Set());
  const [riotText, setRiotText] = useState(p.initialRiotIds ?? "");
  const [riotResults, setRiotResults] = useState<RiotIdResult[] | null>(null);
  const [resolving, setResolving] = useState(false);
  const [lobbyOff, setLobbyOff] = useState<Set<string>>(new Set());
  const [armed, setArmed] = useState(false);

  const loadFriends = () => {
    setFriends((f) => ({ state: "loading", data: f.data }));
    api.friends().then(
      (d) => {
        setFriends({ state: "ready", data: d });
        setFriendTicks(new Set(d.friends.map((x) => x.puuid)));
      },
      () => setFriends({ state: "failed", data: null }),
    );
  };
  const loadRecent = () => {
    setRecent((r) => ({ state: "loading", data: r.data }));
    api.recentPlayers().then(
      (d) => setRecent({ state: "ready", data: d }),
      () => setRecent({ state: "failed", data: null }),
    );
  };
  useEffect(() => {
    if (!p.open || p.visible === false) return;
    if (p.tab === "friends" && friends.state === "idle") loadFriends();
    if (p.tab === "recent" && recent.state === "idle") loadRecent();
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = friends.data?.groups.filter((g) => friends.data!.friends.some((f) => f.groupId === g.id)) ?? [];
  const shownFriends = (friends.data?.friends ?? []).filter((f) => groupId === "all" || f.groupId === groupId);
  const shownRecent = (recent.data ?? []).filter((r) => `${r.gameName}#${r.tagLine}`.toLowerCase().includes(recentQuery.trim().toLowerCase()));
  const riotLines = parseRiotIdLines(riotText);
  const riotBad = riotLines.some((l) => !l.valid);
  const riotFound = (riotResults ?? []).filter((r) => r.puuid).map((r) => r.puuid!);

  const selection: string[] =
    p.tab === "friends"
      ? [...new Set([...shownFriends.filter((f) => friendTicks.has(f.puuid)).map((f) => f.puuid), ...(includeMe && friends.data?.self ? [friends.data.self.puuid] : [])])]
      : p.tab === "recent"
        ? shownRecent.filter((r) => recentTicks.has(r.puuid)).map((r) => r.puuid)
        : p.tab === "riotIds"
          ? riotFound
          : p.tab === "lobby"
            ? lobbyIds.filter((id) => !lobbyOff.has(id))
            : Object.keys(state.players);
  const addedBy = p.tab === "friends" ? "friend" : p.tab === "recent" ? "recent" : p.tab === "lobby" ? "lobby" : undefined;

  const fetchNow = (mode: "stale" | "all") => {
    for (let i = 0; i < selection.length; i += TEAMS_PREFETCH_MAX) api.prefetch({ puuids: selection.slice(i, i + TEAMS_PREFETCH_MAX), mode, ...(addedBy ? { addedBy } : {}) });
  };

  const resolve = async () => {
    setResolving(true);
    try {
      setRiotResults(await api.resolveRiotIds(riotLines.map((l) => l.input)));
    } catch {
      p.notify("Could not look the Riot IDs up. Is the League Client running?", "warn");
    } finally {
      setResolving(false);
    }
  };

  // ── progress ──
  const running = prefetch.running;
  const clock = useTick(running || prefetch.pausedUntil !== null);
  const startedAt = useRef<number | null>(null);
  if (running && startedAt.current === null) startedAt.current = Date.now();
  if (!running) startedAt.current = null;
  const left = running ? remainingText(prefetch.done, prefetch.total, clock - (startedAt.current ?? clock)) : null;
  const pausedFor = prefetch.pausedUntil !== null ? Math.max(0, Math.ceil((prefetch.pausedUntil - clock) / 1000)) : 0;
  const paused = prefetch.pausedUntil !== null && pausedFor > 0;

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  const clearAll = () => {
    if (!armed) return setArmed(true);
    setArmed(false);
    api.clearCache();
    p.notify("Cleared all cached data.", "success");
  };

  const tickRow = (checked: boolean, onChange: () => void, key: string, name: string, extra?: React.ReactNode) => (
    <li key={key}>
      <label className="pick-row">
        <input type="checkbox" checked={checked} onChange={onChange} />
        <span className="pname">{name}</span>
        {extra}
      </label>
    </li>
  );
  const status = (puuid: string) => {
    const pl = state.players[puuid];
    const at = pl?.rank?.fetchedAt;
    return at === undefined ? (
      <span className="fetched" data-fresh="none">
        Not fetched
      </span>
    ) : (
      <span className="fetched" data-fresh={freshClass(at, now)}>
        {ageLabel(at, now)}
      </span>
    );
  };
  const toggle = (set: Set<string>, setSet: (s: Set<string>) => void, id: string) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setSet(n);
  };

  return (
    <section className="card prefetch" aria-label="Prefetch">
      <button type="button" className="prefetch-toggle" aria-expanded={p.open} onClick={p.onToggle}>
        <span className="saved-chevron" data-open={p.open || undefined}>
          <IconChevron size={14} />
        </span>
        <h2>Prefetch</h2>
        <span className="muted">Fetch ranks and match history before the custom game starts</span>
        {running && (
          <span className="muted" role="status">
            · {prefetch.done} / {prefetch.total}
          </span>
        )}
      </button>
      {p.open && (
        <div className="prefetch-body">
          <div className="tabs-row" role="tablist" aria-label="Who to fetch">
            {[...TABS, { id: "saved" as const, label: `Saved (${Object.keys(state.players).length})` }].map((t) => (
              <button key={t.id} type="button" role="tab" id={`pf-tab-${t.id}`} aria-selected={p.tab === t.id} aria-controls="pf-panel" className="subtab" onClick={() => p.onTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          <div id="pf-panel" role="tabpanel" aria-labelledby={`pf-tab-${p.tab}`} className="pf-panel">
            {p.tab === "friends" && (
              <>
                <div className="probe-row">
                  <div className="field">
                    <label htmlFor="pf-group">Friend group</label>
                    <select
                      id="pf-group"
                      value={String(groupId)}
                      onChange={(e) => {
                        const v = e.target.value === "all" ? "all" : Number(e.target.value);
                        setGroupId(v);
                        p.onGroup(v === "all" ? null : v);
                        const ids = (friends.data?.friends ?? []).filter((f) => v === "all" || f.groupId === v).map((f) => f.puuid);
                        setFriendTicks(new Set(ids));
                      }}
                    >
                      <option value="all">All friends ({friends.data?.friends.length ?? 0})</option>
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {cleanGroup(g.name)} ({friends.data!.friends.filter((f) => f.groupId === g.id).length})
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="probe-check">
                    <input type="checkbox" checked={includeMe} disabled={!friends.data?.self} onChange={(e) => setIncludeMe(e.target.checked)} />
                    Include me
                  </label>
                  <button type="button" className="btn ghost" onClick={() => setFriendTicks(new Set(shownFriends.map((f) => f.puuid)))}>
                    Select all
                  </button>
                  <button type="button" className="btn ghost" onClick={() => setFriendTicks(new Set())}>
                    None
                  </button>
                  <button type="button" className="icon-btn" aria-label="Reload friends" title="Reload friends" onClick={loadFriends}>
                    <IconRefresh />
                  </button>
                </div>
                {friends.state === "loading" && !friends.data && <p className="muted">Loading friends…</p>}
                {friends.state !== "loading" && shownFriends.length === 0 && <p className="muted">No friends to show. Is the League Client running?</p>}
                <ul className="pick-list">{shownFriends.map((f) => tickRow(friendTicks.has(f.puuid), () => toggle(friendTicks, setFriendTicks, f.puuid), f.puuid, `${f.gameName}#${f.tagLine}`, status(f.puuid)))}</ul>
              </>
            )}
            {p.tab === "recent" && (
              <>
                <div className="probe-row">
                  <div className="field">
                    <label htmlFor="pf-recent-search">Search recent players</label>
                    <input id="pf-recent-search" type="search" placeholder="Name" value={recentQuery} onChange={(e) => setRecentQuery(e.target.value)} />
                  </div>
                  <button type="button" className="btn ghost" onClick={() => setRecentTicks(new Set(shownRecent.map((r) => r.puuid)))}>
                    Select shown
                  </button>
                  <button type="button" className="btn ghost" onClick={() => setRecentTicks(new Set())}>
                    None
                  </button>
                </div>
                {recent.state === "loading" && !recent.data && <p className="muted">Loading recent players…</p>}
                {recent.state !== "loading" && shownRecent.length === 0 && <p className="muted">No recent players to show.</p>}
                <ul className="pick-list">
                  {shownRecent.map((r) =>
                    tickRow(recentTicks.has(r.puuid), () => toggle(recentTicks, setRecentTicks, r.puuid), r.puuid, `${r.gameName}#${r.tagLine}`, status(r.puuid)),
                  )}
                </ul>
              </>
            )}
            {p.tab === "riotIds" && (
              <>
                <div className="field" data-invalid={riotBad || undefined}>
                  <label htmlFor="pf-riot">Riot IDs, one per line (name#tag)</label>
                  <textarea
                    id="pf-riot"
                    className="riot-input"
                    rows={4}
                    spellCheck={false}
                    placeholder={"Player20#tag20\nPlayer21#tag21"}
                    value={riotText}
                    aria-invalid={riotBad}
                    onChange={(e) => {
                      setRiotText(e.target.value);
                      setRiotResults(null);
                    }}
                  />
                </div>
                {riotResults === null && riotLines.length > 0 && (
                  <ul className="riot-lines">
                    {riotLines.map((l) => (
                      <li key={l.input} data-valid={l.valid}>
                        <span className="pname">{l.input}</span>
                        {!l.valid && <span className="err-text">Use name#tag</span>}
                      </li>
                    ))}
                  </ul>
                )}
                {riotResults && (
                  <ul className="riot-lines" aria-label="Lookup results">
                    {riotResults.map((r) => (
                      <li key={r.input} data-valid={r.puuid !== null}>
                        <span className="ok-mark" aria-hidden>
                          {r.puuid ? "✓" : "✗"}
                        </span>
                        <span className="pname">{r.input}</span>
                        <span className={r.puuid ? "muted" : "err-text"}>{r.puuid ? "Found" : RIOT_ERROR[r.error ?? "failed"]}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="probe-row">
                  <button type="button" className="btn" disabled={riotLines.length === 0 || riotBad || resolving} onClick={() => void resolve()}>
                    Resolve
                  </button>
                  {resolving && <span role="status">Looking up…</span>}
                  {riotBad && <span className="hint error">Fix the lines marked red first.</span>}
                  {riotLines.length >= 30 && <span className="hint">At most 30 lines.</span>}
                </div>
              </>
            )}
            {p.tab === "lobby" &&
              (lobbyIds.length === 0 ? (
                <p className="muted">You are not in a custom lobby.</p>
              ) : (
                <ul className="pick-list">{lobbyIds.map((id) => tickRow(!lobbyOff.has(id), () => toggle(lobbyOff, setLobbyOff, id), id, nameOf(id), status(id)))}</ul>
              ))}
            {p.tab === "saved" && (
              <SavedList
                players={state.players}
                prefs={p.prefs}
                fetching={new Set(state.fetching)}
                listed={p.listed}
                now={now}
                onAdd={p.onAdd}
                onRefresh={(id) => api.refresh(id)}
                onForget={p.onForget}
                onPref={p.onPref}
                initialOpen={p.initialSavedOpen}
              />
            )}
          </div>
          <div className="prefetch-actions">
            <button type="button" className="btn primary" disabled={selection.length === 0} onClick={() => fetchNow("stale")}>
              Fetch stale &amp; new ({selection.length})
            </button>
            <button type="button" className="btn" disabled={selection.length === 0} onClick={() => fetchNow("all")}>
              Fetch all again
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
            <button type="button" className="btn ghost danger" onClick={clearAll}>
              {armed ? "Click again to clear" : "Clear all cached data"}
            </button>
          </div>
          {paused && (
            <p className="paused-note" role="status">
              The League Client is limiting requests. Resuming in {pausedFor} s.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
