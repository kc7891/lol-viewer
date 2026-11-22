/**
 * Personal-data masking for recordings.
 *
 * Recordings contain other players' identities (Riot ID, PUUID, summoner ids).
 * Every value under a key that looks like an identity is replaced with a
 * pseudonym BEFORE it is written to disk. Pseudonyms are stable within one
 * recording, so relationships survive (e.g. "summonerId X is on teamOne").
 */

/** Keys whose values identify a person or account. Matched case-insensitively as substrings. */
export const PII_KEY_PATTERNS = [
  "puuid",
  "summonerid",
  "summonername",
  "summonerinternalname",
  "accountid",
  "playerid",
  "gamename",
  "tagline",
  "riotid",
  "displayname",
  "internalname",
  "profileicon",
  "nameplate",
] as const;

export function isPiiKey(key: string): boolean {
  const k = key.toLowerCase();
  return PII_KEY_PATTERNS.some((p) => k.includes(p));
}

/** True for values a masked recording may contain under a PII key. */
export function isMaskedValue(v: unknown): boolean {
  if (v === null || v === undefined || v === "" || v === 0 || v === false) return true;
  if (typeof v === "number") return v >= 1_000_000 && v < 1_001_000; // pseudonym range
  if (typeof v === "string") return /^(player|tag)-\d+$/.test(v) || v === "[masked]";
  return false;
}

export type Masker = <T>(value: T) => T;

/** Creates a masker with its own pseudonym table (one per recording). */
export function createMasker(): Masker {
  const numbers = new Map<number, number>();
  const strings = new Map<string, string>();
  const pseudo = (key: string, v: unknown): unknown => {
    // "no value" markers carry no identity and are kept as-is (0 = no summoner, "" = no name).
    if (v === null || v === undefined || v === "" || v === 0 || v === false) return v;
    if (typeof v === "number") {
      if (!numbers.has(v)) numbers.set(v, 1_000_000 + numbers.size + 1);
      return numbers.get(v);
    }
    if (typeof v === "string") {
      const prefix = key.toLowerCase().includes("tagline") ? "tag" : "player";
      const k = `${prefix}:${v}`;
      if (!strings.has(k)) strings.set(k, `${prefix}-${strings.size + 1}`);
      return strings.get(k);
    }
    return "[masked]";
  };

  const walk = (value: unknown, parentKey: string | null): unknown => {
    if (parentKey !== null && isPiiKey(parentKey)) return pseudo(parentKey, value);
    if (Array.isArray(value)) return value.map((v) => walk(v, null));
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[k] = walk(v, k);
      return out;
    }
    return value;
  };

  return <T>(value: T) => walk(value, null) as T;
}

/** Paths (a.b[0].c) of PII keys whose values are not masked. Empty = safe to share. */
export function findUnmaskedPii(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => findUnmaskedPii(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => {
      const p = `${path}.${k}`;
      if (isPiiKey(k)) return isMaskedValue(v) ? [] : [p];
      return findUnmaskedPii(v, p);
    });
  }
  return [];
}
