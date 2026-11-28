import { useEffect, useMemo, useState } from "react";
import { defaultRosterName, effectiveRank, newestFirst, rankLabel, ROSTER_PUUIDS_MAX, upsertRoster, type BalancePlayer, type BalanceView, type SavedRoster, type TeamPlayerPref } from "@lol-viewer/core";
import type { TeamsState } from "@lol-viewer/protocol";
import { useSettings } from "../../state/settings.tsx";
import { IconChevron, IconPlus } from "../../ui/icons.tsx";
import { Modal } from "./Modal.tsx";
import { NameDialog } from "./NameDialog.tsx";
import { RosterManager } from "./RosterManager.tsx";
import { balancePlayerOf, byName, lanesOf, membershipOf, sameSet, type Candidate, type LoadedRoster, type Membership, type SavedOpen } from "./model.ts";
import { MenuButton, type MenuItem } from "./Popover.tsx";
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
  /** Rosters ▾ › a saved roster: TeamsPage puts it into the checks. */
  onLoadRoster: (roster: SavedRoster) => void;
  loadedRoster: LoadedRoster | null;
  /** A saved matchup opened from Matchups; cleared by Reset, by changing the people, or by choosing another proposal. */
  openedMatchup: SavedOpen | null;
  onClearOpened: () => void;
  /** Stories / tests. */
  initial?: { priority?: BalanceView; preview?: boolean; addOpen?: boolean; rankOpen?: string; rosters?: "menu" | "save" | "manage"; saveMatchup?: boolean; rosterEditing?: string };
};

/** Match: who plays (one list, a checkbox each), and the proposals for them. */
export function MatchView({ state, now, prefs, candidates, moved, notify, onToggle, onPref, onRank, onRefresh, onAdd, onRemove, onLoadRoster, loadedRoster, openedMatchup, onClearOpened, initial }: MatchViewProps) {
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
  // The Add people dialog is rendered here: outside the Players section, but inside the Match panel so it hides with the page (M-041).
  const [modalHost, setModalHost] = useState<HTMLDivElement | null>(null);
  const playingIds = useMemo(() => playing.map((c) => c.puuid), [playing]);
  const edited = loadedRoster !== null && !sameSet(playingIds, loadedRoster.applied);
  // A saved matchup stays on screen only while exactly its people play.
  const openedIds = openedMatchup ? [...openedMatchup.blue, ...openedMatchup.red].map((s) => s.puuid) : null;
  const openedOk = openedMatchup !== null && openedIds !== null && sameSet(playingIds, openedIds);
  useEffect(() => {
    if (openedMatchup && !openedOk) onClearOpened();
  }, [openedMatchup, openedOk, onClearOpened]);
  return (
    <>
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
              <span className="spacer" />
              <Rosters playingIds={playingIds} onLoad={onLoadRoster} host={modalHost} initial={initial?.rosters} editing={initial?.rosterEditing} />
            </div>
            {loadedRoster && (
              <p className="roster-line small muted" data-testid="roster-line">
                Roster: {loadedRoster.name}
                {edited && " (edited)"}
              </p>
            )}
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
            <AddPeople state={state} now={now} listed={new Set(candidates.map((c) => c.puuid))} prefs={prefs} onAdd={onAdd} initialOpen={initial?.addOpen} host={modalHost} />
          </section>
        </div>
        <ProposalPanel
          players={balancePlayers}
          info={info}
          notify={notify}
          initialPriority={initial?.priority}
          initialPreview={initial?.preview}
          modalHost={modalHost}
          saved={openedOk ? openedMatchup : null}
          onClearSaved={onClearOpened}
          initialSaveOpen={initial?.saveMatchup}
        />
      </div>
      <div ref={setModalHost} />
    </>
  );
}

const tooManyText = (n: number) => `Rosters hold up to ${ROSTER_PUUIDS_MAX} people (${n} are checked). Uncheck some first.`;

/** Rosters ▾: save the people who play as a named roster, load one back, or manage them (M-042). */
function Rosters({ playingIds, onLoad, host, initial, editing }: { playingIds: string[]; onLoad: (r: SavedRoster) => void; host: HTMLElement | null; initial?: "menu" | "save" | "manage"; editing?: string }) {
  const { settings, update } = useSettings();
  const rosters = settings.teamRosters;
  const [dialog, setDialog] = useState<"save" | "manage" | null>(initial === "save" || initial === "manage" ? initial : null);
  const recent = newestFirst(rosters).slice(0, 10);
  const tooMany = playingIds.length > ROSTER_PUUIDS_MAX;
  const items: MenuItem[] = [
    { label: "Save current as…", onSelect: () => setDialog("save"), disabled: playingIds.length === 0 || tooMany, note: tooMany ? tooManyText(playingIds.length) : undefined },
    ...(recent.length === 0
      ? [{ label: "No saved rosters yet", onSelect: () => {}, disabled: true, separatorBefore: true } satisfies MenuItem]
      : recent.map((r, i): MenuItem => ({ label: `${r.name} · ${r.puuids.length} people`, onSelect: () => onLoad(r), separatorBefore: i === 0 }))),
    { label: "Manage rosters…", onSelect: () => setDialog("manage"), separatorBefore: true, disabled: rosters.length === 0 },
  ];
  return (
    <>
      <MenuButton label="Rosters" title="Save the checked people, or load a saved roster" className="btn" align="right" initialOpen={initial === "menu"} trigger={<>Rosters <IconChevron size={12} /></>} items={items} />
      {dialog === "save" && (
        <NameDialog
          host={host}
          title="Save roster"
          label="Roster name"
          initial={defaultRosterName(Date.now())}
          list={rosters}
          mode="save"
          problem={tooMany ? tooManyText(playingIds.length) : undefined}
          hint={`${playingIds.length} ${playingIds.length === 1 ? "person" : "people"} who are checked now.`}
          onClose={() => setDialog(null)}
          onSubmit={(name) => {
            const r = upsertRoster(rosters, { name, puuids: playingIds }, Date.now());
            if (r.item) update({ teamRosters: r.list });
            setDialog(null);
          }}
        />
      )}
      {dialog === "manage" && <RosterManager host={host} rosters={rosters} onChange={(next) => update({ teamRosters: next })} onClose={() => setDialog(null)} now={Date.now} initialEditing={editing} />}
    </>
  );
}

/**
 * "+ Add people": pick from the people saved in People (search). They join the list and play.
 * A modal over the page (M-041), so the list of players does not move while people are added; it stays open for several picks.
 */
function AddPeople({ state, now, listed, prefs, onAdd, initialOpen = false, host }: { state: TeamsState; now: number; listed: ReadonlySet<string>; prefs: Record<string, TeamPlayerPref>; onAdd: (puuid: string) => void; initialOpen?: boolean; host: HTMLElement | null }) {
  const [open, setOpen] = useState(initialOpen);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const saved = Object.values(state.players).filter((p) => !listed.has(p.puuid));
  const rows = saved.filter((p) => !q || `${p.gameName}#${p.tagLine}`.toLowerCase().includes(q)).sort((a, b) => byName(a, b, a.puuid, b.puuid));
  const close = () => {
    setOpen(false);
    setQuery("");
  };
  return (
    <div className="add-people">
      <button type="button" className="btn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <IconPlus /> Add people
      </button>
      {open && (
        <Modal host={host} label="Add saved people" title="Add people" onClose={close} className="add-people-panel">
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
          <div className="add-actions">
            <button type="button" className="btn primary" onClick={close}>
              Done
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
