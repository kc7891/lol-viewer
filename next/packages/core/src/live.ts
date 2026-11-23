/**
 * Live Client Data API (in game, M-025): normalise one playerlist entry into facts (no names),
 * estimate item gold (M-026), decide my team (M-029) and format the row differences.
 * Pure functions; imports only champions / search / lanes / protocol / items.json.
 */
import {
  ItemDataSchema,
  type LiveClientPlayer,
  type LivePlayer,
  type LivePlayerFact,
  type MatchState,
} from "@lol-viewer/protocol";
import itemsRaw from "../data/items.json" with { type: "json" };
import { CHAMPIONS, getChampionByDdragonId } from "./champions.ts";
import { normalizeLane } from "./lanes.ts";
import { normalizeSearch } from "./search.ts";

export const ITEM_DATA = ItemDataSchema.parse(itemsRaw);
const ITEM_GOLD = new Map(Object.entries(ITEM_DATA.items).map(([k, v]) => [Number(k), v]));

type ItemLike = { itemID: number; count?: number; price?: number; consumable?: boolean };

/** Gold counted for one inventory slot (M-026). */
export function itemValue(it: ItemLike): number {
  const count = it.count != null && it.count > 0 ? Math.trunc(it.count) : 1;
  const known = ITEM_GOLD.get(it.itemID);
  if (known !== undefined) return known * count; // consumed items are 0 in the table
  if (it.consumable) return 0;
  return Math.max(0, Math.round(it.price ?? 0)) * count; // unknown id (data older than the game)
}
export const itemGold = (items: readonly ItemLike[]): number => items.reduce((sum, it) => sum + itemValue(it), 0);

const RAW_CHAMPION_PREFIX = "game_character_displayname_";

/** Champion id from rawChampionName (Data Dragon id), else from championName (English or Japanese). */
export function championIdFromLive(p: Pick<LiveClientPlayer, "rawChampionName" | "championName">): number | null {
  const raw = p.rawChampionName ?? "";
  if (raw.startsWith(RAW_CHAMPION_PREFIX)) {
    const c = getChampionByDdragonId(raw.slice(RAW_CHAMPION_PREFIX.length));
    if (c) return c.id;
  }
  const name = p.championName ?? "";
  if (!name) return null;
  const exact = CHAMPIONS.find((c) => c.name === name || c.nameJa === name);
  if (exact) return exact.id;
  const n = normalizeSearch(name);
  const loose = CHAMPIONS.find((c) => [c.name, c.nameJa, c.ddragonId, c.slug].some((k) => normalizeSearch(k) === n));
  return loose?.id ?? null;
}

/** Smite in either summoner spell slot. raw* keys survive recordings (displayName is masked there). */
export function hasSmite(p: Pick<LiveClientPlayer, "summonerSpells">): boolean {
  const spells = [p.summonerSpells?.summonerSpellOne, p.summonerSpells?.summonerSpellTwo];
  return spells.some(
    (s) =>
      !!s &&
      (/SummonerSmite/i.test(s.rawDescription ?? "") ||
        /SummonerSmite/i.test(s.rawDisplayName ?? "") ||
        s.displayName === "Smite" ||
        s.displayName === "スマイト"),
  );
}

export function normalizeLivePlayer(p: LiveClientPlayer): LivePlayerFact | null {
  const championId = championIdFromLive(p);
  if (championId == null) return null; // unknown champion (old champions.json): drop
  const team = p.team === "ORDER" || p.team === "CHAOS" ? p.team : null;
  if (!team) return null;
  const lane = normalizeLane(p.position) ?? (hasSmite(p) ? "jungle" : null);
  const level = Math.max(0, Math.trunc(p.level ?? 0));
  return { championId, team, lane, level, itemGold: itemGold(p.items ?? []) };
}

type TeamContext = Pick<MatchState, "self" | "allies" | "enemies">;

/** My team in the Live Client list, without names: my champion, else overlap with MatchState allies / enemies. */
export function resolveMyTeam(players: readonly LivePlayerFact[], match: TeamContext): "ORDER" | "CHAOS" | null {
  const teamsWith = (id: number) => new Set(players.filter((p) => p.championId === id).map((p) => p.team));
  if (match.self) {
    const t = teamsWith(match.self.championId);
    if (t.size === 1) return [...t][0]!;
  }
  const score = (team: "ORDER" | "CHAOS") => {
    const ids = players.filter((p) => p.team === team).map((p) => p.championId);
    return (
      ids.filter((id) => match.allies.some((a) => a.championId === id)).length -
      ids.filter((id) => match.enemies.includes(id)).length
    );
  };
  const o = score("ORDER");
  const c = score("CHAOS");
  return o > c ? "ORDER" : c > o ? "CHAOS" : null;
}

/** MatchState.live from the facts; null when the shape is not 2 teams of <= 5 or my team is unknown. */
export function buildLivePlayers(players: readonly LivePlayerFact[], match: TeamContext): LivePlayer[] | null {
  const order = players.filter((p) => p.team === "ORDER").length;
  const chaos = players.length - order;
  if (players.length === 0 || order > 5 || chaos > 5) return null;
  const mine = resolveMyTeam(players, match);
  if (!mine) return null;
  return players.map((p) => ({
    championId: p.championId,
    team: p.team === mine ? "ally" : "enemy",
    lane: p.lane,
    level: p.level,
    itemGold: p.itemGold,
  }));
}

/** "+1.4k", "-950", "0" (|d| < 50), "+10k" (>= 9 950). ASCII + and -. */
export function formatGoldDiff(d: number): string {
  const r = Math.round(d);
  const a = Math.abs(r);
  if (a < 50) return "0";
  const sign = r > 0 ? "+" : "-";
  if (a < 1000) return `${sign}${a}`;
  const k = Math.round(a / 100) / 10;
  return k < 10 ? `${sign}${k.toFixed(1)}k` : `${sign}${Math.round(a / 1000)}k`;
}
/** Unsigned team total, always one decimal so two close totals stay apart: "950", "1.0k", "21.3k". */
export function formatGold(n: number): string {
  const a = Math.max(0, Math.round(n));
  return a < 1000 ? `${a}` : `${(Math.round(a / 100) / 10).toFixed(1)}k`;
}
export const goldTrend = (d: number): "ahead" | "behind" | "even" =>
  Math.abs(Math.round(d)) < 50 ? "even" : d > 0 ? "ahead" : "behind";
/** "Lv+1" / "Lv-2"; null when equal. */
export const formatLevelDiff = (d: number): string | null => (d === 0 ? null : `Lv${d > 0 ? "+" : "-"}${Math.abs(d)}`);
