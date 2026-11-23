import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { CHAMPIONS, getChampion, searchChampions, type Champion } from "@lol-viewer/core";
import { ChampionIcon } from "./ChampionIcon.tsx";
import { PanelFrame } from "./PanelFrame.tsx";
import { IconSearch } from "../ui/icons.tsx";

type Item = { key: string; section: "none" | "suggested" | "all"; id: number | null };

export type ChampionPanelProps = {
  title: string;
  /** The currently chosen champion (marked in the grid). */
  value: number | null;
  /** Opponent picker: shown first while the search box is empty. */
  suggested?: number[];
  /** Opponent picker: a "None" entry that clears the opponent. */
  allowNone?: boolean;
  onPick: (championId: number | null) => void;
  onClose: () => void;
};

/**
 * Champion grid with search (English, Japanese, hiragana). The search box keeps focus:
 * arrows move the highlight, Enter picks, Esc closes.
 */
export function ChampionPanel({ title, value, suggested = [], allowNone = false, onPick, onClose }: ChampionPanelProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const searching = query.trim() !== "";
  const results = useMemo<Champion[]>(() => (searching ? searchChampions(query, CHAMPIONS.length) : [...CHAMPIONS]), [query, searching]);
  const sugg = useMemo(() => (searching ? [] : suggested.filter((id) => getChampion(id))), [searching, suggested]);

  const items = useMemo<Item[]>(
    () => [
      ...(allowNone ? [{ key: "none", section: "none" as const, id: null }] : []),
      ...sugg.map((id) => ({ key: `s${id}`, section: "suggested" as const, id })),
      ...results.map((c) => ({ key: `a${c.id}`, section: "all" as const, id: c.id })),
    ],
    [allowNone, sugg, results],
  );

  // The highlight starts on the first real champion, not on "None".
  useEffect(() => {
    const first = items.findIndex((i) => i.id != null);
    setActive(first < 0 ? 0 : first);
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    root.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const move = (dir: "left" | "right" | "up" | "down") => {
    if (dir === "left") return setActive((i) => Math.max(0, i - 1));
    if (dir === "right") return setActive((i) => Math.min(items.length - 1, i + 1));
    // Up / down follow the real grid geometry (sections have different column offsets).
    const cells = [...(root.current?.querySelectorAll<HTMLElement>("[data-idx]") ?? [])];
    const cur = cells.find((c) => Number(c.dataset.idx) === active);
    if (!cur) return;
    const r = cur.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const candidates = cells.filter((c) => {
      const b = c.getBoundingClientRect();
      return dir === "down" ? b.top >= r.bottom - 2 : b.bottom <= r.top + 2;
    });
    if (!candidates.length) return;
    const rowOf = (c: HTMLElement) => Math.round(c.getBoundingClientRect().top);
    const nearestRow = dir === "down" ? Math.min(...candidates.map(rowOf)) : Math.max(...candidates.map(rowOf));
    const inRow = candidates.filter((c) => rowOf(c) === nearestRow);
    const best = inRow.reduce((a, b) => {
      const da = Math.abs(a.getBoundingClientRect().left + a.getBoundingClientRect().width / 2 - cx);
      const db = Math.abs(b.getBoundingClientRect().left + b.getBoundingClientRect().width / 2 - cx);
      return db < da ? b : a;
    });
    setActive(Number(best.dataset.idx));
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const dir = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" }[e.key] as
      | "left"
      | "right"
      | "up"
      | "down"
      | undefined;
    if (dir) {
      e.preventDefault();
      move(dir);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = items[active];
      if (it) onPick(it.id);
    }
  };

  const cell = (it: Item, idx: number) => {
    const c = getChampion(it.id);
    const isActive = idx === active;
    return (
      <button
        key={it.key}
        type="button"
        role="option"
        id={`champ-opt-${it.key}`}
        data-idx={idx}
        data-active={isActive}
        aria-selected={isActive}
        aria-current={it.id != null && it.id === value ? "true" : undefined}
        className="champ-cell"
        tabIndex={-1}
        onMouseDown={(e) => e.preventDefault() /* keep focus in the search box */}
        onClick={() => onPick(it.id)}
      >
        {c ? (
          <>
            <ChampionIcon id={c.id} size={32} />
            <span className="champ-names">
              <span className="en">{c.name}</span>
              <span className="ja">{c.nameJa}</span>
            </span>
          </>
        ) : (
          <span className="champ-names">
            <span className="en">None</span>
            <span className="ja">Clear the opponent</span>
          </span>
        )}
      </button>
    );
  };

  const idxOf = (it: Item) => items.indexOf(it);
  const noneItem = items.find((i) => i.section === "none");
  const suggItems = items.filter((i) => i.section === "suggested");
  const allItems = items.filter((i) => i.section === "all");

  return (
    <PanelFrame title={title} onClose={onClose} focusSelf={false} className="champion-panel">
      <div className="panel-search">
        <IconSearch size={14} />
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-label="Search champions"
          aria-expanded="true"
          aria-controls="champ-listbox"
          aria-activedescendant={items[active] ? `champ-opt-${items[active]!.key}` : undefined}
          placeholder="Search: ahri / アーリ / あーり"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck={false}
        />
        <span className="count">{results.length}</span>
      </div>
      <div className="panel-scroll" ref={root} role="listbox" id="champ-listbox" aria-label="Champions">
        {noneItem && <div className="champ-grid none">{cell(noneItem, idxOf(noneItem))}</div>}
        {suggItems.length > 0 && (
          <>
            <h4 className="grid-title">Suggested</h4>
            <div className="champ-grid">{suggItems.map((it) => cell(it, idxOf(it)))}</div>
          </>
        )}
        {(suggItems.length > 0 || noneItem) && allItems.length > 0 && (
          <h4 className="grid-title">{searching ? "Results" : "All champions"}</h4>
        )}
        {allItems.length === 0 ? (
          <div className="panel-empty">No champion matches “{query}”</div>
        ) : (
          <div className="champ-grid">{allItems.map((it) => cell(it, idxOf(it)))}</div>
        )}
      </div>
    </PanelFrame>
  );
}
