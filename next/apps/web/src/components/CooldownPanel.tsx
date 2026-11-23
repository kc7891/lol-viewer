import { useState } from "react";
import { CHAMPION_DATA, getChampion } from "@lol-viewer/core";
import type { ChampionSpell } from "@lol-viewer/protocol";
import { IconChevron } from "../ui/icons.tsx";
import { ChampionIcon } from "./ChampionIcon.tsx";

/** "9 / 8 / 7 / 6 / 5" — or null when Data Dragon has no cooldown (passive, ammo, toggles…). */
export function formatCooldowns(s: ChampionSpell): string | null {
  if (s.cooldown.every((n) => n === 0)) return null;
  return s.cooldown.join(" / ");
}

/**
 * Base cooldowns per skill rank (like a wiki page). Static reference only:
 * no timers, no link to the champion's live level, ability haste not applied.
 */
export function CooldownPanel({ championId, initiallyCollapsed = false }: { championId: number | null; initiallyCollapsed?: boolean }) {
  const champ = getChampion(championId);
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  return (
    <section className="side-section cooldowns" aria-label="Cooldowns">
      <header className="section-head">
        <h2>
          <button type="button" className="collapse-btn" aria-expanded={!collapsed} onClick={() => setCollapsed((c) => !c)}>
            <IconChevron size={12} />
            Cooldowns
          </button>
        </h2>
        {champ && (
          <span className="cd-champ" title={`${champ.name} / ${champ.nameJa}`}>
            <ChampionIcon id={champ.id} size={16} />
            {champ.name}
          </span>
        )}
      </header>
      {!collapsed &&
        (!champ ? (
          <p className="hint">Click a champion in the matchup to see its cooldowns.</p>
        ) : (
          <>
            <table className="cooldowns-table">
              <tbody>
                {champ.spells.map((s) => {
                  const cd = formatCooldowns(s);
                  return (
                    <tr key={s.key} data-spell={s.key}>
                      <th scope="row">
                        <span className="spell-key">{s.key}</span>
                      </th>
                      <td className="spell-name" title={`${s.nameJa} / ${s.name}`}>
                        {s.nameJa}
                      </td>
                      <td className="spell-cd">
                        {cd ? (
                          <>
                            {cd}
                            <span className="unit"> s</span>
                          </>
                        ) : (
                          <span className="none" title="No cooldown (passive, charges…)">
                            —
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="hint small">Patch {CHAMPION_DATA.patch} · base values per rank</p>
          </>
        ))}
    </section>
  );
}
