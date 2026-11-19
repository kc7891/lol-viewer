/**
 * PoC champion table (numeric LCU id -> slug/name).
 *
 * The production version should be generated from Data Dragon
 * (champion.json `key` field) alongside ../../champions.json; this subset only
 * covers the champions used by the scenarios and stories.
 */
export type Champion = {
  id: number;
  slug: string;
  name: string;
  nameJa: string;
  /** Data Dragon image id (e.g. "MonkeyKing" for Wukong). */
  ddragonId: string;
};

const DDRAGON_VERSION = "16.21.1";

export const CHAMPIONS: readonly Champion[] = [
  { id: 266, slug: "aatrox", name: "Aatrox", nameJa: "エイトロックス", ddragonId: "Aatrox" },
  { id: 103, slug: "ahri", name: "Ahri", nameJa: "アーリ", ddragonId: "Ahri" },
  { id: 122, slug: "darius", name: "Darius", nameJa: "ダリウス", ddragonId: "Darius" },
  { id: 86, slug: "garen", name: "Garen", nameJa: "ガレン", ddragonId: "Garen" },
  { id: 64, slug: "leesin", name: "Lee Sin", nameJa: "リー・シン", ddragonId: "LeeSin" },
  { id: 76, slug: "nidalee", name: "Nidalee", nameJa: "ニダリー", ddragonId: "Nidalee" },
  { id: 238, slug: "zed", name: "Zed", nameJa: "ゼド", ddragonId: "Zed" },
  { id: 134, slug: "syndra", name: "Syndra", nameJa: "シンドラ", ddragonId: "Syndra" },
  { id: 222, slug: "jinx", name: "Jinx", nameJa: "ジンクス", ddragonId: "Jinx" },
  { id: 51, slug: "caitlyn", name: "Caitlyn", nameJa: "ケイトリン", ddragonId: "Caitlyn" },
  { id: 412, slug: "thresh", name: "Thresh", nameJa: "スレッシュ", ddragonId: "Thresh" },
  { id: 89, slug: "leona", name: "Leona", nameJa: "レオナ", ddragonId: "Leona" },
  { id: 62, slug: "wukong", name: "Wukong", nameJa: "ウーコン", ddragonId: "MonkeyKing" },
];

const byId = new Map(CHAMPIONS.map((c) => [c.id, c]));

export function getChampion(id: number | null | undefined): Champion | undefined {
  return id == null ? undefined : byId.get(id);
}

export function championIconUrl(c: Champion): string {
  return `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/${c.ddragonId}.png`;
}
