import { getChampion } from "@lol-viewer/core";
import type { Lane, MatchState } from "@lol-viewer/protocol";
import { ChampionIcon } from "./ChampionIcon.tsx";

const LANE_LABEL: Record<Lane, string> = {
  top: "Top",
  jungle: "Jungle",
  middle: "Mid",
  bottom: "Bot",
  support: "Support",
};

type SideProps = {
  id: number | null;
  side: "ally" | "enemy";
  isSelf?: boolean;
  selected?: boolean;
  onSelect?: (id: number) => void;
};

function Side({ id, side, isSelf, selected, onSelect }: SideProps) {
  const champ = getChampion(id);
  const content = (
    <>
      <ChampionIcon id={id} size={24} />
      {champ ? <span className="label">{champ.name}</span> : <span className="label empty">—</span>}
      {isSelf && <span className="self-badge">YOU</span>}
    </>
  );
  if (!champ || !onSelect) return <div className={`side ${side}`}>{content}</div>;
  return (
    <button
      type="button"
      className={`side ${side}`}
      aria-pressed={selected ?? false}
      title={`${champ.name} のクールダウンを表示`}
      onClick={() => onSelect(champ.id)}
    >
      {content}
    </button>
  );
}

export type MatchupListProps = {
  state: MatchState;
  /** Champion whose cooldowns are shown (highlighted). */
  selectedChampionId?: number | null;
  onSelectChampion?: (id: number) => void;
};

export function MatchupList({ state, selectedChampionId, onSelectChampion }: MatchupListProps) {
  return (
    <section className="matchup" aria-label="Current matchup">
      <div className="matchup-title">
        <span>CURRENT MATCHUP</span>
        <span>Ally vs Enemy</span>
      </div>
      {state.matchups.map((row) => (
        <div className="matchup-row" key={row.lane} data-lane={row.lane}>
          <span className="lane">{LANE_LABEL[row.lane]}</span>
          <Side
            id={row.allyChampionId}
            side="ally"
            isSelf={state.self?.lane === row.lane && row.allyChampionId != null}
            selected={row.allyChampionId != null && row.allyChampionId === selectedChampionId}
            onSelect={onSelectChampion}
          />
          <span className="vs">VS</span>
          <Side
            id={row.enemyChampionId}
            side="enemy"
            selected={row.enemyChampionId != null && row.enemyChampionId === selectedChampionId}
            onSelect={onSelectChampion}
          />
        </div>
      ))}
    </section>
  );
}
