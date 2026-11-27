import { useMemo, useState } from "react";
import { effectiveRank, rankLabel, type TeamPlayerPref } from "@lol-viewer/core";
import { LANES, type TeamPlayer } from "@lol-viewer/protocol";
import { IconChevron } from "../../ui/icons.tsx";
import { LANE_LABEL } from "../../ui/labels.ts";
import { ageLabel, entryText, freshClass, lanesOf } from "./model.ts";
import { PlayerPrefsEditor, type PrefPatch } from "./PlayerPrefs.tsx";

type SortKey = "name" | "rank" | "fetched";
const QUEUE: Record<number, string> = { 400: "Normal (Draft)", 430: "Normal (Blind)", 480: "Swiftplay", 490: "Quickplay" };
const date = (at: number) => new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export type SavedListProps = {
  players: Record<string, TeamPlayer>;
  prefs: Record<string, TeamPlayerPref>;
  fetching: ReadonlySet<string>;
  /** People already on the Players / Bench list. */
  listed: ReadonlySet<string>;
  now: number;
  onAdd: (puuid: string) => void;
  onRefresh: (puuid: string) => void;
  onForget: (puuid: string) => void;
  onPref: (puuid: string, patch: PrefPatch) => void;
  /** Stories: a row that starts open. */
  initialOpen?: string;
};

const fetchedAt = (p: TeamPlayer) => Math.max(p.rank?.fetchedAt ?? 0, p.lanes?.fetchedAt ?? 0, p.estimate?.fetchedAt ?? 0);

export function SavedList({ players, prefs, fetching, listed, now, onAdd, onRefresh, onForget, onPref, initialOpen }: SavedListProps) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("name");
  const [open, setOpen] = useState<string | null>(initialOpen ?? null);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = Object.values(players).filter((p) => !q || `${p.gameName}#${p.tagLine}`.toLowerCase().includes(q));
    const pts = (p: TeamPlayer) => effectiveRank(p, prefs[p.puuid], now)?.points ?? -1;
    return all.sort((a, b) =>
      sort === "rank" ? pts(b) - pts(a) || a.gameName.localeCompare(b.gameName) : sort === "fetched" ? fetchedAt(b) - fetchedAt(a) : a.gameName.localeCompare(b.gameName),
    );
  }, [players, prefs, query, sort, now]);

  if (Object.keys(players).length === 0) return <p className="muted saved-empty">Nobody is saved yet. People you fetch appear here.</p>;
  return (
    <div className="saved">
      <div className="probe-row saved-tools">
        <div className="field">
          <label htmlFor="saved-search">Search saved players</label>
          <input id="saved-search" type="search" placeholder="Name" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="seg" role="group" aria-label="Sort saved players">
          {(["name", "rank", "fetched"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={sort === k} onClick={() => setSort(k)}>
              {k === "name" ? "Name" : k === "rank" ? "Rank" : "Fetched"}
            </button>
          ))}
        </div>
      </div>
      <ul className="saved-list">
        {rows.map((p) => {
          const eff = effectiveRank(p, prefs[p.puuid], now);
          const lanes = lanesOf(p, prefs[p.puuid]);
          const at = fetchedAt(p);
          const f = freshClass(at || undefined, now);
          const isOpen = open === p.puuid;
          return (
            <li key={p.puuid} className="saved-row" data-puuid={p.puuid} data-open={isOpen || undefined}>
              <button type="button" className="saved-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : p.puuid)}>
                <span className="saved-chevron" data-open={isOpen || undefined}>
                  <IconChevron size={14} />
                </span>
                <span className="pname-cell">
                  <span className="pname">{p.gameName || "Unknown"}</span>
                  <span className="ptag">{p.tagLine && `#${p.tagLine}`}</span>
                </span>
                <span className="rank-chip" data-source={eff?.source ?? "none"} data-unknown={!eff || undefined}>
                  {eff ? rankLabel(eff.points, eff.source) : "—"}
                </span>
                <span className="lane-chips">{lanes.mains[0] ? <span className="lane-main">{LANE_LABEL[lanes.mains[0]]}</span> : <span className="muted">—</span>}</span>
                <span className="fetched" data-fresh={f}>
                  {fetching.has(p.puuid) ? "Fetching…" : at ? ageLabel(at, now) : "Name only"}
                </span>
                <span>{prefs[p.puuid] && <span className="pref-mark">Manual</span>}</span>
              </button>
              {isOpen && (
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
                                <span className="muted">{n} · {pct}%</span>
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
                  <h4>Manual settings</h4>
                  <PlayerPrefsEditor pref={prefs[p.puuid]} onChange={(patch) => onPref(p.puuid, patch)} />
                  <div className="card-actions">
                    <button type="button" className="btn" disabled={listed.has(p.puuid)} onClick={() => onAdd(p.puuid)}>
                      {listed.has(p.puuid) ? "On the list" : "Add to players"}
                    </button>
                    <button type="button" className="btn" onClick={() => onRefresh(p.puuid)}>
                      Refresh
                    </button>
                    <button type="button" className="btn ghost" onClick={() => onForget(p.puuid)}>
                      Forget
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {rows.length === 0 && <p className="muted">No match for “{query}”.</p>}
    </div>
  );
}
