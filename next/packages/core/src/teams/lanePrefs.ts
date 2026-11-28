/**
 * The lane chip of one person (Teams UI v2, M-040): none -> prefer (star) -> lock -> avoid -> none.
 * Pure functions on one person's TeamPlayerPref. `mains` keeps the order old -> new, so a third star pushes out the oldest.
 */
import type { Lane } from "@lol-viewer/protocol";
import type { TeamPlayerPref } from "../settings.ts";

export type LaneState = "none" | "prefer" | "lock" | "avoid";
export const MAX_PREFER = 2;

export function laneState(pref: TeamPlayerPref | null | undefined, lane: Lane): LaneState {
  if (pref?.lock === lane) return "lock";
  if (pref?.ng?.includes(lane)) return "avoid";
  if (pref?.mains?.includes(lane)) return "prefer";
  return "none";
}

/** A preference with no empty fields (and `{}` when nothing is left). */
function tidy(pref: TeamPlayerPref): TeamPlayerPref {
  const out: TeamPlayerPref = {};
  if (pref.lock !== undefined) out.lock = pref.lock;
  if (pref.mains?.length) out.mains = pref.mains;
  if (pref.ng?.length) out.ng = pref.ng;
  if (pref.rankOverride !== undefined) out.rankOverride = pref.rankOverride;
  return out;
}

/** Put `lane` into exactly one state (the rank override is kept). A lane is never starred and avoided at once. */
function withLaneState(pref: TeamPlayerPref | null | undefined, lane: Lane, to: LaneState): TeamPlayerPref {
  const mains = (pref?.mains ?? []).filter((l) => l !== lane);
  const ng = (pref?.ng ?? []).filter((l) => l !== lane);
  let lock = pref?.lock === lane ? undefined : pref?.lock;
  if (to === "prefer") mains.push(lane);
  else if (to === "avoid") ng.push(lane);
  else if (to === "lock") lock = lane; // the previous lock (another lane) simply goes back to none
  // A lane that is locked cannot also be starred or avoided.
  return tidy({ ...(pref ?? {}), lock, mains: (lock ? mains.filter((l) => l !== lock) : mains).slice(-MAX_PREFER), ng: lock ? ng.filter((l) => l !== lock) : ng });
}

export const CYCLE: Record<LaneState, LaneState> = { none: "prefer", prefer: "lock", lock: "avoid", avoid: "none" };

/** One click on a chip. */
export function cycleLane(pref: TeamPlayerPref | null | undefined, lane: Lane): TeamPlayerPref {
  return withLaneState(pref, lane, CYCLE[laneState(pref, lane)]);
}

/** Right-click / Delete on a chip. */
export function clearLane(pref: TeamPlayerPref | null | undefined, lane: Lane): TeamPlayerPref {
  return withLaneState(pref, lane, "none");
}

export const hasPref = (pref: TeamPlayerPref | null | undefined): boolean => !!pref && Object.keys(tidy(pref)).length > 0;
