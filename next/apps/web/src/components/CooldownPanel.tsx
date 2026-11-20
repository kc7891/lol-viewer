import { CHAMPION_DATA, getChampion } from "@lol-viewer/core";
import type { ChampionSpell } from "@lol-viewer/protocol";
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
export function CooldownPanel({ championId }: { championId: number | null }) {
  const champ = getChampion(championId);
  return (
    <section className="cooldowns" aria-label="Cooldowns">
      <div className="cooldowns-title">
        <span>COOLDOWNS</span>
        <span title="Data Dragon のランク別の基本値（スキルヘイスト未適用）">Patch {CHAMPION_DATA.patch} · base</span>
      </div>
      {!champ ? (
        <div className="cooldowns-empty">マッチアップのチャンピオンをクリックすると表示</div>
      ) : (
        <>
          <div className="cooldowns-champ">
            <ChampionIcon id={champ.id} size={20} />
            <span>{champ.name}</span>
            <span className="ja">{champ.nameJa}</span>
          </div>
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
                        <span className="none" title="クールダウンなし（パッシブ・チャージ制など）">
                          —
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
