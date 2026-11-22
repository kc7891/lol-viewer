import { buildViewerUrl, getChampion, viewerId, type ViewerTarget } from "@lol-viewer/core";
import { ChampionIcon } from "./ChampionIcon.tsx";
import { ExternalViewSlot } from "./ExternalViewSlot.tsx";

export function viewerTitle(t: ViewerTarget): string {
  const a = getChampion(t.championId)?.name ?? "?";
  if (t.kind === "matchup") return `${a} vs ${getChampion(t.opponentId)?.name ?? "?"}`;
  return a;
}

export function ViewerPane({ target }: { target: ViewerTarget }) {
  const url = buildViewerUrl(target);
  return (
    <article className="viewer-pane" aria-label={viewerTitle(target)}>
      <header>
        <ChampionIcon id={target.championId} size={22} />
        <span className="title">{viewerTitle(target)}</span>
        <span className="kind">{target.kind}</span>
      </header>
      {url ? <ExternalViewSlot viewId={viewerId(target)} url={url} /> : <div className="empty-state">Unknown champion</div>}
    </article>
  );
}
