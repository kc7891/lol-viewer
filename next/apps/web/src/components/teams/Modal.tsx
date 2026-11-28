import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconClose } from "../../ui/icons.tsx";

/**
 * A modal dialog of the Teams page (M-041, M-042): rendered by a portal into `host` (a div inside the page's panel, so it hides with the page),
 * Tab stays inside, Esc and a click on the dimmed backdrop close it, and the focus goes back to what had it when the dialog opened.
 * Mount it only while it is open. An element marked `data-esc-local` handles its own Esc (the dialog stays open).
 */
export function Modal({ host, label, title, onClose, className = "", children }: { host: HTMLElement | null; label: string; title: string; onClose: () => void; className?: string; children: ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const opener = useRef<Element | null>(typeof document === "undefined" ? null : document.activeElement);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if ((e.target as Element | null)?.closest?.("[data-esc-local]")) return;
      e.stopPropagation();
      close.current();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);
  // The focus goes to the first field (autoFocus), else to the dialog itself; on close it returns to the opener.
  useEffect(() => {
    if (wrap.current && !wrap.current.contains(document.activeElement)) wrap.current.focus();
    const back = opener.current;
    return () => {
      if (back instanceof HTMLElement && back.isConnected) back.focus();
    };
  }, [host]);

  const trapTab = (e: KeyboardEvent) => {
    const el = wrap.current;
    if (e.key !== "Tab" || !el) return;
    const items = [...el.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])")];
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const at = document.activeElement;
    if (e.shiftKey && (at === first || at === el || !el.contains(at))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (at === last || !el.contains(at))) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!host) return null;
  return createPortal(
    <div
      className="overlay-backdrop"
      onMouseDown={(e) => {
        // A click on the dimmed backdrop closes, and the focus goes back to the opener (not to the page).
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        onClose();
      }}
    >
      <div ref={wrap} tabIndex={-1} className={`add-dialog card ${className}`} role="dialog" aria-modal="true" aria-label={label} onKeyDown={trapTab}>
        <div className="add-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <IconClose />
          </button>
        </div>
        {children}
      </div>
    </div>,
    host,
  );
}
