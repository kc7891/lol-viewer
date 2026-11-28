import { clearLane, cycleLane, laneState, type TeamPlayerPref } from "@lol-viewer/core";
import { LANES, type TeamPlayer } from "@lol-viewer/protocol";
import { IconClose, IconLock, IconStar } from "../../ui/icons.tsx";
import { LANE_LABEL, LANE_SHORT } from "../../ui/labels.ts";
import { historyOf, LANE_CHIP_HINT, laneChipLabel } from "./model.ts";

export type LaneChipsProps = {
  name: string;
  pref: TeamPlayerPref | undefined;
  player: TeamPlayer | undefined;
  onChange: (pref: TeamPlayerPref) => void;
};

/**
 * The five lane chips of one person (Teams UI v2, M-040 §3.1). A click goes none -> ★ prefer -> 🔒 lock -> ✕ avoid -> none;
 * right-click, Delete or Backspace clears one. The line under a chip is the match history (thick = main lane, thin = sub lane).
 */
export function LaneChips({ name, pref, player, onChange }: LaneChipsProps) {
  const hist = historyOf(player);
  return (
    <span className="lane-chips" role="group" aria-label={`${name} lanes`}>
      {LANES.map((lane) => {
        const state = laneState(pref, lane);
        const share = hist.share[lane];
        const tip = [`${LANE_LABEL[lane]}. ${LANE_CHIP_HINT}`, share !== undefined ? `${LANE_SHORT[lane]} ${share}% of ${hist.games} recent games` : ""].filter(Boolean).join("\n");
        return (
          <button
            key={lane}
            type="button"
            className="lane-chip"
            data-lane={lane}
            data-state={state}
            data-hist={hist.main === lane ? "main" : hist.sub === lane ? "sub" : undefined}
            aria-label={laneChipLabel(name, lane, pref)}
            title={tip}
            onClick={() => onChange(cycleLane(pref, lane))}
            onContextMenu={(e) => {
              e.preventDefault();
              if (state !== "none") onChange(clearLane(pref, lane));
            }}
            onKeyDown={(e) => {
              if ((e.key === "Delete" || e.key === "Backspace") && !e.repeat) {
                e.preventDefault();
                if (state !== "none") onChange(clearLane(pref, lane));
              }
            }}
          >
            <span className="lc-label">{LANE_SHORT[lane]}</span>
            {state === "prefer" && <IconStar size={11} />}
            {state === "lock" && <IconLock size={11} />}
            {state === "avoid" && <IconClose size={11} />}
          </button>
        );
      })}
    </span>
  );
}
