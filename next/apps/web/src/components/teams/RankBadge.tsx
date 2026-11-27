import { useEffect, useId, useRef, useState } from "react";
import { effectiveRank, rankLabel, TIER_INITIAL, type TeamPlayerPref } from "@lol-viewer/core";
import type { TeamPlayer } from "@lol-viewer/protocol";
import { DIVISIONS, isApex, OVERRIDE_TIERS, overridePoints, rankDetails, tierName, tierOfPoints } from "./model.ts";
import { useDismiss } from "./Popover.tsx";

export type RankBadgeProps = {
  name: string;
  player: TeamPlayer | undefined;
  pref: TeamPlayerPref | undefined;
  now: number;
  /** points = set by hand; null = back to the fetched rank (Auto). */
  onChange: (points: number | null) => void;
  /** Stories: start with the popover open. */
  initialOpen?: boolean;
};

/**
 * The rank of one person as a button (M-040 §3.2). Click: a small popover with Auto, ten tiers and I-IV. A pick closes it; Esc closes it.
 * A gold frame means the rank was set by hand; a dotted frame, no rank at all (click to set one).
 */
export function RankBadge({ name, player, pref, now, onChange, initialOpen = false }: RankBadgeProps) {
  const [open, setOpen] = useState(initialOpen);
  const eff = effectiveRank(player, pref, now);
  const fetched = effectiveRank(player, undefined, now);
  const label = eff ? rankLabel(eff.points, eff.source) : "—";
  const tip = eff?.source === "manual" ? `Manual (fetched: ${fetched ? rankLabel(fetched.points, fetched.source) : "none"})\nClick to change.` : `${rankDetails(player, eff, now).join("\n")}\nClick to set a rank by hand.`;
  const wrap = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();
  useDismiss(open, wrap, () => setOpen(false), btn);
  return (
    <span className="rank-wrap" ref={wrap}>
      <button
        ref={btn}
        type="button"
        className="rank-chip"
        data-source={eff?.source ?? "none"}
        data-unknown={!eff || undefined}
        aria-label={`${name} rank: ${eff ? label : "none"}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        title={tip}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </button>
      {open && (
        <RankPopover
          id={id}
          name={name}
          current={pref?.rankOverride}
          onPick={(points) => {
            onChange(points);
            setOpen(false);
            btn.current?.focus();
          }}
        />
      )}
    </span>
  );
}

function RankPopover({ id, name, current, onPick }: { id: string; name: string; current: number | undefined; onPick: (points: number | null) => void }) {
  const now = current !== undefined ? tierOfPoints(current) : null;
  const [tier, setTier] = useState<string | null>(now?.tier ?? null);
  const [lp, setLp] = useState(now && isApex(now.tier) ? now.lp : 0);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  const apex = tier !== null && isApex(tier);
  return (
    <div id={id} role="dialog" aria-label={`Rank of ${name}`} className="rank-pop">
      <button ref={first} type="button" className="rp-auto" aria-pressed={current === undefined} onClick={() => onPick(null)}>
        Auto (fetched rank)
      </button>
      <div className="rp-row" role="group" aria-label="Tier">
        {OVERRIDE_TIERS.map((t) => (
          <button key={t} type="button" aria-label={tierName(t)} title={tierName(t)} aria-pressed={tier === t} onClick={() => setTier(t)}>
            {TIER_INITIAL[t]}
          </button>
        ))}
      </div>
      {tier !== null && !apex && (
        <div className="rp-row" role="group" aria-label="Division">
          {DIVISIONS.map((d) => (
            <button
              key={d}
              type="button"
              aria-label={`${tierName(tier)} ${d}`}
              aria-pressed={now?.tier === tier && now.division === d}
              onClick={() => {
                const points = overridePoints(tier, d, 0);
                if (points !== null) onPick(points);
              }}
            >
              {d}
            </button>
          ))}
        </div>
      )}
      {apex && (
        <div className="rp-row rp-lp">
          <label>
            LP
            <input type="number" min={0} max={2000} aria-label="LP" value={lp} onChange={(e) => setLp(Math.max(0, Math.min(2000, Number(e.target.value) || 0)))} />
          </label>
          <button type="button" className="btn" onClick={() => onPick(overridePoints(tier, "IV", lp))}>
            Set
          </button>
        </div>
      )}
    </div>
  );
}
