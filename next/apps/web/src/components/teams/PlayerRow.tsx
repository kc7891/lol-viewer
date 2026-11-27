import { effectiveRank, rankLabel, type TeamPlayerPref } from "@lol-viewer/core";
import type { TeamPlayer } from "@lol-viewer/protocol";
import { IconArrowDown, IconArrowUp, IconGear, IconLock } from "../../ui/icons.tsx";
import { LANE_LABEL, LANE_SHORT } from "../../ui/labels.ts";
import { freshClass, lanesOf, rankDetails, type Membership, type Origin } from "./model.ts";
import { PlayerPrefsEditor, type PrefPatch } from "./PlayerPrefs.tsx";

export type PlayerRowProps = {
  puuid: string;
  player: TeamPlayer | undefined;
  pref: TeamPlayerPref | undefined;
  origin: Origin;
  side: Membership;
  fetching: boolean;
  now: number;
  open: boolean;
  onMove: () => void;
  onToggleOpen: () => void;
  onPref: (patch: PrefPatch) => void;
  /** People added from Saved can be taken off the list (lobby members cannot). */
  onRemove?: () => void;
};

const ORIGIN_NOTE: Record<Origin, string> = { team: "", spectator: "Spectator", added: "Added" };

export function PlayerRow({ puuid, player, pref, origin, side, fetching, now, open, onMove, onToggleOpen, onPref, onRemove }: PlayerRowProps) {
  const name = player?.gameName || "Loading…";
  const eff = effectiveRank(player, pref, now);
  const lanes = lanesOf(player, pref);
  const rankFresh = player?.rank ? freshClass(player.rank.fetchedAt, now) : "none";
  const label = eff ? rankLabel(eff.points, eff.source) : "—";
  const details = rankDetails(player, eff, now).join("\n");
  return (
    <li className="team-row" data-puuid={puuid} data-side={side}>
      <div className="team-row-main">
        <span className="pname-cell">
          <span className="pname">{name}</span>
          {player?.tagLine && <span className="ptag">#{player.tagLine}</span>}
          {ORIGIN_NOTE[origin] && <span className="origin-note">{ORIGIN_NOTE[origin]}</span>}
        </span>
        <span className="rank-chip" data-source={eff?.source ?? "none"} data-unknown={!eff || undefined} title={details}>
          {label}
        </span>
        <span className="lane-chips" title={lanes.manual ? "Preferred lanes set by hand" : lanes.thin ? "Few games counted" : "Counted from recent games"} data-manual={lanes.manual || undefined}>
          {lanes.mains.length === 0 && lanes.subs.length === 0 ? (
            <span className="muted">—</span>
          ) : (
            <>
              {lanes.mains.map((l) => (
                <span key={l} className="lane-main">
                  {LANE_SHORT[l]}
                </span>
              ))}
              {lanes.subs.map((l) => (
                <span key={l} className="lane-sub">
                  {LANE_SHORT[l]}
                </span>
              ))}
            </>
          )}
        </span>
        <span className="row-flags">
          {pref?.lock && (
            <span className="lock-flag" title={`Locked to ${LANE_LABEL[pref.lock]}`} role="img" aria-label={`Locked to ${LANE_LABEL[pref.lock]}`}>
              <IconLock size={13} />
            </span>
          )}
          {fetching && <span className="spinner" role="status" aria-label={`Fetching ${name}`} />}
          {!fetching && rankFresh === "stale" && player?.rank && (
            <span className="old-flag" title="This data is a few days old">
              old
            </span>
          )}
          {!fetching && player?.error && (
            <span className="err-flag" title={player.error}>
              !
            </span>
          )}
        </span>
        <button type="button" className="icon-btn" aria-label={`Move ${name} to ${side === "in" ? "Bench" : "Players"}`} title={side === "in" ? "Move to Bench" : "Move to Players"} onClick={onMove}>
          {side === "in" ? <IconArrowDown /> : <IconArrowUp />}
        </button>
        <button type="button" className="icon-btn" aria-label={`Settings for ${name}`} aria-expanded={open} aria-pressed={open || undefined} title="Manual settings" onClick={onToggleOpen}>
          <IconGear />
        </button>
      </div>
      {open && (
        <div className="team-row-panel">
          <PlayerPrefsEditor pref={pref} onChange={onPref} />
          {onRemove && (
            <button type="button" className="btn ghost" onClick={onRemove}>
              Remove from this list
            </button>
          )}
        </div>
      )}
    </li>
  );
}
