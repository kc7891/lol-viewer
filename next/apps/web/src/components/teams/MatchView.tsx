import { useMemo, useRef, useState } from "react";
import { effectiveRank, rankLabel, type BalancePlayer, type BalanceView, type TeamPlayerPref } from "@lol-viewer/core";
import type { TeamsState } from "@lol-viewer/protocol";
import { IconPlus } from "../../ui/icons.tsx";
import { balancePlayerOf, byName, lanesOf, membershipOf, type Candidate, type Membership } from "./model.ts";
import { useDismiss } from "./Popover.tsx";
import { PlayerRow } from "./PlayerRow.tsx";
import { ProposalPanel, type PersonInfo } from "./ProposalPanel.tsx";

export type MatchViewProps = {
  state: TeamsState;
  now: number;
  prefs: Record<string, TeamPlayerPref>;
  /** Sorted: team slots, spectators, added people. */
  candidates: Candidate[];
  moved: Record<string, Membership>;
  notify: (text: string, kind?: "info" | "success" | "warn") => void;
  onToggle: (puuid: string, playing: boolean) => void;
  onPref: (puuid: string, pref: TeamPlayerPref) => void;
  onRank: (puuid: string, points: number | null) => void;
  onRefresh: (puuid: string) => void;
  onAdd: (puuid: string) => void;
  onRemove: (puuid: string) => void;
  /** Stories / tests. */
  initial?: { priority?: BalanceView; preview?: boolean; addOpen?: boolean; rankOpen?: string };
};

/** Match: who plays (one list, a checkbox each), and the proposals for them. */
export function MatchView({ state, now, prefs, candidates, moved, notify, onToggle, onPref, onRank, onRefresh, onAdd, onRemove, initial }: MatchViewProps) {
  const { players, lobby } = state;
  const playing = useMemo(() => candidates.filter((c) => membershipOf(c, moved) === "in"), [candidates, moved]);
  const fetching = new Set(state.fetching);

  const balancePlayers: BalancePlayer[] = useMemo(() => playing.map((c) => balancePlayerOf(c.puuid, players[c.puuid], prefs[c.puuid], now)), [playing, players, prefs, now]);
  const info = useMemo(() => {
    const out: Record<string, PersonInfo> = {};
    for (const c of playing) {
      const p = players[c.puuid];
      const eff = effectiveRank(p, prefs[c.puuid], now);
      out[c.puuid] = {
        name: { gameName: p?.gameName || "?", tagLine: p?.tagLine ?? "" },
        rank: { label: eff ? rankLabel(eff.points, eff.source) : "—", points: eff?.points ?? null, source: eff?.source },
        main: lanesOf(p, prefs[c.puuid]).mains[0] ?? null,
      };
    }
    return out;
  }, [playing, players, prefs, now]);

  const n = playing.length;
  const countOk = n === 6 || n === 8 || n === 10;
  const people = candidates.filter((c) => c.origin !== "added").length;
  return (
    <div className="teams-grid">
      <div className="teams-left">
        <div className="lobby-row">
          <p className="lobby-line" data-testid="lobby-line">
            {lobby ? `Custom lobby · ${people} people` : "Not in a custom lobby. Add people from your saved list, or enter a custom lobby."}
          </p>
          {fetching.size > 0 && (
            <span className="muted" role="status" data-testid="fetching-line">
              Fetching {fetching.size} {fetching.size === 1 ? "person" : "people"} …
            </span>
          )}
        </div>
        <section className="card team-list" aria-label="Players">
          <div className="list-head">
            <h2>
              Players {n} of {candidates.length}
            </h2>
            {!countOk && (
              <span className="warn-text" data-testid="count-hint">
                Pick 6, 8 or 10
              </span>
            )}
          </div>
          {candidates.length === 0 ? (
            <p className="muted">Nobody yet.</p>
          ) : (
            <ul>
              {candidates.map((c) => (
                <PlayerRow
                  key={c.puuid}
                  puuid={c.puuid}
                  player={players[c.puuid]}
                  pref={prefs[c.puuid]}
                  origin={c.origin}
                  playing={membershipOf(c, moved) === "in"}
                  fetching={fetching.has(c.puuid)}
                  now={now}
                  onToggle={(on) => onToggle(c.puuid, on)}
                  onPref={(pref) => onPref(c.puuid, pref)}
                  onRank={(points) => onRank(c.puuid, points)}
                  onRefresh={() => onRefresh(c.puuid)}
                  onRemove={c.origin === "added" ? () => onRemove(c.puuid) : undefined}
                  initialRankOpen={initial?.rankOpen === c.puuid}
                />
              ))}
            </ul>
          )}
          <AddPeople state={state} now={now} listed={new Set(candidates.map((c) => c.puuid))} prefs={prefs} onAdd={onAdd} initialOpen={initial?.addOpen} />
        </section>
      </div>
      <ProposalPanel players={balancePlayers} info={info} notify={notify} initialPriority={initial?.priority} initialPreview={initial?.preview} />
    </div>
  );
}

/** "+ Add people": pick from the people saved in People (search). They join the list and play. */
function AddPeople({ state, now, listed, prefs, onAdd, initialOpen = false }: { state: TeamsState; now: number; listed: ReadonlySet<string>; prefs: Record<string, TeamPlayerPref>; onAdd: (puuid: string) => void; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const [query, setQuery] = useState("");
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useDismiss(open, wrap, () => setOpen(false), btn);
  const q = query.trim().toLowerCase();
  const saved = Object.values(state.players).filter((p) => !listed.has(p.puuid));
  const rows = saved.filter((p) => !q || `${p.gameName}#${p.tagLine}`.toLowerCase().includes(q)).sort((a, b) => byName(a, b, a.puuid, b.puuid));
  return (
    <div className="add-people" ref={wrap}>
      <button ref={btn} type="button" className="btn" aria-expanded={open} aria-controls="add-people-panel" onClick={() => setOpen((o) => !o)}>
        <IconPlus /> Add people
      </button>
      {open && (
        <div id="add-people-panel" className="add-people-panel" role="group" aria-label="Add saved people">
          <div className="field">
            <label htmlFor="add-people-search">Search saved people</label>
            <input id="add-people-search" type="search" autoFocus placeholder="Name" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {saved.length === 0 ? (
            <p className="muted">{Object.keys(state.players).length === 0 ? "Nobody is saved yet. Use People › Add to save people." : "Everybody saved is already on the list."}</p>
          ) : rows.length === 0 ? (
            <p className="muted">No match for “{query}”.</p>
          ) : (
            <ul className="add-people-list">
              {rows.map((p) => {
                const eff = effectiveRank(p, prefs[p.puuid], now);
                return (
                  <li key={p.puuid}>
                    <button type="button" className="add-person" aria-label={`Add ${p.gameName}`} onClick={() => onAdd(p.puuid)}>
                      <span className="pname">{p.gameName || "Unknown"}</span>
                      <span className="ptag">{p.tagLine && `#${p.tagLine}`}</span>
                      <span className="muted">{eff ? rankLabel(eff.points, eff.source) : "—"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
