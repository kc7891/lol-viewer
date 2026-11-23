/**
 * Usage: pnpm champion-data [--version 16.23.1] [--summary path.md]
 * Writes packages/core/data/champions.json and items.json (and a Markdown change summary).
 */
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { ChampionDataSchema, ItemDataSchema, type ChampionData, type ItemData } from "@lol-viewer/protocol";
import {
  diff,
  format,
  formatItems,
  itemDiffLine,
  parseLaneCsv,
  transform,
  transformItems,
  unknownLaneNames,
  type DDragonChampionFull,
  type DDragonItemFile,
} from "./index.ts";

const BASE = "https://ddragon.leagueoflegends.com";
const LANE_CSV = new URL("../champion_lane.csv", import.meta.url);
const OUT = new URL("../../../packages/core/data/champions.json", import.meta.url);
const ITEMS_OUT = new URL("../../../packages/core/data/items.json", import.meta.url);

const { values } = parseArgs({
  options: { version: { type: "string" }, summary: { type: "string" } },
});

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return (await res.json()) as T;
}

const version = values.version ?? (await getJson<string[]>(`${BASE}/api/versions.json`))[0];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`bad version: ${version}`);

const [en, ja] = await Promise.all(
  ["en_US", "ja_JP"].map((loc) => getJson<DDragonChampionFull>(`${BASE}/cdn/${version}/data/${loc}/championFull.json`)),
);
const itemFile = await getJson<DDragonItemFile>(`${BASE}/cdn/${version}/data/en_US/item.json`);
if (itemFile.version !== en!.version) throw new Error(`item.json version ${itemFile.version} != championFull ${en!.version}`);
const lanes = parseLaneCsv(await readFile(LANE_CSV, "utf8"));
const next = transform(en!, ja!, lanes);
const unknown = unknownLaneNames(next, lanes);
for (const name of unknown) console.warn(`warning: champion_lane.csv has "${name}" but Data Dragon has no such champion`);

let before: ChampionData | null = null;
try {
  before = ChampionDataSchema.parse(JSON.parse(await readFile(OUT, "utf8")));
} catch {
  before = null;
}

let itemsBefore: ItemData | null = null;
try {
  itemsBefore = ItemDataSchema.parse(JSON.parse(await readFile(ITEMS_OUT, "utf8")));
} catch {
  itemsBefore = null;
}
const items = transformItems(itemFile);

await writeFile(OUT, format(next));
await writeFile(ITEMS_OUT, formatItems(items));
let summary = diff(before, next);
summary += `\n${itemDiffLine(itemsBefore, items)}\n`;
if (unknown.length) summary += `\n### Warnings\n${unknown.map((n) => `- champion_lane.csv: unknown champion \`${n}\``).join("\n")}\n`;
if (values.summary) await writeFile(values.summary, summary);
console.log(summary);
