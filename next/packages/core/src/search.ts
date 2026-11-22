import { CHAMPIONS, type Champion } from "./champions.ts";

/** Lowercase, hiragana -> katakana, drop spaces/punctuation ("Kai'Sa" ~ "kaisa", "あーり" ~ "アーリ"). */
export function normalizeSearch(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/[\s'’.&・･=＝_-]/g, "");
}

const index = CHAMPIONS.map((c) => ({
  c,
  keys: [c.name, c.nameJa, c.slug, c.ddragonId].map(normalizeSearch),
}));

/** Prefix matches first, then substring matches; alphabetical within each group. */
export function searchChampions(query: string, limit = 50): Champion[] {
  const q = normalizeSearch(query);
  if (!q) return CHAMPIONS.slice(0, limit);
  const prefix: Champion[] = [];
  const inner: Champion[] = [];
  for (const { c, keys } of index) {
    if (keys.some((k) => k.startsWith(q))) prefix.push(c);
    else if (keys.some((k) => k.includes(q))) inner.push(c);
  }
  return [...prefix, ...inner].slice(0, limit);
}
