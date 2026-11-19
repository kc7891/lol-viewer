import type { MatchState } from "@lol-viewer/protocol";
import type { ViewerTarget } from "./urls.ts";

/**
 * Viewers that should be open automatically for a match state
 * (same idea as the Python app: Build for my pick, plus my lane matchup and
 * Counter pages for enemy picks).
 */
export function autoViewers(state: MatchState): ViewerTarget[] {
  const out: ViewerTarget[] = [];
  const me = state.self;
  if (me) {
    out.push({ kind: "build", championId: me.championId });
    const row = state.matchups.find((r) => r.lane === me.lane);
    if (row?.enemyChampionId != null && me.lane) {
      out.push({ kind: "matchup", championId: me.championId, opponentId: row.enemyChampionId, lane: me.lane });
    }
  }
  for (const e of state.enemies) {
    if (e.championId != null) out.push({ kind: "counter", championId: e.championId });
  }
  return out;
}
