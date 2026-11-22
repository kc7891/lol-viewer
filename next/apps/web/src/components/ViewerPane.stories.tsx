import type { Meta, StoryObj } from "@storybook/react-vite";
import { useReducer } from "react";
import { workspaceReducer } from "@lol-viewer/core";
import { DEFAULT_SETTINGS } from "@lol-viewer/core";
import { act, champ, scenes, type Scene } from "../fixtures.ts";
import { Harness } from "../storyHelpers.tsx";
import { ViewerPane, type PanelKind } from "./ViewerPane.tsx";

/** A pane wired to a real workspace reducer, so the buttons work in Storybook too. */
function PaneDemo({ scene, initialPanel, qrEnabled = true }: { scene: Scene; initialPanel?: PanelKind; qrEnabled?: boolean }) {
  const [ws, dispatch] = useReducer(workspaceReducer, scene.ws);
  const viewer = ws.viewers[0]!;
  return (
    <Harness match={scene.match} height={460} width={560}>
      <div className="story-frame" style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <ViewerPane
          viewer={viewer}
          ws={ws}
          dispatch={dispatch}
          templates={DEFAULT_SETTINGS.urls}
          qrEnabled={qrEnabled}
          notify={() => {}}
          initialPanel={initialPanel}
        />
      </div>
    </Harness>
  );
}

const build = act(scenes.champSelectComplete);
const matchup = act(
  scenes.champSelectComplete,
  { type: "addViewer" },
  { type: "setChampion", id: 1, championId: champ("Darius") },
  { type: "setOpponent", id: 1, opponentId: champ("Garen") },
  { type: "setLane", id: 1, lane: "top" },
);
const aram = act(
  scenes.idle,
  { type: "addViewer" },
  { type: "setChampion", id: 1, championId: champ("Ahri") },
  { type: "setMode", id: 1, mode: "aram" },
);
const empty = act(scenes.champSelectComplete, { type: "closeAll" }, { type: "addViewer" });

const meta = { title: "Components/ViewerPane", parameters: { layout: "centered" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/** My pick. The quick-pick buttons offer the enemies of the matchup table. */
export const Build: Story = { render: () => <PaneDemo scene={build} /> };
export const Matchup: Story = { render: () => <PaneDemo scene={matchup} /> };
/** ARAM disables Lane and Opponent. */
export const Aram: Story = { render: () => <PaneDemo scene={aram} /> };
/** No champion yet: the picker is open from the start. */
export const NoChampion: Story = { render: () => <PaneDemo scene={empty} /> };
export const NoQrButton: Story = { render: () => <PaneDemo scene={build} qrEnabled={false} /> };
