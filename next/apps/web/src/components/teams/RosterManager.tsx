import { useState } from "react";
import { deleteRoster, duplicateRoster, findByName, nameProblem, newestFirst, renameRoster, SAVED_NAME_MAX, type SavedRoster } from "@lol-viewer/core";
import { Modal } from "./Modal.tsx";

export const dateLabel = (at: number): string => new Date(at).toLocaleDateString("en", { month: "short", day: "numeric" });

/** Manage rosters…: every saved roster with its size and date; Rename (in the row), Duplicate (the copy opens in rename) and Delete (two clicks). */
export function RosterManager({ host, rosters, onChange, onClose, now, initialEditing }: { host: HTMLElement | null; rosters: readonly SavedRoster[]; onChange: (next: SavedRoster[]) => void; onClose: () => void; now: () => number; initialEditing?: string }) {
  const [editing, setEditing] = useState<string | null>(initialEditing ?? null);
  const [draft, setDraft] = useState(() => rosters.find((r) => r.id === initialEditing)?.name ?? "");
  const [armed, setArmed] = useState<string | null>(null);
  const rows = newestFirst(rosters);

  const edit = (r: SavedRoster) => {
    setEditing(r.id);
    setDraft(r.name);
    setArmed(null);
  };
  const clash = editing === null ? undefined : findByName(rosters, draft);
  const draftBad = nameProblem(draft) !== null || (!!clash && clash.id !== editing);
  const commit = () => {
    if (editing === null) return;
    if (!draftBad) onChange(renameRoster(rosters, editing, draft));
    setEditing(null);
  };
  const copy = (r: SavedRoster) => {
    const res = duplicateRoster(rosters, r.id, now());
    if (!res.item) return;
    onChange(res.list);
    setEditing(res.item.id);
    setDraft(res.item.name);
    setArmed(null);
  };
  return (
    <Modal host={host} label="Manage rosters" title="Manage rosters" onClose={onClose} className="roster-manager">
      {rows.length === 0 ? (
        <p className="muted">No saved rosters. Use Rosters › Save current as….</p>
      ) : (
        <ul className="roster-list">
          {rows.map((r) => (
            <li key={r.id} className="roster-row" data-id={r.id}>
              {editing === r.id ? (
                <div className="roster-edit">
                  <input
                    autoFocus
                    data-esc-local
                    aria-label={`Name of ${r.name}`}
                    aria-invalid={draftBad || undefined}
                    type="text"
                    value={draft}
                    maxLength={SAVED_NAME_MAX + 20}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.preventDefault(), commit());
                      if (e.key === "Escape") (e.preventDefault(), setEditing(null)); // the name stays as it is
                    }}
                  />
                  <button type="button" className="btn" disabled={draftBad} onClick={commit}>
                    Save name
                  </button>
                  <button type="button" className="btn ghost" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                  {draftBad && nameProblem(draft) === null && <span className="err-text small">That name is already used.</span>}
                  {nameProblem(draft) === "long" && <span className="err-text small">Use {SAVED_NAME_MAX} characters or fewer.</span>}
                </div>
              ) : (
                <>
                  <span className="roster-name">{r.name}</span>
                  <span className="muted small roster-meta">
                    {r.puuids.length} {r.puuids.length === 1 ? "person" : "people"} · {dateLabel(r.savedAt)}
                  </span>
                  <span className="roster-actions">
                    <button type="button" className="btn ghost" aria-label={`Rename ${r.name}`} onClick={() => edit(r)}>
                      Rename
                    </button>
                    <button type="button" className="btn ghost" aria-label={`Duplicate ${r.name}`} onClick={() => copy(r)}>
                      Duplicate
                    </button>
                    <button
                      type="button"
                      className="btn ghost danger"
                      aria-label={armed === r.id ? `Click again to delete ${r.name}` : `Delete ${r.name}`}
                      onBlur={() => setArmed((a) => (a === r.id ? null : a))}
                      onClick={() => {
                        if (armed !== r.id) return setArmed(r.id);
                        setArmed(null);
                        onChange(deleteRoster(rosters, r.id));
                      }}
                    >
                      {armed === r.id ? "Click again" : "Delete"}
                    </button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="add-actions">
        <button type="button" className="btn primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}
