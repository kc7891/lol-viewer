/**
 * Saved sets of people (Roster) and saved team splits (Matchup) in Teams (M-042): names, upsert / rename / delete with the caps,
 * loading a roster into Match, comparing two splits, and the Discord text of a saved split. Pure; the lists live in the settings.
 */
import type { Lane } from "@lol-viewer/protocol";
import {
  MATCHUPS_MAX,
  ROSTERS_MAX,
  ROSTER_PUUIDS_MAX,
  SAVED_NAME_MAX,
  type SavedMatchup,
  type SavedPerson,
  type SavedRoster,
} from "../settings.ts";
import type { BalancePlayer, BalanceView, Proposal, Slot } from "./balance.ts";
import { scoreProposal } from "./balance.ts";
import { formatForDiscord, type DiscordName, type DiscordRank } from "./discord.ts";

type Named = { id: string; name: string; savedAt: number };

/** The name as saved: leading and trailing spaces removed. */
export const normalizeName = (name: string): string => name.trim();

/** Why a name cannot be saved: empty (after trimming) or longer than 40 characters. */
export const nameProblem = (name: string): "empty" | "long" | null => {
  const n = normalizeName(name);
  return n === "" ? "empty" : n.length > SAVED_NAME_MAX ? "long" : null;
};

/** The item with this name (leading / trailing spaces and letter case do not matter). */
export function findByName<T extends { name: string }>(list: readonly T[], name: string): T | undefined {
  const n = normalizeName(name).toLowerCase();
  return list.find((x) => x.name.toLowerCase() === n);
}

/** Newest first (what the menus and the Matchups tab show). */
export const newestFirst = <T extends { savedAt: number }>(list: readonly T[]): T[] => [...list].sort((a, b) => b.savedAt - a.savedAt);

let counter = 0;
const newId = (now: number, prefix: string) => `${prefix}${now.toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Drop the oldest items beyond `max` (never the ones in `keep`). */
function cap<T extends { savedAt: number }>(list: T[], max: number, keep: readonly T[] = []): T[] {
  if (list.length <= max) return list;
  const drop = new Set(newestFirst(list.filter((x) => !keep.includes(x))).reverse().slice(0, list.length - max));
  return list.filter((x) => !drop.has(x));
}

export type UpsertResult<T> = { list: T[]; item: T | null; replaced: boolean };

/** Add `item` under `name`, or (same name, any case) replace that one keeping its id; refused (item null) for a bad name. */
function upsert<T extends Named>(list: readonly T[], name: string, build: (id: string, name: string) => T, now: number, id: string | undefined, max: number, prefix: string): UpsertResult<T> {
  if (nameProblem(name) !== null) return { list: [...list], item: null, replaced: false };
  const n = normalizeName(name);
  const same = findByName(list, n);
  const item = build(same?.id ?? id ?? newId(now, prefix), n);
  const next = same ? list.map((x) => (x === same ? item : x)) : cap([...list, item], max, [item]);
  return { list: next, item, replaced: !!same };
}

function renameIn<T extends Named>(list: readonly T[], id: string, name: string): T[] {
  const n = normalizeName(name);
  const target = list.find((x) => x.id === id);
  if (!target || nameProblem(n) !== null) return [...list];
  const other = findByName(list, n);
  if (other && other.id !== id) return [...list];
  return list.map((x) => (x === target ? { ...x, name: n } : x));
}

const without = <T extends { id: string }>(list: readonly T[], id: string): T[] => list.filter((x) => x.id !== id);

// ── Roster ──
export type RosterInput = { name: string; puuids: readonly string[] };

/** Save the people under a name (1-20 people, repeats removed). A name that exists is overwritten. */
export function upsertRoster(list: readonly SavedRoster[], input: RosterInput, now: number, id?: string): UpsertResult<SavedRoster> {
  const puuids = [...new Set(input.puuids)];
  if (puuids.length < 1 || puuids.length > ROSTER_PUUIDS_MAX) return { list: [...list], item: null, replaced: false };
  return upsert(list, input.name, (i, name) => ({ id: i, name, puuids, savedAt: now }), now, id, ROSTERS_MAX, "r");
}
export const renameRoster = (list: readonly SavedRoster[], id: string, name: string): SavedRoster[] => renameIn(list, id, name);
export const deleteRoster = (list: readonly SavedRoster[], id: string): SavedRoster[] => without(list, id);

/**
 * A copy of a roster: the same people, saved now, named `<name> (copy)`, then `(copy 2)`, `(copy 3)` ... (the base is cut so the name
 * fits in 40 characters). Over the cap the oldest go, but never the roster that was copied.
 */
export function duplicateRoster(list: readonly SavedRoster[], id: string, now: number, newIdValue?: string): UpsertResult<SavedRoster> {
  const src = list.find((r) => r.id === id);
  if (!src) return { list: [...list], item: null, replaced: false };
  let name = "";
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? " (copy)" : ` (copy ${n})`;
    name = `${src.name.slice(0, Math.max(1, SAVED_NAME_MAX - suffix.length)).trimEnd()}${suffix}`;
    if (!findByName(list, name)) break;
  }
  const item: SavedRoster = { id: newIdValue ?? newId(now, "r"), name, puuids: [...src.puuids], savedAt: now };
  return { list: cap([...list, item], ROSTERS_MAX, [item, src]), item, replaced: false };
}

/** `Roster 11/28` */
export const defaultRosterName = (now: number): string => `Roster ${shortDate(now)}`;
/** `Matchup 11/28 #3`: the number counts up until the name is free. */
export function defaultMatchupName(list: readonly SavedMatchup[], now: number): string {
  let n = list.length + 1;
  while (findByName(list, `Matchup ${shortDate(now)} #${n}`)) n++;
  return `Matchup ${shortDate(now)} #${n}`;
}
const shortDate = (now: number) => {
  const d = new Date(now);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

/**
 * Put a roster into Match. Everybody listed who is in the roster plays and the rest sit out; people in the roster who are not listed
 * join if they are saved in People (`extras`, they play too), and the others cannot (`missing`).
 */
export function applyRoster(
  candidates: readonly { puuid: string }[],
  roster: { puuids: readonly string[] },
  savedPlayers: Readonly<Record<string, unknown>>,
): { moved: Record<string, "in" | "out">; extras: string[]; missing: string[] } {
  const inRoster = new Set(roster.puuids);
  const listed = new Set(candidates.map((c) => c.puuid));
  const moved: Record<string, "in" | "out"> = {};
  for (const c of candidates) moved[c.puuid] = inRoster.has(c.puuid) ? "in" : "out";
  const extras: string[] = [];
  const missing: string[] = [];
  for (const p of inRoster) {
    if (listed.has(p)) continue;
    if (Object.hasOwn(savedPlayers, p)) {
      extras.push(p);
      moved[p] = "in";
    } else missing.push(p);
  }
  return { moved, extras, missing };
}

/** `2 people in "Friday 8" are not in People. Add them from People › Add.` */
export const missingPeopleText = (name: string, n: number): string =>
  `${n} ${n === 1 ? "person" : "people"} in "${name}" ${n === 1 ? "is" : "are"} not in People. Add them from People › Add.`;

// ── Matchup ──
export type MatchupInfo = Record<string, { name: DiscordName; rank: { label: string; points?: number | null } } | undefined>;

/** A split to keep: the slots as shown (an edited one too), with the names and rank labels of now. */
export function matchupFromProposal(proposal: { blue: readonly Slot[]; red: readonly Slot[] }, info: MatchupInfo, view: BalanceView, name: string, now: number): MatchupInput {
  const people: Record<string, SavedPerson> = {};
  for (const s of [...proposal.blue, ...proposal.red]) {
    const i = info[s.puuid];
    const points = i?.rank.points;
    people[s.puuid] = { gameName: i?.name.gameName || "?", tagLine: i?.name.tagLine ?? "", rankLabel: i?.rank.label ?? "—", ...(points !== undefined ? { points } : {}) };
  }
  return { name: normalizeName(name), savedAt: now, blue: proposal.blue.map((s) => ({ ...s })), red: proposal.red.map((s) => ({ ...s })), people, priority: view };
}

export type MatchupInput = Omit<SavedMatchup, "id">;
/** Save a split under its name. A name that exists is overwritten (it keeps its id). */
export function upsertMatchup(list: readonly SavedMatchup[], input: MatchupInput, now: number, id?: string): UpsertResult<SavedMatchup> {
  const size = input.blue.length;
  if (size < 3 || size > 5 || input.red.length !== size) return { list: [...list], item: null, replaced: false };
  return upsert(list, input.name, (i, name) => ({ ...input, id: i, name, savedAt: now }), now, id, MATCHUPS_MAX, "m");
}
export const renameMatchup = (list: readonly SavedMatchup[], id: string, name: string): SavedMatchup[] => renameIn(list, id, name);
export const deleteMatchup = (list: readonly SavedMatchup[], id: string): SavedMatchup[] => without(list, id);

const sideKey = (slots: readonly Slot[]) => slots.map((s) => `${s.puuid}:${s.lane ?? "-"}`).sort().join(",");

/** The same split: the same people and lanes on each side, whichever side is blue and whatever the order inside a team. */
export function sameMatchup(a: { blue: readonly Slot[]; red: readonly Slot[] }, b: { blue: readonly Slot[]; red: readonly Slot[] }): boolean {
  const [a1, a2] = [sideKey(a.blue), sideKey(a.red)].sort();
  const [b1, b2] = [sideKey(b.blue), sideKey(b.red)].sort();
  return a1 === b1 && a2 === b2;
}

/** The Discord text of a saved split, from what was saved (names, rank labels); the title is the saved name. */
export function matchupDiscordText(m: SavedMatchup, o: { withRank?: boolean; withTag?: boolean; mains?: Record<string, Lane | null | undefined> } = {}): string {
  const names: Record<string, DiscordName> = {};
  const ranks: Record<string, DiscordRank> = {};
  const players: BalancePlayer[] = [];
  for (const s of [...m.blue, ...m.red]) {
    const p = m.people[s.puuid];
    names[s.puuid] = { gameName: p?.gameName ?? "?", tagLine: p?.tagLine ?? "" };
    ranks[s.puuid] = { label: p?.rankLabel ?? "—", points: p?.points ?? null };
    players.push({ puuid: s.puuid, points: p?.points ?? null, lock: null, mains: [], subs: [], ng: [] });
  }
  const proposal: Proposal = scoreProposal({ blue: m.blue, red: m.red }, players, m.priority);
  return formatForDiscord(proposal, names, ranks, { title: m.name, withRank: o.withRank, withTag: o.withTag, mains: o.mains });
}
