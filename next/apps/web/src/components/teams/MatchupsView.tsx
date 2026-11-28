import { useMemo, useRef, useState } from "react";
import { deleteMatchup, matchupDiscordText, newestFirst, renameMatchup, scoreProposal, type BalancePlayer, type SavedMatchup, type TeamPlayerPref } from "@lol-viewer/core";
import { LANES, type TeamsState } from "@lol-viewer/protocol";
import { useSettings } from "../../state/settings.tsx";
import { IconCopy, IconMore } from "../../ui/icons.tsx";
import { LANE_LABEL } from "../../ui/labels.ts";
import { NameDialog } from "./NameDialog.tsx";
import { balancePlayerOf, lanesOf, rankLabelOf } from "./model.ts";
import { dateLabel } from "./RosterManager.tsx";
import { MenuButton } from "./Popover.tsx";

const PRIORITY_TEXT = { rankFirst: "Rank priority", laneFirst: "Lanes priority" } as const;

export type MatchupsViewProps = {
  state: TeamsState;
  now: number;
  prefs: Record<string, TeamPlayerPref>;
  notify: (text: string, kind?: "info" | "success" | "warn") => void;
  onOpen: (m: SavedMatchup) => void;
  /** Stories / tests. */
  initial?: { menuId?: string; query?: string };
};

/** Matchups: the splits saved with ☆ Save, newest first, as cards (M-042). */
export function MatchupsView({ state, now, prefs, notify, onOpen, initial }: MatchupsViewProps) {
  const { settings, update } = useSettings();
  const all = settings.teamMatchups;
  const [query, setQuery] = useState(initial?.query ?? "");
  const [renaming, setRenaming] = useState<SavedMatchup | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [manual, setManual] = useState<{ id: string; text: string } | null>(null);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const q = query.trim().toLowerCase();
  const rows = useMemo(
    () => newestFirst(all).filter((m) => !q || m.name.toLowerCase().includes(q) || Object.values(m.people).some((p) => p.gameName.toLowerCase().includes(q))),
    [all, q],
  );

  const copy = async (m: SavedMatchup) => {
    const mains: Record<string, ReturnType<typeof lanesOf>["mains"][number] | null> = {};
    for (const s of [...m.blue, ...m.red]) mains[s.puuid] = lanesOf(state.players[s.puuid], prefs[s.puuid]).mains[0] ?? null;
    const text = matchupDiscordText(m, { withRank: settings.teams.discordWithRank, withTag: settings.teams.discordWithTag, mains });
    try {
      await navigator.clipboard.writeText(text);
      setManual(null);
      notify("Copied to clipboard", "success");
    } catch {
      setManual({ id: m.id, text });
    }
  };

  return (
    <section className="card matchups" aria-label="Matchups">
      <div className="people-bar">
        <h2 className="matchups-title">Saved matchups</h2>
        <span className="spacer" />
        {all.length > 0 && <input type="search" className="matchup-search" aria-label="Search matchups" placeholder="Search name or player" value={query} onChange={(e) => setQuery(e.target.value)} />}
      </div>
      {all.length === 0 ? (
        <p className="muted" data-testid="matchups-empty">
          Save a proposal in Match with ☆ Save.
        </p>
      ) : rows.length === 0 ? (
        <p className="muted">No matchup matches “{query}”.</p>
      ) : (
        <ul className="matchup-grid">
          {rows.map((m) => (
            <MatchupCard
              key={m.id}
              m={m}
              state={state}
              now={now}
              prefs={prefs}
              armed={armed === m.id}
              manual={manual?.id === m.id ? manual.text : null}
              menuOpen={initial?.menuId === m.id}
              onCopy={() => void copy(m)}
              onOpen={() => onOpen(m)}
              onRename={() => setRenaming(m)}
              onMenuClose={() => setArmed((a) => (a === m.id ? null : a))}
              onDelete={() => {
                if (armed !== m.id) return setArmed(m.id);
                setArmed(null);
                update({ teamMatchups: deleteMatchup(all, m.id) });
                notify(`Deleted “${m.name}”`, "info");
              }}
            />
          ))}
        </ul>
      )}
      <div ref={setHost} />
      {renaming && (
        <NameDialog
          host={host}
          title="Rename matchup"
          label="Matchup name"
          initial={renaming.name}
          list={all}
          selfId={renaming.id}
          mode="rename"
          confirm="Rename"
          onClose={() => setRenaming(null)}
          onSubmit={(name) => {
            update({ teamMatchups: renameMatchup(all, renaming.id, name) });
            setRenaming(null);
          }}
        />
      )}
    </section>
  );
}

function MatchupCard({
  m,
  state,
  now,
  prefs,
  armed,
  manual,
  menuOpen,
  onCopy,
  onOpen,
  onRename,
  onMenuClose,
  onDelete,
}: {
  m: SavedMatchup;
  state: TeamsState;
  now: number;
  prefs: Record<string, TeamPlayerPref>;
  armed: boolean;
  manual: string | null;
  menuOpen: boolean;
  onCopy: () => void;
  onOpen: () => void;
  onRename: () => void;
  /** The ⋯ menu closed: a Delete that was waiting for its second click is cancelled. */
  onMenuClose: () => void;
  onDelete: () => void;
}) {
  const laned = [...m.blue, ...m.red].every((s) => s.lane !== null);
  const rows = laned
    ? LANES.map((lane) => ({ label: LANE_LABEL[lane], blue: m.blue.find((s) => s.lane === lane), red: m.red.find((s) => s.lane === lane) }))
    : m.blue.map((b, i) => ({ label: "", blue: b, red: m.red[i] }));
  const everyoneKnown = [...m.blue, ...m.red].every((s) => state.players[s.puuid]);
  // The difference with today's ranks (and manual settings); not shown when somebody is gone from People.
  const diff = useMemo(() => {
    if (!everyoneKnown) return null;
    const bp: BalancePlayer[] = [...m.blue, ...m.red].map((s) => balancePlayerOf(s.puuid, state.players[s.puuid], prefs[s.puuid], now));
    return Math.round(scoreProposal({ blue: m.blue, red: m.red }, bp, m.priority).rankDiff);
  }, [everyoneKnown, m, state.players, prefs, now]);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const cell = (slot: SavedMatchup["blue"][number] | undefined, side: "blue" | "red") => {
    if (!slot) return <td />;
    const saved = m.people[slot.puuid];
    const person = state.players[slot.puuid];
    const nowLabel = person ? rankLabelOf(person, prefs[slot.puuid], now) : null;
    const changed = nowLabel !== null && nowLabel !== saved?.rankLabel;
    return (
      <td className={`slot-cell ${side}`} data-puuid={slot.puuid}>
        <div className="slot-btn slot-static">
          <span className="slot-name">{saved?.gameName ?? "?"}</span>
          <span className="slot-rank" data-unknown={saved?.rankLabel === "—" || undefined}>
            {saved?.rankLabel ?? "—"}
          </span>
          {changed && (
            <span className="slot-now" title="Rank now" data-testid="rank-changed">
              → {nowLabel}
            </span>
          )}
        </div>
      </td>
    );
  };
  return (
    <li className="matchup-card card" data-id={m.id} aria-label={m.name}>
      <div className="matchup-head">
        <h3>{m.name}</h3>
        <span className="muted small">
          {dateLabel(m.savedAt)} · {PRIORITY_TEXT[m.priority]}
        </span>
        <span className="spacer" />
        <MenuButton
          label={`More for ${m.name}`}
          trigger={<IconMore />}
          initialOpen={menuOpen}
          onClose={onMenuClose}
          items={[
            { label: "Rename", onSelect: onRename },
            { label: armed ? "Click again to delete" : "Delete", danger: true, keepOpen: !armed, onSelect: onDelete, separatorBefore: true },
          ]}
        />
      </div>
      <table className="proposal-table" aria-label={`Teams of ${m.name}`} data-laned={laned}>
        <thead>
          <tr>
            <th className="lane-col" />
            <th className="blue">Blue</th>
            <th className="red">Red</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} data-lane={laned ? LANES[i] : undefined}>
              <th scope="row" className="lane-col">
                {r.label}
              </th>
              {cell(r.blue, "blue")}
              {cell(r.red, "red")}
            </tr>
          ))}
        </tbody>
      </table>
      {diff !== null && (
        <p className="proposal-diff small" data-testid="matchup-diff">
          Rank diff now {diff}
        </p>
      )}
      <div className="probe-row matchup-actions">
        <button type="button" className="btn" onClick={onCopy}>
          <IconCopy /> Copy for Discord
        </button>
        <button type="button" className="btn primary" onClick={onOpen}>
          Open in Match
        </button>
        {manual !== null && <span role="status">Press Ctrl+C to copy.</span>}
      </div>
      {manual !== null && <textarea ref={(el) => el?.select()} className="discord-text" aria-label={`Discord text of ${m.name}`} readOnly spellCheck={false} rows={Math.min(9, manual.split("\n").length)} value={manual} />}
    </li>
  );
}
