import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * Close something that floats when Esc is pressed (focus goes back to `returnTo`) or when the click lands outside `ref`.
 * Used by the rank popover, the menus and the add-people list of the Teams page.
 */
export function useDismiss(open: boolean, ref: React.RefObject<HTMLElement | null>, onClose: () => void, returnTo?: React.RefObject<HTMLElement | null>) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close.current();
      returnTo?.current?.focus();
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close.current();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, ref, returnTo]);
}

export type MenuItem = {
  label: string;
  onSelect: () => void;
  /** A checkbox item: shown with a check, and the menu stays open when it is chosen. */
  checked?: boolean;
  /** The menu stays open after this item (e.g. the first click of a two-click action). */
  keepOpen?: boolean;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
  /** Why the item is off (shown under it, and as its tooltip). */
  note?: string;
};

/** A button that opens a small menu (role="menu"). Up / Down move, Enter / Space choose, Esc closes. */
export function MenuButton({
  label,
  trigger,
  items,
  className = "icon-btn",
  align = "right",
  initialOpen = false,
  title,
  onClose,
}: {
  label: string;
  trigger: ReactNode;
  items: MenuItem[];
  className?: string;
  align?: "left" | "right";
  initialOpen?: boolean;
  title?: string;
  /** Called whenever the menu has closed (Esc, a click outside, an item, the button). */
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(initialOpen);
  const wasOpen = useRef(open);
  const closed = useRef(onClose);
  closed.current = onClose;
  useEffect(() => {
    if (wasOpen.current && !open) closed.current?.();
    wasOpen.current = open;
  }, [open]);
  const wrap = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();
  useDismiss(open, wrap, () => setOpen(false), btn);
  const focusItem = (dir: 1 | -1) => {
    const all = [...(wrap.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)') ?? [])];
    if (!all.length) return;
    const at = all.indexOf(document.activeElement as HTMLElement);
    all[(at + dir + all.length) % all.length]!.focus();
  };
  useEffect(() => {
    if (open && !initialOpen) wrap.current?.querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled)')?.focus();
  }, [open, initialOpen]);
  return (
    <span className="menu-wrap" ref={wrap}>
      <button ref={btn} type="button" className={className} aria-label={label} title={title ?? label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((o) => !o)}>
        {trigger}
      </button>
      {open && (
        <div
          id={id}
          role="menu"
          aria-label={label}
          className="menu"
          data-align={align}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") (e.preventDefault(), focusItem(1));
            if (e.key === "ArrowUp") (e.preventDefault(), focusItem(-1));
          }}
        >
          {items.map((it) => (
            <Fragment key={it.label}>
            <button
              type="button"
              role={it.checked === undefined ? "menuitem" : "menuitemcheckbox"}
              aria-checked={it.checked}
              className="menu-item"
              data-danger={it.danger || undefined}
              data-sep={it.separatorBefore || undefined}
              disabled={it.disabled}
              title={it.note}
              onClick={() => {
                it.onSelect();
                if (!it.keepOpen && it.checked === undefined) {
                  setOpen(false);
                  btn.current?.focus();
                }
              }}
            >
              <span className="menu-check" aria-hidden>
                {it.checked ? "✓" : ""}
              </span>
              {it.label}
            </button>
            {it.note && (
              <p className="menu-note small muted" data-testid="menu-note">
                {it.note}
              </p>
            )}
            </Fragment>
          ))}
        </div>
      )}
    </span>
  );
}
