import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { IconClose } from "../ui/icons.tsx";

/** Shared chrome of the pane panels (champion picker, lane picker, QR): a title bar and Esc to close. */
export function PanelFrame({
  title,
  onClose,
  children,
  focusSelf = true,
  className = "",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Focus the frame itself on mount so Esc works (the champion picker focuses its search input instead). */
  focusSelf?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focusSelf) ref.current?.focus();
  }, [focusSelf]);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  };
  return (
    <section ref={ref} tabIndex={-1} className={`panel ${className}`} aria-label={title} onKeyDown={onKeyDown}>
      <header className="panel-head">
        <h3>{title}</h3>
        <button type="button" className="icon-btn" aria-label="Close panel" title="Close (Esc)" onClick={onClose}>
          <IconClose />
        </button>
      </header>
      {children}
    </section>
  );
}
