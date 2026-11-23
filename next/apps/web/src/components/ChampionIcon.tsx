import { useState } from "react";
import { championIconUrl, getChampion } from "@lol-viewer/core";

/** Data Dragon square icon; falls back to the champion's initials when offline. */
export function ChampionIcon({ id, size = 24, className = "" }: { id: number | null; size?: number; className?: string }) {
  const champ = getChampion(id);
  const [failed, setFailed] = useState(false);
  const style = { width: `${size / 16}rem`, height: `${size / 16}rem`, fontSize: `${Math.max(8, size * 0.4) / 16}rem` };
  if (!champ || failed) {
    return (
      <span className={`champ-icon fallback ${className}`} style={style} aria-hidden>
        {champ ? champ.name.slice(0, 2) : "?"}
      </span>
    );
  }
  return (
    <img
      className={`champ-icon ${className}`}
      style={style}
      src={championIconUrl(champ)}
      alt=""
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}
