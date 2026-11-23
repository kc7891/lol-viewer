import { LANES, type Lane } from "@lol-viewer/protocol";
import { LANE_LABEL } from "../ui/labels.ts";
import { PanelFrame } from "./PanelFrame.tsx";

export function LanePanel({ value, onPick, onClose }: { value: Lane | null; onPick: (lane: Lane | null) => void; onClose: () => void }) {
  const options: { lane: Lane | null; label: string }[] = [
    { lane: null, label: "Any" },
    ...LANES.map((l) => ({ lane: l, label: LANE_LABEL[l] })),
  ];
  return (
    <PanelFrame title="Select lane" onClose={onClose} className="lane-panel">
      <div className="lane-grid" role="group" aria-label="Lane">
        {options.map((o) => (
          <button
            key={o.label}
            type="button"
            className="lane-btn"
            aria-pressed={o.lane === value}
            data-lane={o.lane ?? "any"}
            onClick={() => onPick(o.lane)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </PanelFrame>
  );
}
