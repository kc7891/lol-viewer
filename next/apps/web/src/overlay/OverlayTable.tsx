import { formatGold, formatGoldDiff, getChampion, goldTrend, rowLiveDiffOf, teamLiveDiffOf } from "@lol-viewer/core";
import { LANES, type LivePlayer, type OverlayRows } from "@lol-viewer/protocol";
import { ChampionIcon } from "../components/ChampionIcon.tsx";
import { LANE_SHORT } from "../ui/labels.ts";
import "./overlay.css";

/** Size of the overlay window's content in CSS pixels; apps/desktop/src/overlay-core.ts has the same numbers. */
export const OVERLAY_SIZE = { width: 400, height: 204 } as const;

export type OverlayTableProps = {
  /** The matchup table as the main window shows it. */
  rows: OverlayRows;
  /** MatchState.live; null (no live data yet) draws nothing. */
  live: readonly LivePlayer[] | null;
};

const Cell = ({ id }: { id: number | null }) =>
  id != null && getChampion(id) ? <ChampionIcon id={id} size={26} className="ov-icon" /> : <span className="ov-icon ov-empty" aria-label="Empty" />;

/** One side of a row (M-037): its own item gold over its level, next to its icon. */
const Stat = ({ side, player }: { side: "ally" | "enemy"; player: LivePlayer | undefined }) => (
  <span className={`ov-stat ${side}`}>
    {player && (
      <>
        <span className="ov-stat-gold">{formatGold(player.itemGold)}</span>
        <span className="ov-stat-lvl">Lv {player.level}</span>
      </>
    )}
  </span>
);

/** In-game overlay (M-034): item gold and level differences per lane, and the team total. Same values as the sidebar's Matchup. */
export function OverlayTable({ rows, live }: OverlayTableProps) {
  if (!live) return null;
  const team = teamLiveDiffOf(live);
  return (
    <section className="ov-table" aria-label="Item gold differences" style={{ width: OVERLAY_SIZE.width, height: OVERLAY_SIZE.height }}>
      {rows.map((row, i) => {
        const lane = LANES[i]!;
        const diff = rowLiveDiffOf(rows, live, i);
        const ally = diff?.ally ?? live.find((p) => p.team === "ally" && row.ally != null && p.championId === row.ally);
        const enemy = diff?.enemy ?? live.find((p) => p.team === "enemy" && row.enemy != null && p.championId === row.enemy);
        return (
          <div className="ov-row" key={lane} data-lane={lane}>
            <span className="ov-lane">{LANE_SHORT[lane]}</span>
            <Cell id={row.ally} />
            <Stat side="ally" player={ally} />
            {diff ? (
              <span className="ov-gold" data-trend={goldTrend(diff.gold)} data-gold-diff={diff.gold} data-level-diff={diff.level}>
                {formatGoldDiff(diff.gold)}
              </span>
            ) : (
              <span className="ov-vs">vs</span>
            )}
            <Stat side="enemy" player={enemy} />
            <Cell id={row.enemy} />
          </div>
        );
      })}
      {team && (
        <div className="ov-row ov-team" data-gold-diff={team.gold}>
          <span className="ov-lane">TEAM</span>
          <span className="ov-team-gold ally">{formatGold(team.allyGold)}</span>
          <span className="ov-gold" data-trend={goldTrend(team.gold)}>
            {formatGoldDiff(team.gold)}
          </span>
          <span className="ov-team-gold enemy">{formatGold(team.enemyGold)}</span>
        </div>
      )}
    </section>
  );
}
