import { useEffect, useLayoutEffect, useRef } from "react";
import type { Rect } from "@lol-viewer/protocol";
import { useBridge, useSuppressViews } from "../bridge/context.tsx";

function rectOf(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  return {
    x: Math.max(0, Math.round(r.left)),
    y: Math.max(0, Math.round(r.top)),
    width: Math.max(0, Math.round(r.width)),
    height: Math.max(0, Math.round(r.height)),
  };
}

/**
 * A hole in the layout where a third-party page appears.
 *
 * - Electron: the main process overlays a native WebContentsView exactly on
 *   this element's rectangle (no iframe; third-party pages never enter our DOM).
 * - Browser / Storybook: renders a placeholder with an "open in new tab" link.
 */
export function ExternalViewSlot({ viewId, url, active = true }: { viewId: string; url: string; active?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const views = useBridge().views;
  const suppressed = useSuppressViews();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!views || !el) return;
    views.command({ type: "attach", viewId, url, bounds: rectOf(el) });
    let last = "";
    const sync = () => {
      const b = rectOf(el);
      const key = `${b.x},${b.y},${b.width},${b.height}`;
      if (key === last) return;
      last = key;
      views.command({ type: "setBounds", viewId, bounds: b });
    };
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    ro.observe(document.body);
    window.addEventListener("resize", sync);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
      views.command({ type: "detach", viewId });
    };
  }, [views, viewId, url]);

  useEffect(() => {
    views?.command({ type: "setVisible", viewId, visible: active && !suppressed });
  }, [views, viewId, active, suppressed]);

  return (
    <div className="slot" ref={ref} data-view-id={viewId}>
      {!views && (
        <div className="slot-placeholder">
          <div>External view (native in desktop app)</div>
          <code>{url}</code>
          <a href={url} target="_blank" rel="noopener noreferrer">
            Open in new tab ↗
          </a>
        </div>
      )}
    </div>
  );
}
