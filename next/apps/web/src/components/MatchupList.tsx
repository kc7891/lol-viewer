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

function Side({ id, side, isSelf }: { id: number | null; side: "ally" | "enemy"; isSelf?: boolean }) {
  const champ = getChampion(id);
  return (
    <div className={`side ${side}`}>
      <ChampionIcon id={id} size={24} />
      {champ ? <span className="label">{champ.name}</span> : <span className="label empty">—</span>}
      {isSelf && <span className="self-badge">YOU</span>}
    </div>
  );
}

export function MatchupList({ state }: { state: MatchState }) {
  return (
    <section className="matchup" aria-label="Current matchup">
      <div className="matchup-title">
        <span>CURRENT MATCHUP</span>
        <span>Ally vs Enemy</span>
      </div>
      {state.matchups.map((row) => (
        <div className="matchup-row" key={row.lane} data-lane={row.lane}>
          <span className="lane">{LANE_LABEL[row.lane]}</span>
          <Side id={row.allyChampionId} side="ally" isSelf={state.self?.lane === row.lane && row.allyChampionId != null} />
          <span className="vs">VS</span>
          <Side id={row.enemyChampionId} side="enemy" />
        </div>
      ))}
    </section>
  );
}
