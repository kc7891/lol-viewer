import { useId } from "react";
import type { TeamPlayerPref } from "@lol-viewer/core";
import { LANES, type Lane } from "@lol-viewer/protocol";
import { LANE_LABEL } from "../../ui/labels.ts";
import { DIVISIONS, isApex, OVERRIDE_TIERS, overridePoints, tierName, tierOfPoints, toggleLane } from "./model.ts";

export type PrefPatch = Partial<Record<keyof TeamPlayerPref, TeamPlayerPref[keyof TeamPlayerPref] | undefined>>;

/** Manual settings for one person: locked lane, preferred lanes (up to 2), lanes to avoid, rank override. Saved in settings.teamPlayers. */
export function PlayerPrefsEditor({ pref, onChange }: { pref: TeamPlayerPref | undefined; onChange: (patch: PrefPatch) => void }) {
  const uid = useId();
  const override = pref?.rankOverride !== undefined ? tierOfPoints(pref.rankOverride) : null;
  const setTier = (tier: string) => {
    if (tier === "") return onChange({ rankOverride: undefined });
    const points = overridePoints(tier, override?.division ?? "IV", override?.lp ?? 0);
    if (points !== null) onChange({ rankOverride: points });
  };
  const laneButtons = (label: string, list: readonly Lane[] | undefined, onToggle: (lane: Lane) => void) => (
    <div className="pref-row" role="group" aria-label={label}>
      <span className="pref-label">{label}</span>
      <div className="seg">
        {LANES.map((lane) => (
          <button key={lane} type="button" aria-pressed={list?.includes(lane) ?? false} onClick={() => onToggle(lane)}>
            {LANE_LABEL[lane]}
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <div className="pref-editor">
      {laneButtons("Locked lane", pref?.lock ? [pref.lock] : [], (lane) => onChange({ lock: pref?.lock === lane ? undefined : lane }))}
      {laneButtons("Preferred lanes (up to 2)", pref?.mains, (lane) => onChange({ mains: toggleLane(pref?.mains, lane, 2) }))}
      {laneButtons("Avoid lanes", pref?.ng, (lane) => onChange({ ng: toggleLane(pref?.ng, lane) }))}
      <div className="pref-row" role="group" aria-label="Rank override">
        <span className="pref-label">Rank override</span>
        <select aria-label="Tier" value={override?.tier ?? ""} onChange={(e) => setTier(e.target.value)}>
          <option value="">Auto</option>
          {OVERRIDE_TIERS.map((t) => (
            <option key={t} value={t}>
              {tierName(t)}
            </option>
          ))}
        </select>
        {override && !isApex(override.tier) && (
          <select aria-label="Division" value={override.division} onChange={(e) => onChange({ rankOverride: overridePoints(override.tier, e.target.value, 0) ?? undefined })}>
            {DIVISIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        )}
        {override && isApex(override.tier) && (
          <>
            <input
              id={`${uid}-lp`}
              type="number"
              min={0}
              max={2000}
              aria-label="LP"
              className="lp-input"
              value={override.lp}
              onChange={(e) => onChange({ rankOverride: overridePoints(override.tier, "IV", Math.max(0, Math.min(2000, Number(e.target.value) || 0))) ?? undefined })}
            />
            <span className="muted">LP</span>
          </>
        )}
        {override && <span className="muted">Used instead of the fetched rank.</span>}
      </div>
    </div>
  );
}
