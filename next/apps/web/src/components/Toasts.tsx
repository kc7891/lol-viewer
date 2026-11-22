import type { Toast } from "../state/toasts.tsx";
import { IconCheck, IconClose, IconWarn } from "../ui/icons.tsx";

/** Bottom of the sidebar: never over an external page (those paint above HTML). */
export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="toasts" role="log" aria-live="polite" aria-label="Notifications">
      {toasts.map((t) => (
        <div key={t.id} className="toast" data-kind={t.kind}>
          <span className="toast-icon">{t.kind === "warn" ? <IconWarn size={14} /> : t.kind === "success" ? <IconCheck size={14} /> : null}</span>
          <span className="toast-text">{t.text}</span>
          <button type="button" className="icon-btn" aria-label="Dismiss notification" onClick={() => onDismiss(t.id)}>
            <IconClose size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
