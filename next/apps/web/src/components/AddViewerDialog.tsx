import { useEffect, useRef, useState } from "react";
import { getChampion, searchChampions, type ViewerKind, type ViewerTarget } from "@lol-viewer/core";
import { LANES, type Lane } from "@lol-viewer/protocol";
import { ChampionIcon } from "./ChampionIcon.tsx";

const KINDS: { kind: ViewerKind; label: string }[] = [
  { kind: "build", label: "Build" },
  { kind: "counter", label: "Counter" },
  { kind: "aram", label: "ARAM" },
  { kind: "matchup", label: "Matchup" },
];

const LANE_LABEL: Record<Lane, string> = { top: "Top", jungle: "Jungle", middle: "Mid", bottom: "Bot", support: "Support" };

function ChampionPicker({
  label,
  value,
  onChange,
  autoFocus,
}: {
  label: string;
  value: number | null;
  onChange: (id: number | null) => void;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus && value == null) inputRef.current?.focus();
  }, [autoFocus, value]);

  const champ = getChampion(value);
  if (champ) {
    return (
      <div className="picker">
        <span className="picker-label">{label}</span>
        <div className="picker-chosen">
          <ChampionIcon id={champ.id} size={22} />
          <span className="name">{champ.name}</span>
          <span className="ja">{champ.nameJa}</span>
          <button type="button" className="link" onClick={() => onChange(null)}>
            変更
          </button>
        </div>
      </div>
    );
  }

  const results = searchChampions(query, 30);
  return (
    <div className="picker">
      <label className="picker-label" htmlFor={`picker-${label}`}>
        {label}
      </label>
      <input
        id={`picker-${label}`}
        ref={inputRef}
        className="picker-input"
        placeholder="名前で検索（例: ahri / アーリ / あーり）"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && results[0]) {
            e.preventDefault();
            onChange(results[0].id);
          }
        }}
      />
      <ul className="picker-results" role="listbox" aria-label={`${label} results`}>
        {results.length === 0 && <li className="picker-empty">見つかりません</li>}
        {results.map((c) => (
          <li key={c.id}>
            <button type="button" role="option" aria-selected={false} className="picker-option" onClick={() => onChange(c.id)}>
              <ChampionIcon id={c.id} size={22} />
              <span className="name">{c.name}</span>
              <span className="ja">{c.nameJa}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export type AddViewerDialogProps = {
  onAdd: (target: ViewerTarget) => void;
  onClose: () => void;
  defaultLane?: Lane | null;
};

/** Manually open a viewer (same choices as the Python app: champion + page type). */
export function AddViewerDialog({ onAdd, onClose, defaultLane }: AddViewerDialogProps) {
  const [kind, setKind] = useState<ViewerKind>("build");
  const [championId, setChampionId] = useState<number | null>(null);
  const [opponentId, setOpponentId] = useState<number | null>(null);
  const [lane, setLane] = useState<Lane>(defaultLane ?? "top");

  const ready = championId != null && (kind !== "matchup" || opponentId != null);
  const submit = () => {
    if (!ready) return;
    onAdd(kind === "matchup" ? { kind, championId, opponentId, lane } : { kind, championId });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal add-viewer" role="dialog" aria-label="Add window" onClick={(e) => e.stopPropagation()}>
        <h3>ウィンドウを開く</h3>
        <div className="seg" role="group" aria-label="Page type">
          {KINDS.map((k) => (
            <button key={k.kind} type="button" aria-pressed={kind === k.kind} onClick={() => setKind(k.kind)}>
              {k.label}
            </button>
          ))}
        </div>
        <ChampionPicker label="Champion" value={championId} onChange={setChampionId} autoFocus />
        {kind === "matchup" && (
          <>
            <ChampionPicker label="Opponent" value={opponentId} onChange={setOpponentId} autoFocus={championId != null} />
            <div className="picker">
              <span className="picker-label" aria-hidden>
                Lane
              </span>
              <select aria-label="Lane" className="picker-input" value={lane} onChange={(e) => setLane(e.target.value as Lane)}>
                {LANES.map((l) => (
                  <option key={l} value={l}>
                    {LANE_LABEL[l]}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            キャンセル
          </button>
          <button type="button" className="btn primary" disabled={!ready} onClick={submit}>
            開く
          </button>
        </div>
      </div>
    </div>
  );
}
