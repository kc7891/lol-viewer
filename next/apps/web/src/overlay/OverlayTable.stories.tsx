import type { ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { liveScenes, type Scene } from "../fixtures.ts";
import { OverlayTable } from "./OverlayTable.tsx";

const Show = ({ scene, children }: { scene: Scene; children?: ReactNode }) => (
  <div style={{ padding: 16, display: "inline-block" }}>
    <OverlayTable rows={scene.ws.rows} live={scene.match.live} />
    {children}
  </div>
);

/** The overlay window is transparent: a checkerboard shows that the table's own background lets the game through. */
const Checker = ({ scene }: { scene: Scene }) => (
  <div
    style={{
      padding: 24,
      backgroundColor: "#5b6b4a",
      backgroundImage:
        "linear-gradient(45deg, #2b3a55 25%, transparent 25%, transparent 75%, #2b3a55 75%), linear-gradient(45deg, #2b3a55 25%, transparent 25%, transparent 75%, #2b3a55 75%)",
      backgroundSize: "48px 48px",
      backgroundPosition: "0 0, 24px 24px",
    }}
  >
    <OverlayTable rows={scene.ws.rows} live={scene.match.live} />
  </div>
);

const meta = { title: "Overlay/OverlayTable", parameters: { layout: "centered" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/** Mid game: rows on the real lanes, item gold and level differences, team totals (same values as the sidebar). */
export const LiveMid: Story = { render: () => <Show scene={liveScenes.liveMid} /> };
/** First playerlist: starting items, level 1. */
export const LiveEarly: Story = { render: () => <Show scene={liveScenes.liveEarly} /> };
/** I swapped two enemy rows after the correction; the overlay shows my table, not the game's lanes. */
export const LiveSwapKept: Story = { render: () => <Show scene={liveScenes.liveSwappedAfter} /> };
/** Over a busy background. */
export const OverCheckerboard: Story = { render: () => <Checker scene={liveScenes.liveMid} /> };
