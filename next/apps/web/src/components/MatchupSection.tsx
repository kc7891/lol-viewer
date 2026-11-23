import { useState } from "react";
import { formatGoldDiff, formatLevelDiff, getChampion, goldTrend, rowLiveDiff, type Side, type Workspace } from "@lol-viewer/core";
import { LANES } from "@lol-viewer/protocol";
import { ChampionIcon } from "./ChampionIcon.tsx";
import { IconCopy, IconRefresh } from "../ui/icons.tsx";
import { LANE_SHORT } from "../ui/labels.ts";

type Drag = { side: Side; index: number };

export type MatchupSectionProps = {
  ws: Workspace;
  /** Champion whose cooldowns are shown (highlighted). */
  selectedChampionId: number | null;
  onSelectChampion: (id: number) => void;
  onSwap: (side: Side, from: number, to: number) => void;
  onOpenRow: (index: number) => void;
  onRefresh: () => void;
};

/** CURRENT MATCHUP: five lane rows; drag two champions on the same side to swap them (M-005). */
export function MatchupSection({ ws, selectedChampionId, onSelectChampion, onSwap, onOpenRow, onRefresh }: MatchupSectionProps) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [over, setOver] = useState<Drag | null>(null);
  const selfId = ws.last?.self?.championId ?? ws.lastSelf?.championId ?? null;

  const diffs = ws.rows.map((_, i) => rowLiveDiff(ws, i));

  const cell = (side: Side, index: number, id: number | null) => {
    const champ = getChampion(id);
    const droppable = drag != null && drag.side === side && drag.index !== index;
    const isOver = droppable && over?.side === side && over.index === index;
    return (
      <div
        className={`side ${side}`}
        data-side={side}
        data-index={index}
        data-droppable={droppable || undefined}
        data-over={isOver || undefined}
        data-dragging={drag?.side === side && drag.index === index ? "true" : undefined}
        onDragOver={(e) => {
          if (!droppable) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (!isOver) setOver({ side, index });
        }}
        onDragLeave={() => over?.side === side && over.index === index && setOver(null)}
        onDrop={(e) => {
          e.preventDefault();
          if (drag && droppable) onSwap(side, drag.index, index);
          setDrag(null);
          setOver(null);
        }}
      >
        {champ ? (
          <button
            type="button"
            className="champ-btn"
            draggable
            aria-pressed={champ.id === selectedChampionId}
            title={`${champ.name} / ${champ.nameJa}: show cooldowns, drag to swap`}
            onClick={() => onSelectChampion(champ.id)}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", `${side}:${index}`);
              setDrag({ side, index });
            }}
            onDragEnd={() => {
              setDrag(null);
              setOver(null);
            }}
          >
            <span className="icon-wrap">
              <ChampionIcon id={champ.id} size={24} />
              {side === "ally" && champ.id === selfId && <span className="you">YOU</span>}
            </span>
            <span className="name">{champ.name}</span>
          </button>
        ) : (
          <span className="empty" aria-label="Empty">
            —
          </span>
        )}
      </div>
    );
  };

  return (
    <section className="side-section matchup" aria-label="Current matchup">
      <header className="section-head">
        <h2>Matchup</h2>
        <button type="button" className="icon-btn" aria-label="Refresh matchup" title="Re-read the League Client and rebuild the table" onClick={onRefresh}>
          <IconRefresh />
        </button>
      </header>
      <div className={`matchup-rows${diffs.some((d) => d) ? " has-live" : ""}`}>
        {ws.rows.map((row, i) => {
          const lane = LANES[i]!;
          const diff = diffs[i];
          const lvl = diff ? formatLevelDiff(diff.level) : null;
          return (
            <div className="matchup-row" key={lane} data-lane={lane}>
              <span className="lane">{LANE_SHORT[lane]}</span>
              {cell("ally", i, row.ally)}
              {diff ? (
                <span
                  className="vs live-diff"
                  data-trend={goldTrend(diff.gold)}
                  data-gold-diff={diff.gold}
                  data-level-diff={diff.level}
                  title={`Item gold: ${getChampion(row.ally)!.name} ${diff.ally.itemGold.toLocaleString("en-US")} vs ${getChampion(row.enemy)!.name} ${diff.enemy.itemGold.toLocaleString("en-US")} · Level ${diff.ally.level} vs ${diff.enemy.level}`}
                  aria-label={`Item gold difference ${formatGoldDiff(diff.gold)}${lvl ? `, level ${lvl.slice(2)}` : ""}`}
                >
                  <span className="gold">{formatGoldDiff(diff.gold)}</span>
                  {lvl && <span className="lvl">{lvl}</span>}
                </span>
              ) : (
                <span className="vs">vs</span>
              )}
              {cell("enemy", i, row.enemy)}
              <button
                type="button"
                className="icon-btn open-row"
                aria-label={`Open ${LANE_SHORT[lane]} matchup`}
                title="Open this matchup in a new viewer"
                disabled={row.ally == null}
                onClick={() => onOpenRow(i)}
              >
                <IconCopy size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
