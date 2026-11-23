import { useEffect, useLayoutEffect, useRef } from "react";
import type { Rect } from "@lol-viewer/protocol";
import { useBridge, useSuppressViews } from "../bridge/context.tsx";
import { IconExternal } from "../ui/icons.tsx";

/**
 * The rectangle of `el` clipped to the nearest ancestor marked `data-view-clip`
 * (the horizontally scrolling pane strip), so a native view never paints over the
 * sidebar or top bar when its pane is scrolled partly out of sight.
 */
function visibleRect(el: HTMLElement): Rect & { empty: boolean } {
  const r = el.getBoundingClientRect();
  let left = r.left;
  let top = r.top;
  let right = r.right;
  let bottom = r.bottom;
  const clip = el.closest<HTMLElement>("[data-view-clip]");
  if (clip) {
    const c = clip.getBoundingClientRect();
    left = Math.max(left, c.left);
    top = Math.max(top, c.top);
    right = Math.min(right, c.right);
    bottom = Math.min(bottom, c.bottom);
  }
  const width = Math.max(0, Math.round(right - left));
  const height = Math.max(0, Math.round(bottom - top));
  return {
    x: Math.max(0, Math.round(left)),
    y: Math.max(0, Math.round(top)),
    width,
    height,
    empty: width < 2 || height < 2,
  };
}

export type ExternalViewSlotProps = {
  viewId: string;
  url: string;
  /** Bumped by the workspace every time the page is "opened"; a change reloads even the same URL. */
  nav?: number;
  /** False while a panel, another page or an app-wide modal covers this slot (the native view is hidden, not unloaded). */
  active?: boolean;
};

/**
 * A hole in the layout where a third-party page appears.
 *
 * - Electron: the main process overlays a native WebContentsView exactly on
 *   this element's rectangle (no iframe; third-party pages never enter our DOM).
 * - Browser / Storybook: renders a placeholder with an "open in new tab" link.
 */
export function ExternalViewSlot({ viewId, url, nav = 0, active = true }: ExternalViewSlotProps) {
  const ref = useRef<HTMLDivElement>(null);
  const views = useBridge().views;
  const suppressed = useSuppressViews();
  const visible = active && !suppressed;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const lastNav = useRef<number | null>(null);
  const lastKey = useRef("");
  const hiddenByClip = useRef(false);

  // Bounds tracking + lifetime of the native view.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!views || !el) return;
    const sync = () => {
      const b = visibleRect(el);
      const clippedAway = b.empty;
      if (clippedAway !== hiddenByClip.current) {
        hiddenByClip.current = clippedAway;
        views.command({ type: "setVisible", viewId, visible: visibleRef.current && !clippedAway });
      }
      if (clippedAway) return;
      const key = `${b.x},${b.y},${b.width},${b.height}`;
      if (key === lastKey.current) return;
      lastKey.current = key;
      views.command({ type: "setBounds", viewId, bounds: { x: b.x, y: b.y, width: b.width, height: b.height } });
    };
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    ro.observe(document.body);
    window.addEventListener("resize", sync);
    // The pane strip scrolls horizontally: scroll events do not bubble, so capture them.
    window.addEventListener("scroll", sync, true);
    const raf = requestAnimationFrame(sync);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
      views.command({ type: "detach", viewId });
      lastNav.current = null;
      lastKey.current = "";
      hiddenByClip.current = false;
    };
  }, [views, viewId]);

  // Show + load. Same URL is only re-opened when nav changed (force).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!views || !el) return;
    const b = visibleRect(el);
    const force = lastNav.current !== null && lastNav.current !== nav;
    lastNav.current = nav;
    lastKey.current = `${b.x},${b.y},${b.width},${b.height}`;
    views.command({
      type: "attach",
      viewId,
      url,
      bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
      ...(force ? { force: true } : {}),
    });
    views.command({ type: "setVisible", viewId, visible: visibleRef.current && !hiddenByClip.current });
  }, [views, viewId, url, nav]);

  useEffect(() => {
    views?.command({ type: "setVisible", viewId, visible: visible && !hiddenByClip.current });
  }, [views, viewId, visible]);

  return (
    <div className="slot" ref={ref} data-view-id={viewId} data-nav={nav}>
      {!views && (
        <div className="slot-placeholder">
          <div className="slot-title">External page</div>
          <div className="slot-note">Shown natively in the desktop app</div>
          <code data-testid="slot-url">{url}</code>
          <a href={url} target="_blank" rel="noopener noreferrer">
            Open in new tab <IconExternal size={12} />
          </a>
        </div>
      )}
    </div>
  );
}
