/**
 * Champion data generator: Data Dragon -> packages/core/data/champions.json
 *
 * Pure functions here (transform, format, diff) are unit-tested; the network
 * part lives in cli.ts. The app never fetches this at runtime: the JSON is
 * committed and refreshed by .github/workflows/next-champion-data.yml.
 */
import {
  ChampionDataSchema,
  type ChampionData,
  type ChampionEntry,
  type SpellKey,
} from "@lol-viewer/protocol";

/** Where Data Dragon ids differ from the URL names lolalytics / u.gg use. */
export const SLUG_OVERRIDES: Record<string, string> = {
  MonkeyKing: "wukong",
};

const SPELL_KEYS: readonly SpellKey[] = ["Q", "W", "E", "R"];

/** The subset of Data Dragon `championFull.json` we read. */
export type DDragonSpell = { id: string; name: string; maxrank: number; cooldown: number[] };
export type DDragonChampion = { id: string; key: string; name: string; spells: DDragonSpell[] };
export type DDragonChampionFull = { version: string; data: Record<string, DDragonChampion> };

export function slugFor(ddragonId: string): string {
  return SLUG_OVERRIDES[ddragonId] ?? ddragonId.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function transform(en: DDragonChampionFull, ja: DDragonChampionFull): ChampionData {
  if (en.version !== ja.version) throw new Error(`locale version mismatch: ${en.version} vs ${ja.version}`);
  const champions: ChampionEntry[] = Object.values(en.data).map((c) => {
    const jc = ja.data[c.id];
    if (!jc) throw new Error(`${c.id} missing in ja_JP`);
    if (c.spells.length !== 4 || jc.spells.length !== 4) throw new Error(`${c.id}: expected 4 spells`);
    return {
      id: Number(c.key),
      ddragonId: c.id,
      slug: slugFor(c.id),
      name: c.name,
      nameJa: jc.name,
      spells: c.spells.map((s, i) => ({
        key: SPELL_KEYS[i]!,
        name: s.name,
        nameJa: jc.spells[i]!.name,
        maxrank: s.maxrank,
        cooldown: s.cooldown.slice(0, s.maxrank),
      })),
    };
  });
  champions.sort((a, b) => a.name.localeCompare(b.name, "en"));
  // Validate before anything is written: a malformed upstream response fails the job.
  return ChampionDataSchema.parse({ source: "Data Dragon", patch: en.version, champions });
}

/** Stable, review-friendly JSON: one champion per block, number arrays on one line. */
export function format(data: ChampionData): string {
  return JSON.stringify(data, null, 2).replace(/\[\s+([\d.,\s]+?)\s+\]/g, (_m, inner: string) => `[${inner.split(/,\s*/).join(", ")}]`) + "\n";
}

const fmtCd = (cd: number[]) => cd.join(" / ");

/** Markdown summary of what changed between two data files (used as the PR body). */
export function diff(before: ChampionData | null, after: ChampionData): string {
  const lines: string[] = [];
  lines.push(`Data Dragon: \`${before?.patch ?? "(none)"}\` → \`${after.patch}\`  (${after.champions.length} champions)`);
  if (!before) return lines.join("\n") + "\n";

  const old = new Map(before.champions.map((c) => [c.id, c]));
  const now = new Map(after.champions.map((c) => [c.id, c]));
  const added = after.champions.filter((c) => !old.has(c.id));
  const removed = before.champions.filter((c) => !now.has(c.id));
  if (added.length) lines.push("", "### New champions", ...added.map((c) => `- ${c.name}（${c.nameJa}）`));
  if (removed.length) lines.push("", "### Removed champions", ...removed.map((c) => `- ${c.name}`));

  const cd: string[] = [];
  const other: string[] = [];
  for (const c of after.champions) {
    const o = old.get(c.id);
    if (!o) continue;
    for (const s of c.spells) {
      const os = o.spells.find((x) => x.key === s.key);
      if (os && fmtCd(os.cooldown) !== fmtCd(s.cooldown)) {
        cd.push(`| ${c.name} | ${s.key} ${s.nameJa} | ${fmtCd(os.cooldown)} | ${fmtCd(s.cooldown)} |`);
      }
    }
    if (o.slug !== c.slug || o.name !== c.name || o.nameJa !== c.nameJa) other.push(`- ${c.name}: name/slug changed`);
  }
  if (cd.length) lines.push("", "### Cooldown changes", "", "| Champion | Spell | Before | After |", "|---|---|---|---|", ...cd);
  if (other.length) lines.push("", "### Other changes", ...other);
  if (!added.length && !removed.length && !cd.length && !other.length) lines.push("", "No cooldown or roster changes.");
  return lines.join("\n") + "\n";
}
