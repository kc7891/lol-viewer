/**
 * Usage: pnpm champion-data [--version 16.23.1] [--summary path.md]
 * Writes packages/core/data/champions.json (and a Markdown change summary).
 */
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { ChampionDataSchema, type ChampionData } from "@lol-viewer/protocol";
import { diff, format, transform, type DDragonChampionFull } from "./index.ts";

const BASE = "https://ddragon.leagueoflegends.com";
const OUT = new URL("../../../packages/core/data/champions.json", import.meta.url);

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
const next = transform(en!, ja!);

let before: ChampionData | null = null;
try {
  before = ChampionDataSchema.parse(JSON.parse(await readFile(OUT, "utf8")));
} catch {
  before = null;
}

await writeFile(OUT, format(next));
const summary = diff(before, next);
if (values.summary) await writeFile(values.summary, summary);
console.log(summary);
