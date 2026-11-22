/**
 * Champion table: numeric LCU id -> names, URL slug, icon, spell cooldowns.
 *
 * Generated from Data Dragon by tools/champion-data (`pnpm champion-data`) and
 * refreshed weekly by .github/workflows/next-champion-data.yml. Never edit
 * ../data/champions.json by hand.
 */
import { ChampionDataSchema, type ChampionEntry } from "@lol-viewer/protocol";
import raw from "../data/champions.json" with { type: "json" };

export type Champion = ChampionEntry;

/** Validated once at load: a broken data file fails tests and app start loudly. */
export const CHAMPION_DATA = ChampionDataSchema.parse(raw);
export const CHAMPIONS: readonly Champion[] = CHAMPION_DATA.champions;

const byId = new Map(CHAMPIONS.map((c) => [c.id, c]));

export function getChampion(id: number | null | undefined): Champion | undefined {
  return id == null ? undefined : byId.get(id);
}

export function championIconUrl(c: Champion): string {
  return `https://ddragon.leagueoflegends.com/cdn/${CHAMPION_DATA.patch}/img/champion/${c.ddragonId}.png`;
}
