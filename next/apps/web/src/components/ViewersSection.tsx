import { MAX_VIEWERS, getChampion, type Viewer, type Workspace } from "@lol-viewer/core";
import { ChampionIcon } from "./ChampionIcon.tsx";
import { IconClose, IconEye, IconEyeOff, IconPlus, IconTrash } from "../ui/icons.tsx";
import { MODE_LABEL } from "../ui/labels.ts";

export type ViewersSectionProps = {
  ws: Workspace;
  onAdd: () => void;
  onCloseAll: () => void;
  onClose: (id: number) => void;
  onToggleHidden: (id: number) => void;
  /** Row click: scroll to the pane. */
  onFocus: (id: number) => void;
  onOpenPending: (championId: number) => void;
  onRemovePending: (championId: number) => void;
};

function viewerName(v: Viewer): string {
  return getChampion(v.championId)?.name ?? "New viewer";
}

/** M-006: a row is the icon, the name and the page type. Nothing about hidden state or the opponent. */
export function ViewersSection({ ws, onAdd, onCloseAll, onClose, onToggleHidden, onFocus, onOpenPending, onRemovePending }: ViewersSectionProps) {
  return (
    <>
      <section className="side-section viewers" aria-label="Viewers">
        <header className="section-head">
          <h2>
            Viewers <span className="count">{ws.viewers.length}/{MAX_VIEWERS}</span>
          </h2>
          <div className="head-actions">
            <button type="button" className="icon-btn" aria-label="Add viewer" title="Add viewer" onClick={onAdd}>
              <IconPlus />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Close all viewers"
              title="Close all viewers and enemy picks"
              disabled={ws.viewers.length === 0 && ws.pending.length === 0}
              onClick={onCloseAll}
            >
              <IconTrash />
            </button>
          </div>
        </header>
        {ws.viewers.length === 0 ? (
          <p className="hint">No viewers.</p>
        ) : (
          <ul className="row-list">
            {[...ws.viewers.filter((v) => v.picked), ...ws.viewers.filter((v) => !v.picked)].map((v) => (
              <li key={v.id} className="row" data-viewer-id={v.id}>
                <button
                  type="button"
                  className="row-main"
                  title="Click: go to the pane. Double-click: show / hide"
                  onClick={() => onFocus(v.id)}
                  onDoubleClick={() => onToggleHidden(v.id)}
                >
                  <ChampionIcon id={v.championId} size={28} />
                  <span className="name">{viewerName(v)}</span>
                  <span className="kind" data-mode={v.mode}>
                    {MODE_LABEL[v.mode]}
                  </span>
                </button>
                <span className="row-actions">
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`${v.hidden ? "Show" : "Hide"} ${viewerName(v)}`}
                    title={v.hidden ? "Show" : "Hide"}
                    onClick={() => onToggleHidden(v.id)}
                  >
                    {v.hidden ? <IconEyeOff size={14} /> : <IconEye size={14} />}
                  </button>
                  <button type="button" className="icon-btn" aria-label={`Close ${viewerName(v)}`} title="Close" onClick={() => onClose(v.id)}>
                    <IconClose size={14} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {ws.pending.length > 0 && (
        <section className="side-section pending" aria-label="Enemy picks">
          <header className="section-head">
            <h2>
              Enemy picks <span className="count">{ws.pending.length}</span>
            </h2>
          </header>
          <ul className="row-list">
            {ws.pending.map((id) => {
              const c = getChampion(id);
              return (
                <li key={id} className="row" data-pending-id={id}>
                  <button
                    type="button"
                    className="row-main"
                    title="Double-click or + to open a Counter viewer"
                    onDoubleClick={() => onOpenPending(id)}
                  >
                    <ChampionIcon id={id} size={28} />
                    <span className="name">{c?.name ?? "?"}</span>
                    <span className="kind" data-mode="counter">
                      Counter
                    </span>
                  </button>
                  <span className="row-actions always">
                    <button type="button" className="icon-btn" aria-label={`Open Counter for ${c?.name ?? "?"}`} title="Open Counter viewer" onClick={() => onOpenPending(id)}>
                      <IconPlus size={14} />
                    </button>
                    <button type="button" className="icon-btn" aria-label={`Remove ${c?.name ?? "?"}`} title="Remove" onClick={() => onRemovePending(id)}>
                      <IconClose size={14} />
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
