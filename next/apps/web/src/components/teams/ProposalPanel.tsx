import { useEffect, useMemo, useRef, useState } from "react";
import { balanceTeams, formatForDiscord, rankLabel, scoreProposal, type BalancePlayer, type BalanceView, type DiscordName, type DiscordRank, type Proposal, type Slot } from "@lol-viewer/core";
import { LANES, type Lane } from "@lol-viewer/protocol";
import { useSettings } from "../../state/settings.tsx";
import { IconBack, IconChevron, IconCopy, IconForward } from "../../ui/icons.tsx";
import { LANE_LABEL, LANE_SHORT } from "../../ui/labels.ts";
import { overLockedLane, tooManyLocksText } from "./model.ts";
import { MenuButton } from "./Popover.tsx";
export type PersonInfo = { name: DiscordName; rank: DiscordRank & { source?: string }; main: Lane | null };

export type ProposalPanelProps = {
  players: BalancePlayer[];
  /** Name, rank and main lane per player (for the table and the Discord text). */
  info: Record<string, PersonInfo | undefined>;
  notify: (text: string, kind?: "info" | "success" | "warn") => void;
  /** Stories / tests. */
  initialPriority?: BalanceView;
  initialPreview?: boolean;
};

const PRIORITY: Record<BalanceView, { en: string; ja: string }> = {
  rankFirst: { en: "Rank", ja: "ランク重視" },
  laneFirst: { en: "Lanes", ja: "レーン重視" },
};
const sig = (p: Proposal | undefined) => (p ? [...p.blue, ...p.red].map((s) => `${s.puuid}:${s.lane}`).join(",") : "");
type Edit = { blue: Slot[]; red: Slot[] };

/** The proposals, one at a time: Priority (Rank / Lanes), ◀ n / N ▶, a swap by hand (then "Edited" and Reset), Copy for Discord with a Preview. */
export function ProposalPanel({ players: given, info, notify, initialPriority = "rankFirst", initialPreview = false }: ProposalPanelProps) {
  const { settings, update } = useSettings();
  // main pushes a new state object about every 200 ms while it fetches: only a real change starts the proposals over.
  const content = JSON.stringify(given);
  const players = useMemo(() => given, [content]); // eslint-disable-line react-hooks/exhaustive-deps
  const result = useMemo(() => balanceTeams(players), [players]);
  const [view, setView] = useState<BalanceView>(initialPriority);
  const [cur, setCur] = useState(0);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [pick, setPick] = useState<string | null>(null);
  const [copy, setCopy] = useState<"copied" | "manual" | null>(null);
  const [preview, setPreview] = useState(initialPreview);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // New people, ranks or settings: the proposals are new, so start from the best again.
  useEffect(() => {
    setCur(0);
    setEdits({});
    setPick(null);
    setCopy(null);
  }, [result]);

  const list = result[view];
  const index = Math.min(cur, Math.max(0, list.length - 1));
  const base = list[index];
  const key = `${view}:${index}`;
  const edit = edits[key];
  const shown = useMemo(() => (base ? (edit ? scoreProposal(edit, players, view) : base) : undefined), [base, edit, players, view]);
  const sameTop = sig(result.rankFirst[0]) !== "" && sig(result.rankFirst[0]) === sig(result.laneFirst[0]);

  const { discordWithRank: withRank, discordWithTag: withTag } = settings.teams;
  const text = useMemo(() => {
    if (!shown) return "";
    const names: Record<string, DiscordName> = {};
    const ranks: Record<string, DiscordRank> = {};
    const mains: Record<string, Lane | null> = {};
    for (const [id, i] of Object.entries(info)) {
      if (!i) continue;
      names[id] = i.name;
      ranks[id] = i.rank;
      mains[id] = i.main;
    }
    const title = `チーム分け案（${PRIORITY[view].ja} ${index + 1}${edit ? "・入れ替え後" : ""}）`;
    return formatForDiscord(shown, names, ranks, { title, withRank, withTag, mains });
  }, [shown, info, view, index, edit, withRank, withTag]);
  useEffect(() => setCopy(null), [text]);
  // The browser refused to copy: the text is shown and selected, so Ctrl+C works.
  useEffect(() => {
    if (copy === "manual") textRef.current?.select();
  }, [copy, preview]);

  const setTeams = (patch: Partial<typeof settings.teams>) => update({ teams: { ...settings.teams, ...patch } });
  const switchView = (v: BalanceView) => {
    setView(v);
    setCur(0);
    setPick(null);
  };
  const step = (d: number) => {
    setCur((c) => (Math.min(c, list.length - 1) + d + list.length) % list.length);
    setPick(null);
  };
  const choose = (puuid: string) => {
    if (!base) return;
    if (pick === null) return setPick(puuid);
    if (pick === puuid) return setPick(null);
    const swap = (slots: Slot[]) => slots.map((s) => (s.puuid === pick ? { ...s, puuid } : s.puuid === puuid ? { ...s, puuid: pick } : s));
    const from = edit ?? { blue: base.blue, red: base.red };
    setEdits({ ...edits, [key]: { blue: swap(from.blue), red: swap(from.red) } });
    setPick(null);
  };
  const resetEdit = () => {
    const { [key]: _gone, ...rest } = edits;
    setEdits(rest);
    setPick(null);
  };
  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopy("copied");
      notify("Copied to clipboard", "success");
    } catch {
      setPreview(true);
      setCopy("manual");
    }
  };

  const lockedLane = overLockedLane(players);
  const problem =
    result.error === "count"
      ? `Pick 6, 8 or 10 players (now ${players.length}).`
      : result.error === "locks"
        ? lockedLane
          ? tooManyLocksText(lockedLane)
          : "These locked lanes cannot all be kept."
        : null;

  return (
    <section className="card teams-proposals" aria-label="Proposals">
      <div className="proposal-head">
        <h2>Proposal</h2>
        {!problem && (
          <>
            <div className="prio" role="group" aria-label="Priority">
              <span className="prio-label">Priority</span>
              <div className="seg">
                {(["rankFirst", "laneFirst"] as const).map((v) => (
                  <button key={v} type="button" aria-pressed={view === v} onClick={() => switchView(v)}>
                    {PRIORITY[v].en}
                  </button>
                ))}
              </div>
            </div>
            <span className="spacer" />
            <div className="proposal-nav" role="group" aria-label="Proposal">
              <button type="button" className="icon-btn" aria-label="Previous proposal" disabled={list.length < 2} onClick={() => step(-1)}>
                <IconBack />
              </button>
              {edit ? (
                <span className="proposal-count" data-testid="proposal-count" data-edited>
                  Edited
                </span>
              ) : (
                <span className="proposal-count" data-testid="proposal-count">
                  {index + 1} / {list.length}
                </span>
              )}
              <button type="button" className="icon-btn" aria-label="Next proposal" disabled={list.length < 2} onClick={() => step(1)}>
                <IconForward />
              </button>
              {edit && (
                <button type="button" className="btn ghost" onClick={resetEdit}>
                  Reset
                </button>
              )}
            </div>
          </>
        )}
      </div>
      {problem && (
        <p className="proposal-problem" role="status" data-testid="proposal-problem">
          {problem}
        </p>
      )}
      {!problem && shown && (
        <>
          {sameTop && index === 0 && !edit && <p className="muted small same-top">Same as {PRIORITY[view === "rankFirst" ? "laneFirst" : "rankFirst"].en} priority</p>}
          <ProposalTable proposal={shown} info={info} pick={pick} onPick={choose} />
          <p className="proposal-diff" data-testid="proposal-diff">
            <span>Rank diff {Math.round(shown.rankDiff)}</span>
            {shown.maxMatchupDiff !== null && <span> · lane gap {Math.round(shown.maxMatchupDiff)}</span>}
            {shown.brokenNg > 0 && (
              <span className="warn-text">
                {" "}
                · ⚠ {shown.brokenNg} avoided lane{shown.brokenNg > 1 ? "s" : ""}
              </span>
            )}
            {shown.unknownRanks > 0 && (
              <span className="warn-text">
                {" "}
                · ⚠ {shown.unknownRanks} unknown rank{shown.unknownRanks > 1 ? "s" : ""}
              </span>
            )}
          </p>
          <p className="hint small">{pick ? "Pick the second player to swap with." : "To swap two players, click one and then the other."}</p>
          <div className="discord-box">
            <div className="probe-row">
              <button type="button" className="btn primary" onClick={() => void doCopy()}>
                <IconCopy /> Copy for Discord
              </button>
              <MenuButton
                label="Discord options"
                title="Discord options"
                className="icon-btn"
                align="left"
                trigger={<IconChevron />}
                items={[
                  { label: "Show ranks", checked: withRank, onSelect: () => setTeams({ discordWithRank: !withRank }) },
                  { label: "Show #tag", checked: withTag, onSelect: () => setTeams({ discordWithTag: !withTag }) },
                  { label: "Preview", checked: preview, onSelect: () => setPreview(!preview), separatorBefore: true },
                ]}
              />
              {copy === "copied" && <span role="status">Copied.</span>}
              {copy === "manual" && <span role="status">Press Ctrl+C to copy.</span>}
            </div>
            {preview && <textarea ref={textRef} className="discord-text" aria-label="Discord text" readOnly spellCheck={false} rows={Math.min(9, text.split("\n").length)} value={text} />}
          </div>
        </>
      )}
      {!problem && !shown && <p className="muted">No proposal yet.</p>}
    </section>
  );
}

function avgLabel(slots: Slot[], info: ProposalPanelProps["info"]): string {
  const pts = slots.map((s) => info[s.puuid]?.rank.points).filter((x): x is number => typeof x === "number");
  return pts.length ? rankLabel(pts.reduce((a, b) => a + b, 0) / pts.length, "solo") : "—";
}

function Cell({ slot, info, pick, onPick, side }: { slot: Slot | undefined; info: ProposalPanelProps["info"]; pick: string | null; onPick: (puuid: string) => void; side: "blue" | "red" }) {
  if (!slot) return <td />;
  const i = info[slot.puuid];
  return (
    <td className={`slot-cell ${side}`}>
      <button type="button" className="slot-btn" aria-pressed={pick === slot.puuid} data-puuid={slot.puuid} onClick={() => onPick(slot.puuid)}>
        <span className="slot-name">{i?.name.gameName ?? "?"}</span>
        {slot.lane === null && i?.main && <span className="slot-main">({LANE_SHORT[i.main]})</span>}
        <span className="slot-rank" data-unknown={i?.rank.points == null || undefined}>
          {i?.rank.label ?? "—"}
        </span>
      </button>
    </td>
  );
}

function ProposalTable({ proposal, info, pick, onPick }: { proposal: Proposal; info: ProposalPanelProps["info"]; pick: string | null; onPick: (puuid: string) => void }) {
  const laned = [...proposal.blue, ...proposal.red].every((s) => s.lane !== null);
  const rows = laned
    ? LANES.map((lane) => ({ label: LANE_LABEL[lane], blue: proposal.blue.find((s) => s.lane === lane), red: proposal.red.find((s) => s.lane === lane) }))
    : proposal.blue.map((b, i) => ({ label: "", blue: b, red: proposal.red[i] }));
  return (
    <table className="proposal-table" aria-label="Teams" data-laned={laned}>
      <thead>
        <tr>
          <th className="lane-col" />
          <th className="blue">Blue · avg {avgLabel(proposal.blue, info)}</th>
          <th className="red">Red · avg {avgLabel(proposal.red, info)}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} data-lane={laned ? LANES[i] : undefined}>
            <th scope="row" className="lane-col">
              {r.label}
            </th>
            <Cell slot={r.blue} info={info} pick={pick} onPick={onPick} side="blue" />
            <Cell slot={r.red} info={info} pick={pick} onPick={onPick} side="red" />
          </tr>
        ))}
      </tbody>
    </table>
  );
}
