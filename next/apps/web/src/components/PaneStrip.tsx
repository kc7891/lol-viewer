import { useEffect, useLayoutEffect, useRef, useState, type Dispatch, type PointerEvent } from "react";
import type { Viewer, Workspace, WorkspaceAction } from "@lol-viewer/core";
import { SuppressViews } from "../bridge/context.tsx";
import type { ToastKind } from "../state/toasts.tsx";
import { ViewerPane, type PanelKind, type ViewerPaneProps } from "./ViewerPane.tsx";

export const MIN_PANE_WIDTH = 300;

/** Equal split of the strip, never narrower than MIN_PANE_WIDTH. */
export function equalWidth(containerWidth: number, count: number): number {
  return Math.max(MIN_PANE_WIDTH, Math.floor(containerWidth / Math.max(1, count)));
}

export type PaneStripProps = {
  ws: Workspace;
  dispatch: Dispatch<WorkspaceAction>;
  templates: ViewerPaneProps["templates"];
  qrEnabled: boolean;
  highlightId: number | null;
  notify: (text: string, kind?: ToastKind) => void;
  /** Stories: pane id -> panel that starts open. */
  initialPanels?: Record<number, PanelKind>;
  /** The "add viewer" action for the empty state. */
  onAdd: () => void;
};

/**
 * The pane row: visible viewers side by side, equal widths after every addition,
 * drag the handle between two panes to trade width (min 300), scroll sideways when they do not fit.
 */
export function PaneStrip({ ws, dispatch, templates, qrEnabled, highlightId, notify, initialPanels, onAdd }: PaneStripProps) {
  const visible: Viewer[] = ws.viewers.filter((v) => !v.hidden);
  const scroller = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  /** Widths set by dragging; null = equal split. */
  const [custom, setCustom] = useState<Record<number, number> | null>(null);
  const [dragging, setDragging] = useState(false);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    setContainerWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setContainerWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Every addition (or un-hiding) goes back to an equal split.
  const prevCount = useRef(visible.length);
  useEffect(() => {
    if (visible.length > prevCount.current) setCustom(null);
    prevCount.current = visible.length;
  }, [visible.length]);

  const eq = equalWidth(containerWidth, visible.length);
  const widthOf = (v: Viewer) => custom?.[v.id] ?? eq;

  const startDrag = (i: number) => (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const left = visible[i]!;
    const right = visible[i + 1]!;
    const startX = e.clientX;
    const w0 = visible.map(widthOf);
    const total = w0[i]! + w0[i + 1]!;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    setDragging(true);
    const onMove = (ev: globalThis.PointerEvent) => {
      const a = Math.min(total - MIN_PANE_WIDTH, Math.max(MIN_PANE_WIDTH, w0[i]! + ev.clientX - startX));
      setCustom({ ...Object.fromEntries(visible.map((v, k) => [v.id, w0[k]!])), [left.id]: a, [right.id]: total - a });
    };
    const onUp = () => {
      setDragging(false);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  return (
    <SuppressViews when={dragging}>
      <div className="strip" ref={scroller} data-view-clip data-dragging={dragging || undefined}>
        {visible.length === 0 && (
          <div className="empty-card">
            <h2>{ws.viewers.length > 0 ? "All viewers are hidden" : "No viewers yet"}</h2>
            <p>
              {ws.viewers.length > 0
                ? "Use the eye button in the sidebar to show them again."
                : "Viewers open by themselves when you pick a champion in champion select. You can also open one by hand."}
            </p>
            <button type="button" className="btn primary" onClick={onAdd}>
              Add viewer
            </button>
          </div>
        )}
        {visible.map((v, i) => (
          <div
            key={v.id}
            className="pane-cell"
            style={{ flex: `${i === visible.length - 1 ? 1 : 0} 0 ${widthOf(v)}px`, minWidth: MIN_PANE_WIDTH }}
          >
            <ViewerPane
              viewer={v}
              ws={ws}
              dispatch={dispatch}
              templates={templates}
              qrEnabled={qrEnabled}
              highlighted={highlightId === v.id}
              notify={notify}
              initialPanel={initialPanels?.[v.id] ?? null}
            />
            {i < visible.length - 1 && (
              <div
                className="pane-handle"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize panes"
                data-handle={i}
                onPointerDown={startDrag(i)}
              />
            )}
          </div>
        ))}
      </div>
    </SuppressViews>
  );
}
