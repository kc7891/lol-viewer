/**
 * The per-person preferences file (Teams UI v2, M-040 §5): lol-viewer-team-preferences.json.
 * Plain JSON a person can read and fix by hand. All functions are pure; reading and writing the file is the app's job.
 */
import { LaneSchema, type Lane } from "@lol-viewer/protocol";
import { parseTeamPlayers, TEAM_PLAYERS_MAX, type TeamPlayerPref } from "../settings.ts";
import { MASTER_BASE, rankPoints, TIER_BASE } from "./rank.ts";

export const PREFS_FILE_KIND = "lol-viewer/team-preferences";
export const PREFS_FILE_VERSION = 1;
/** Files and texts over 1 MB are refused (both reading and writing). */
export const PREFS_FILE_MAX_BYTES = 1_000_000;

export type PrefsFileEntry = { riotId?: string; puuid?: string; pref: TeamPlayerPref };
export type PrefsFilePlayer = { riotId?: string; puuid: string; lock?: Lane; prefer?: Lane[]; avoid?: Lane[]; rank?: string };
export type PrefsFile = { kind: typeof PREFS_FILE_KIND; version: 1; exportedAt: string; players: PrefsFilePlayer[] };
export type PrefsFileError = "json" | "kind" | "version" | "size";
export type PrefsParseResult = { ok: true; entries: PrefsFileEntry[] } | { ok: false; error: PrefsFileError };

const DIVISIONS = ["IV", "III", "II", "I"] as const;
const TIERS = Object.keys(TIER_BASE);
const APEX = ["MASTER", "GRANDMASTER", "CHALLENGER"];

/** `"GOLD II"`, or `"MASTER 120"` (LP) from Master up. Points inside a division (LP) are dropped. */
export function rankToLabel(points: number): string {
  const p = Math.max(0, Math.round(points));
  if (p >= MASTER_BASE) return `MASTER ${p - MASTER_BASE}`;
  const base = Math.min(2400, Math.floor(p / 400) * 400);
  const tier = TIERS.find((t) => TIER_BASE[t] === base)!;
  return `${tier} ${DIVISIONS[Math.min(3, Math.floor((p - base) / 100))]}`;
}

/** The points of `"GOLD II"` / `"master 120"` / `"CHALLENGER"`; null when it is not a rank. */
export function rankFromLabel(label: unknown): number | null {
  if (typeof label !== "string") return null;
  const m = /^\s*([A-Za-z]+)(?:\s+(\w+))?\s*$/.exec(label);
  if (!m) return null;
  const tier = m[1]!.toUpperCase();
  const rest = m[2]?.toUpperCase();
  if (APEX.includes(tier)) {
    if (rest === undefined) return MASTER_BASE;
    return /^\d{1,4}$/.test(rest) ? MASTER_BASE + Number(rest) : null;
  }
  if (rest === undefined || !(tier in TIER_BASE)) return null;
  return rankPoints(tier, rest, 0);
}

const riotIdOf = (p: { gameName: string; tagLine: string } | undefined): string | undefined => (p && p.gameName && p.tagLine ? `${p.gameName}#${p.tagLine}` : undefined);

/** The file's content. People with no preference are left out; the order is by Riot ID so two exports of the same data are the same text. */
export function buildPrefsFile(prefs: Readonly<Record<string, TeamPlayerPref>>, players: Readonly<Record<string, { gameName: string; tagLine: string }>>, now: number): PrefsFile {
  const list: PrefsFilePlayer[] = [];
  for (const [puuid, pref] of Object.entries(prefs)) {
    const row: PrefsFilePlayer = { puuid };
    const riotId = riotIdOf(players[puuid]);
    const out: PrefsFilePlayer = riotId ? { riotId, ...row } : row;
    if (pref.lock) out.lock = pref.lock;
    if (pref.mains?.length) out.prefer = [...pref.mains];
    if (pref.ng?.length) out.avoid = [...pref.ng];
    if (pref.rankOverride !== undefined) out.rank = rankToLabel(pref.rankOverride);
    if (out.lock || out.prefer || out.avoid || out.rank) list.push(out);
  }
  list.sort((a, b) => (a.riotId ?? a.puuid).toLowerCase().localeCompare((b.riotId ?? b.puuid).toLowerCase()) || a.puuid.localeCompare(b.puuid));
  return { kind: PREFS_FILE_KIND, version: PREFS_FILE_VERSION, exportedAt: new Date(now).toISOString().replace(/\.\d{3}Z$/, "Z"), players: list };
}

/** `buildPrefsFile` as text: JSON with two-space indent. */
export const exportPrefs = (prefs: Readonly<Record<string, TeamPlayerPref>>, players: Readonly<Record<string, { gameName: string; tagLine: string }>>, now: number): string =>
  JSON.stringify(buildPrefsFile(prefs, players, now), null, 2) + "\n";

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" && v.length <= 100 ? v.trim() : undefined);

/** One broken player becomes null (and is left out); the rest of the file is read as usual. */
function entryOf(raw: unknown): PrefsFileEntry | null {
  if (!isObject(raw)) return null;
  const riotId = text(raw.riotId);
  const puuid = text(raw.puuid);
  if (!riotId && !puuid) return null;
  const rank = rankFromLabel(raw.rank);
  const lock = LaneSchema.safeParse(raw.lock);
  // parseTeamPlayers keeps only valid lanes, at most 2 preferred, no duplicates, and rounds the rank.
  const pref = parseTeamPlayers({ x: { lock: lock.success ? lock.data : undefined, mains: raw.prefer, ng: raw.avoid, rankOverride: rank ?? undefined } }).x;
  if (!pref) return null;
  // A locked lane is neither starred nor avoided; a starred lane is not avoided.
  const mains = (pref.mains ?? []).filter((l) => l !== pref.lock);
  const ng = (pref.ng ?? []).filter((l) => l !== pref.lock && !mains.includes(l));
  const clean: TeamPlayerPref = { ...pref, mains, ng };
  if (!mains.length) delete clean.mains;
  if (!ng.length) delete clean.ng;
  return { ...(riotId ? { riotId } : {}), ...(puuid ? { puuid } : {}), pref: clean };
}

/** Read the file's text. A broken file says why; a broken player is dropped on its own. */
export function parsePrefsFile(input: string): PrefsParseResult {
  if (new TextEncoder().encode(input).length > PREFS_FILE_MAX_BYTES) return { ok: false, error: "size" };
  let json: unknown;
  try {
    json = JSON.parse(input.replace(/^﻿/, ""));
  } catch {
    return { ok: false, error: "json" };
  }
  if (!isObject(json) || json.kind !== PREFS_FILE_KIND) return { ok: false, error: "kind" };
  if (json.version !== PREFS_FILE_VERSION) return { ok: false, error: "version" };
  const entries: PrefsFileEntry[] = [];
  for (const raw of Array.isArray(json.players) ? json.players : []) {
    if (entries.length >= TEAM_PLAYERS_MAX) break;
    const e = entryOf(raw);
    if (e) entries.push(e);
  }
  return { ok: true, entries };
}

export type PrefsMatch = { matched: { puuid: string; pref: TeamPlayerPref }[]; unresolved: string[] };

/**
 * Who each entry is: the saved person with the same `puuid`, else the one whose name (name#tag, any case) is the entry's `riotId`.
 * What is left is `unresolved` (the Riot ID, or the puuid when the entry has no name). A person named twice keeps the later entry.
 */
export function matchPrefsEntries(entries: readonly PrefsFileEntry[], players: Readonly<Record<string, { gameName: string; tagLine: string }>>): PrefsMatch {
  const byName = new Map<string, string>();
  for (const [puuid, p] of Object.entries(players)) {
    const id = riotIdOf(p);
    if (id && !byName.has(id.toLowerCase())) byName.set(id.toLowerCase(), puuid);
  }
  const matched = new Map<string, TeamPlayerPref>();
  const unresolved: string[] = [];
  for (const e of entries) {
    const puuid = e.puuid && players[e.puuid] ? e.puuid : e.riotId ? byName.get(e.riotId.toLowerCase()) : undefined;
    if (puuid) {
      matched.delete(puuid);
      matched.set(puuid, e.pref);
    } else {
      unresolved.push(e.riotId ?? e.puuid ?? "?");
    }
  }
  return { matched: [...matched].map(([puuid, pref]) => ({ puuid, pref })), unresolved };
}

/** Import: the people in the file get exactly the file's preferences; everybody else is untouched. */
export function applyPrefsImport(current: Readonly<Record<string, TeamPlayerPref>>, matched: readonly { puuid: string; pref: TeamPlayerPref }[]): Record<string, TeamPlayerPref> {
  return { ...current, ...Object.fromEntries(matched.map((m) => [m.puuid, m.pref])) };
}
