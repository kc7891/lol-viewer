import type { Lane } from "@lol-viewer/protocol";
import { getChampion } from "./champions.ts";

/** Same defaults as ../../constants.py (DEFAULT_*_URL). */
export const URL_TEMPLATES = {
  build: "https://lolalytics.com/lol/{name}/build/",
  counter: "https://lolalytics.com/lol/{name}/counters/",
  matchup: "https://lolalytics.com/lol/{champion_name1}/vs/{champion_name2}/build/?lane={lane_name}&vslane={lane_name}",
  aram: "https://u.gg/lol/champions/aram/{name}-aram",
} as const;

export type ViewerKind = keyof typeof URL_TEMPLATES;

export type ViewerTarget = {
  kind: ViewerKind;
  championId: number;
  opponentId?: number | null;
  lane?: Lane | null;
};

export function buildViewerUrl(t: ViewerTarget, templates = URL_TEMPLATES): string | null {
  const champ = getChampion(t.championId);
  if (!champ) return null;
  if (t.kind === "matchup") {
    const opp = getChampion(t.opponentId);
    if (!opp) return null;
    return templates.matchup
      .replaceAll("{champion_name1}", champ.slug)
      .replaceAll("{champion_name2}", opp.slug)
      .replaceAll("{lane_name}", t.lane ?? "");
  }
  return templates[t.kind].replaceAll("{name}", champ.slug);
}

/** Stable id so the same target reuses the same native view. */
export function viewerId(t: ViewerTarget): string {
  return [t.kind, t.championId, t.opponentId ?? "", t.lane ?? ""].join(":").replace(/:+$/, "");
}
