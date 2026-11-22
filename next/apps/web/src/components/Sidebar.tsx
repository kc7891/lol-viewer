import { useRef, type PointerEvent, type ReactNode } from "react";
import { SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN } from "@lol-viewer/core";

export type SidebarProps = {
  width: number;
  onWidth: (w: number) => void;
  onCommitWidth: (w: number) => void;
  onDragging: (dragging: boolean) => void;
  children: ReactNode;
  footer?: ReactNode;
};

const clamp = (w: number) => Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(w)));

/** Left column of the Viewers page: scrolling sections + a footer for toasts + a drag handle for the width. */
export function Sidebar({ width, onWidth, onCommitWidth, onDragging, children, footer }: SidebarProps) {
  const latest = useRef(width);
  latest.current = width;

  const start = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const w0 = latest.current;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    onDragging(true);
    const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui-scale")) || 1;
    const move = (ev: globalThis.PointerEvent) => onWidth(clamp(w0 + (ev.clientX - startX) / scale));
    const up = () => {
      onDragging(false);
      onCommitWidth(latest.current);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  return (
    <aside className="sidebar" style={{ width: `calc(${width}px * var(--ui-scale, 1))` }} aria-label="Sidebar">
      <div className="sidebar-scroll">{children}</div>
      {footer}
      <div
        className="sidebar-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuenow={width}
        aria-valuemin={SIDEBAR_WIDTH_MIN}
        aria-valuemax={SIDEBAR_WIDTH_MAX}
        tabIndex={0}
        onPointerDown={start}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            const w = clamp(width + (e.key === "ArrowRight" ? 16 : -16));
            onWidth(w);
            onCommitWidth(w);
          }
        }}
      />
    </aside>
  );
}
