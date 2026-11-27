/** Read the custom lobby out of the client's /lol-lobby/v2/lobby body (Teams, M-038). */
import type { CustomLobby } from "@lol-viewer/protocol";
import { PROBE_PUUID_RE } from "@lol-viewer/protocol";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function members(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const m of v) {
    if (!isObj(m) || m.isBot === true) continue;
    const p = m.puuid;
    if (typeof p === "string" && p !== "" && PROBE_PUUID_RE.test(p) && !out.includes(p)) out.push(p);
  }
  return out;
}

/** The three slot lists (bots and members without a PUUID removed), or null when this is not a custom lobby. */
export function parseCustomLobby(data: unknown): CustomLobby | null {
  const cfg = isObj(data) && isObj(data.gameConfig) ? data.gameConfig : null;
  if (!cfg || cfg.isCustom !== true) return null;
  return { team100: members(cfg.customTeam100), team200: members(cfg.customTeam200), spectators: members(cfg.customSpectators) };
}
