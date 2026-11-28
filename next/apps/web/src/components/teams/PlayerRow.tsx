import type { TeamPlayerPref } from "@lol-viewer/core";
import type { TeamPlayer } from "@lol-viewer/protocol";
import { IconMore } from "../../ui/icons.tsx";
import { LaneChips } from "./LaneChips.tsx";
import { freshClass, type Origin } from "./model.ts";
import { MenuButton, type MenuItem } from "./Popover.tsx";
import { RankBadge } from "./RankBadge.tsx";

export type PlayerRowProps = {
  puuid: string;
  player: TeamPlayer | undefined;
  pref: TeamPlayerPref | undefined;
  origin: Origin;
  playing: boolean;
  fetching: boolean;
  now: number;
  onToggle: (playing: boolean) => void;
  onPref: (pref: TeamPlayerPref) => void;
  onRank: (points: number | null) => void;
  onRefresh: () => void;
  /** People added by hand can be taken off the list (lobby members cannot). */
  onRemove?: () => void;
  initialRankOpen?: boolean;
};

const ORIGIN_NOTE: Record<Origin, string> = { team: "", spectator: "Spectator", added: "Added" };

/** One line of the Match list: checkbox (plays or not), name, rank badge, lane chips, flags, menu. */
export function PlayerRow({ puuid, player, pref, origin, playing, fetching, now, onToggle, onPref, onRank, onRefresh, onRemove, initialRankOpen }: PlayerRowProps) {
  const name = player?.gameName || "Loading…";
  const rankFresh = player?.rank ? freshClass(player.rank.fetchedAt, now) : "none";
  const items: MenuItem[] = [{ label: "Fetch again", onSelect: onRefresh }, ...(onRemove ? [{ label: "Remove from this list", onSelect: onRemove }] : [])];
  return (
    <li className="team-row" data-puuid={puuid} data-playing={playing || undefined}>
      <input type="checkbox" className="team-check" checked={playing} aria-label={`Include ${name}`} onChange={(e) => onToggle(e.target.checked)} />
      <span className="pname-cell">
        <span className="pname">{name}</span>
        {player?.tagLine && <span className="ptag">#{player.tagLine}</span>}
        {ORIGIN_NOTE[origin] && <span className="origin-note">{ORIGIN_NOTE[origin]}</span>}
      </span>
      <RankBadge name={name} player={player} pref={pref} now={now} onChange={onRank} initialOpen={initialRankOpen} />
      <LaneChips name={name} pref={pref} player={player} onChange={onPref} />
      <span className="row-flags">
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
      <MenuButton label={`More for ${name}`} trigger={<IconMore />} items={items} />
    </li>
  );
}
