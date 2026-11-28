import { useState } from "react";
import { findByName, nameProblem, SAVED_NAME_MAX } from "@lol-viewer/core";
import { Modal } from "./Modal.tsx";

/**
 * Ask for a name (save a roster, save a matchup, rename a matchup). A name that is already taken is either overwritten
 * (`mode="save"`, the button says Overwrite) or refused (`mode="rename"`).
 */
export function NameDialog({
  host,
  title,
  label,
  initial,
  list,
  selfId,
  mode,
  confirm = "Save",
  hint,
  onSubmit,
  onClose,
}: {
  host: HTMLElement | null;
  title: string;
  /** The field's label. */
  label: string;
  initial: string;
  list: readonly { id: string; name: string }[];
  /** The item being renamed (its own name is not a clash). */
  selfId?: string;
  mode: "save" | "rename";
  confirm?: string;
  hint?: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const problem = nameProblem(name);
  const clash = problem === null ? findByName(list, name) : undefined;
  const taken = clash && clash.id !== selfId ? clash : undefined;
  const overwrite = mode === "save" && !!taken;
  const blocked = problem !== null || (mode === "rename" && !!taken);
  return (
    <Modal host={host} label={title} title={title} onClose={onClose} className="name-dialog">
      <form
        className="name-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!blocked) onSubmit(name.trim());
        }}
      >
        <div className="field">
          <label htmlFor="name-dialog-input">{label}</label>
          <input id="name-dialog-input" autoFocus type="text" value={name} maxLength={SAVED_NAME_MAX + 20} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.currentTarget.select()} />
        </div>
        {problem === "long" && <p className="err-text small">Use {SAVED_NAME_MAX} characters or fewer.</p>}
        {overwrite && (
          <p className="warn-text small" role="status">
            Overwrite “{taken!.name}”? Its saved content is replaced.
          </p>
        )}
        {mode === "rename" && taken && (
          <p className="err-text small" role="status">
            That name is already used.
          </p>
        )}
        {hint && !overwrite && !taken && <p className="muted small">{hint}</p>}
        <div className="add-actions">
          <button type="submit" className="btn primary" disabled={blocked}>
            {overwrite ? "Overwrite" : confirm}
          </button>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
