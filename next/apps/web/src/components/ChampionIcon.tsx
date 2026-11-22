import { useState } from "react";
import { championIconUrl, getChampion } from "@lol-viewer/core";

export function ChampionIcon({ id, size = 24 }: { id: number | null; size?: number }) {
  const champ = getChampion(id);
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };
  if (!champ || failed) {
    return (
      <span className="champ-icon" style={style} aria-hidden>
        {champ ? champ.name.slice(0, 2) : ""}
      </span>
    );
  }
  return (
    <img
      className="champ-icon"
      style={style}
      src={championIconUrl(champ)}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
