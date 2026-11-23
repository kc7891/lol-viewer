import { getChampion } from "./champions.ts";
import type { UrlTemplates } from "./settings.ts";
import type { Viewer } from "./workspace.ts";

/** Append `lane=<lane>` with `?` or `&` depending on what the URL already has. */
function withLane(url: string, lane: string): string {
  const sep = url.endsWith("?") || url.endsWith("&") ? "" : url.includes("?") ? "&" : "?";
  return `${url}${sep}lane=${lane}`;
}

/**
 * The page a viewer shows, or null while it has no champion. Names are the champion
 * slug (Wukong -> "wukong", M-004). Nothing is URL-encoded.
 *  - build + opponent: the Matchup template ({champion_name1} {champion_name2} {lane_name}; no lane -> "")
 *  - build: the Build template ({name}), plus lane=<lane> when a lane is set
 *  - counter: the Counter template, plus lane=<lane> when a lane is set (the opponent is ignored)
 *  - aram: the ARAM template (lane and opponent are ignored)
 */
export function viewerUrl(
  viewer: Pick<Viewer, "championId" | "opponentId" | "lane" | "mode">,
  templates: UrlTemplates,
): string | null {
  const champ = getChampion(viewer.championId);
  if (!champ) return null;
  const lane = viewer.lane ?? "";
  switch (viewer.mode) {
    case "aram":
      return templates.aram.replaceAll("{name}", champ.slug);
    case "counter": {
      const url = templates.counter.replaceAll("{name}", champ.slug);
      return lane ? withLane(url, lane) : url;
    }
    case "build": {
      const opp = getChampion(viewer.opponentId);
      if (opp) {
        return templates.matchup
          .replaceAll("{champion_name1}", champ.slug)
          .replaceAll("{champion_name2}", opp.slug)
          .replaceAll("{lane_name}", lane);
      }
      const url = templates.build.replaceAll("{name}", champ.slug);
      return lane ? withLane(url, lane) : url;
    }
  }
}

/** The Live Game page. */
export function liveGameUrl(templates: UrlTemplates): string {
  return templates.liveGame.trim();
}
