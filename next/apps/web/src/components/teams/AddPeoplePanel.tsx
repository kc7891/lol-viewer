import { useEffect, useRef, useState } from "react";
import { parseRiotIdLines } from "@lol-viewer/core";
import { TEAMS_PREFETCH_MAX, type FriendEntry, type FriendGroup, type RecentPlayer, type RiotIdResult, type TeamsApi, type TeamsState } from "@lol-viewer/protocol";
import { IconClose, IconRefresh } from "../../ui/icons.tsx";
import { ageLabel, fetchedAtOf, freshClass } from "./model.ts";
import { useDismiss } from "./Popover.tsx";

export type AddMode = "friends" | "recent" | "riotIds";
const TITLE: Record<AddMode, string> = { friends: "Add from a friend group", recent: "Add from recent players", riotIds: "Add by Riot ID" };
const cleanGroup = (name: string) => name.replace(/^\*+/, "");
const RIOT_ERROR: Record<NonNullable<RiotIdResult["error"]>, string> = { format: "Use name#tag", "not-found": "Not found", failed: "Could not look up" };

type Loaded<T> = { state: "idle" | "loading" | "ready" | "failed"; data: T | null };
type FriendsData = { groups: FriendGroup[]; friends: FriendEntry[]; self: { puuid: string; gameName: string; tagLine: string } | null };

export type AddPeoplePanelProps = {
  mode: AddMode;
  api: TeamsApi;
  state: TeamsState;
  now: number;
  /** The Teams page is shown. The friends and recent players are read from the League Client only then, and only while this panel is open. */
  visible?: boolean;
  /** Persisted choice (settings.teams.lastGroupId). */
  lastGroupId: number | null;
  onGroup: (id: number | null) => void;
  onClose: () => void;
  notify: (text: string, kind?: "info" | "success" | "warn") => void;
  /** Stories / tests. */
  initialRiotIds?: string;
};

/**
 * Add people to People (M-040 §4.2): from a friend group, from the recent players, or by Riot ID. The panel lies over the page;
 * what the League Client knows (friends, recent players) is read only while it is open. `Add & fetch` saves the people and starts their fetch.
 */
export function AddPeoplePanel({ mode, api, state, now, visible = true, lastGroupId, onGroup, onClose, notify, initialRiotIds }: AddPeoplePanelProps) {
  const dialog = useRef<HTMLDivElement>(null);
  useDismiss(true, dialog, onClose);

  const [friends, setFriends] = useState<Loaded<FriendsData>>({ state: "idle", data: null });
  const [recent, setRecent] = useState<Loaded<RecentPlayer[]>>({ state: "idle", data: null });
  const [groupId, setGroupId] = useState<number | "all">(lastGroupId ?? "all");
  const [friendTicks, setFriendTicks] = useState<Set<string>>(new Set());
  const [includeMe, setIncludeMe] = useState(false);
  const [recentQuery, setRecentQuery] = useState("");
  const [recentTicks, setRecentTicks] = useState<Set<string>>(new Set());
  const [riotText, setRiotText] = useState(initialRiotIds ?? "");
  const [riotResults, setRiotResults] = useState<RiotIdResult[] | null>(null);
  const [busy, setBusy] = useState(false);

  const loadFriends = () => {
    setFriends((f) => ({ state: "loading", data: f.data }));
    api.friends().then(
      (d) => {
        setFriends({ state: "ready", data: d });
        setFriendTicks(new Set(d.friends.filter((x) => groupId === "all" || x.groupId === groupId).map((x) => x.puuid)));
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
    if (!visible) return;
    if (mode === "friends" && friends.state === "idle") loadFriends();
    if (mode === "recent" && recent.state === "idle") loadRecent();
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = friends.data?.groups.filter((g) => friends.data!.friends.some((f) => f.groupId === g.id)) ?? [];
  const shownFriends = (friends.data?.friends ?? []).filter((f) => groupId === "all" || f.groupId === groupId);
  const shownRecent = (recent.data ?? []).filter((r) => `${r.gameName}#${r.tagLine}`.toLowerCase().includes(recentQuery.trim().toLowerCase()));
  const riotLines = parseRiotIdLines(riotText);
  const riotBad = riotLines.some((l) => !l.valid);

  const selection: string[] =
    mode === "friends"
      ? [...new Set([...shownFriends.filter((f) => friendTicks.has(f.puuid)).map((f) => f.puuid), ...(includeMe && friends.data?.self ? [friends.data.self.puuid] : [])])]
      : mode === "recent"
        ? shownRecent.filter((r) => recentTicks.has(r.puuid)).map((r) => r.puuid)
        : [];

  const fetchPeople = (puuids: string[], addedBy?: "friend" | "recent") => {
    for (let i = 0; i < puuids.length; i += TEAMS_PREFETCH_MAX) api.prefetch({ puuids: puuids.slice(i, i + TEAMS_PREFETCH_MAX), mode: "stale", ...(addedBy ? { addedBy } : {}) });
  };
  const addAndFetch = async () => {
    if (mode !== "riotIds") {
      fetchPeople(selection, mode === "friends" ? "friend" : "recent");
      notify(`Fetching ${selection.length} ${selection.length === 1 ? "person" : "people"}.`, "success");
      return onClose();
    }
    setBusy(true);
    try {
      const results = await api.resolveRiotIds(riotLines.map((l) => l.input));
      setRiotResults(results);
      const found = results.filter((r) => r.puuid).map((r) => r.puuid!);
      fetchPeople(found);
      if (found.length) notify(`Added ${found.length} ${found.length === 1 ? "person" : "people"}. Fetching.`, "success");
    } catch {
      notify("Could not look the Riot IDs up. Is the League Client running?", "warn");
    } finally {
      setBusy(false);
    }
  };

  const status = (puuid: string) => {
    const p = state.players[puuid];
    const at = p ? fetchedAtOf(p) : 0;
    return at === 0 ? (
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
  const tickRow = (checked: boolean, onChange: () => void, key: string, name: string) => (
    <li key={key}>
      <label className="pick-row">
        <input type="checkbox" checked={checked} onChange={onChange} />
        <span className="pname">{name}</span>
        {status(key)}
      </label>
    </li>
  );

  const canAdd = mode === "riotIds" ? riotLines.length > 0 && !riotBad && !busy && riotResults === null : selection.length > 0;
  const addLabel = mode === "riotIds" ? "Add & fetch" : `Add & fetch (${selection.length})`;

  return (
    <div className="overlay-backdrop">
      <div ref={dialog} className="add-dialog card" role="dialog" aria-modal="true" aria-label={TITLE[mode]}>
        <div className="add-head">
          <h2>{TITLE[mode]}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <IconClose />
          </button>
        </div>
        {mode === "friends" && (
          <>
            <div className="probe-row">
              <div className="field">
                <label htmlFor="add-group">Friend group</label>
                <select
                  id="add-group"
                  value={String(groupId)}
                  onChange={(e) => {
                    const v = e.target.value === "all" ? "all" : Number(e.target.value);
                    setGroupId(v);
                    onGroup(v === "all" ? null : v);
                    setFriendTicks(new Set((friends.data?.friends ?? []).filter((f) => v === "all" || f.groupId === v).map((f) => f.puuid)));
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
            {friends.state !== "loading" && friends.state !== "idle" && shownFriends.length === 0 && <p className="muted">No friends to show. Is the League Client running?</p>}
            <ul className="pick-list">{shownFriends.map((f) => tickRow(friendTicks.has(f.puuid), () => toggle(friendTicks, setFriendTicks, f.puuid), f.puuid, `${f.gameName}#${f.tagLine}`))}</ul>
          </>
        )}
        {mode === "recent" && (
          <>
            <div className="probe-row">
              <div className="field">
                <label htmlFor="add-recent-search">Search recent players</label>
                <input id="add-recent-search" type="search" placeholder="Name" value={recentQuery} onChange={(e) => setRecentQuery(e.target.value)} />
              </div>
              <button type="button" className="btn ghost" onClick={() => setRecentTicks(new Set(shownRecent.map((r) => r.puuid)))}>
                Select shown
              </button>
              <button type="button" className="btn ghost" onClick={() => setRecentTicks(new Set())}>
                None
              </button>
            </div>
            {recent.state === "loading" && !recent.data && <p className="muted">Loading recent players…</p>}
            {recent.state !== "loading" && recent.state !== "idle" && shownRecent.length === 0 && <p className="muted">No recent players to show.</p>}
            <ul className="pick-list">{shownRecent.map((r) => tickRow(recentTicks.has(r.puuid), () => toggle(recentTicks, setRecentTicks, r.puuid), r.puuid, `${r.gameName}#${r.tagLine}`))}</ul>
          </>
        )}
        {mode === "riotIds" && (
          <>
            <div className="field" data-invalid={riotBad || undefined}>
              <label htmlFor="add-riot">Riot IDs, one per line (name#tag)</label>
              <textarea
                id="add-riot"
                className="riot-input"
                rows={4}
                spellCheck={false}
                autoFocus
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
              {busy && <span role="status">Looking up…</span>}
              {riotBad && <span className="hint error">Fix the lines marked red first.</span>}
              {riotLines.length >= 30 && <span className="hint">At most 30 lines.</span>}
            </div>
          </>
        )}
        <div className="add-actions">
          <button type="button" className="btn primary" disabled={!canAdd} onClick={() => void addAndFetch()}>
            {addLabel}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            {riotResults ? "Close" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}
