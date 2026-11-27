/** Riot ID input for Teams: parsing pasted lines and the lookup through summoners?name= (M-038). */
import {
  isValidRiotId,
  PROBE_PUUID_RE,
  type ProbeBuildArgs,
  type ProbeResponse,
  type ProbeRouteId,
  type RiotIdResult,
} from "@lol-viewer/protocol";

export const MAX_RIOT_ID_LINES = 30;
export type RiotIdLine = { input: string; valid: boolean };

/** Split on newlines and commas, trim, drop empty lines and repeats (case-insensitive), keep at most 30. */
export function parseRiotIdLines(text: string): RiotIdLine[] {
  const seen = new Set<string>();
  const out: RiotIdLine[] = [];
  for (const part of text.split(/[\r\n,]+/)) {
    const input = part.trim();
    const key = input.toLowerCase();
    if (input === "" || seen.has(key)) continue;
    seen.add(key);
    out.push({ input, valid: isValidRiotId(input) });
    if (out.length >= MAX_RIOT_ID_LINES) break;
  }
  return out;
}

export type RiotIdFound = { puuid: string; gameName: string; tagLine: string };

/** Look one Riot ID up. `request` is the fetcher's rate-limited GET. The person found is returned beside the result. */
export async function lookupRiotId(
  request: (route: ProbeRouteId, args?: ProbeBuildArgs) => Promise<ProbeResponse>,
  input: string,
): Promise<{ result: RiotIdResult; found: RiotIdFound | null }> {
  const fail = (error: "format" | "not-found" | "failed") => ({ result: { input, puuid: null, error }, found: null });
  if (!isValidRiotId(input)) return fail("format");
  let r: ProbeResponse;
  try {
    r = await request("summonerByName", { query: { name: input } });
  } catch {
    return fail("failed");
  }
  if (r.status === 404) return fail("not-found");
  if (r.status < 200 || r.status >= 300) return fail("failed");
  const b = r.body as { puuid?: unknown; gameName?: unknown; tagLine?: unknown } | null;
  const puuid = typeof b?.puuid === "string" ? b.puuid : "";
  if (!puuid || !PROBE_PUUID_RE.test(puuid)) return fail("not-found");
  const [name = "", tag = ""] = input.split("#");
  const found = {
    puuid,
    gameName: typeof b?.gameName === "string" && b.gameName ? b.gameName : name,
    tagLine: typeof b?.tagLine === "string" && b.tagLine ? b.tagLine : tag,
  };
  return { result: { input, puuid, error: null }, found };
}
