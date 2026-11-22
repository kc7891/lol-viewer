import type { Meta, StoryObj } from "@storybook/react-vite";
import { useReducer } from "react";
import { workspaceReducer } from "@lol-viewer/core";
import { Toasts } from "./Toasts.tsx";
import { MatchupSection } from "./MatchupSection.tsx";
import { ViewersSection } from "./ViewersSection.tsx";
import { scenes, threeViewers, withHidden, type Scene } from "../fixtures.ts";
import type { Toast } from "../state/toasts.tsx";

function Demo({ scene, parts }: { scene: Scene; parts: ("matchup" | "viewers")[] }) {
  const [ws, dispatch] = useReducer(workspaceReducer, scene.ws);
  return (
    <div className="story-sidebar" style={{ width: 320, background: "var(--bg-1)" }}>
      {parts.includes("matchup") && (
        <MatchupSection
          ws={ws}
          selectedChampionId={ws.rows[2]?.enemy ?? null}
          onSelectChampion={() => {}}
          onSwap={(side, from, to) => dispatch({ type: "swapRows", side, from, to })}
          onOpenRow={(index) => dispatch({ type: "openRow", index })}
          onRefresh={() => dispatch({ type: "refreshMatchup" })}
        />
      )}
      {parts.includes("viewers") && (
        <ViewersSection
          ws={ws}
          onAdd={() => dispatch({ type: "addViewer" })}
          onCloseAll={() => dispatch({ type: "closeAll" })}
          onClose={(id) => dispatch({ type: "closeViewer", id })}
          onToggleHidden={(id) => dispatch({ type: "toggleHidden", id })}
          onFocus={() => {}}
          onOpenPending={(championId) => dispatch({ type: "openPending", championId })}
          onRemovePending={(championId) => dispatch({ type: "removePending", championId })}
        />
      )}
    </div>
  );
}

const meta = { title: "Components/Sidebar", parameters: { layout: "centered" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const MatchupEmpty: Story = { render: () => <Demo scene={scenes.champSelectStart} parts={["matchup"]} /> };
export const MatchupPartial: Story = { render: () => <Demo scene={scenes.champSelectPartial} parts={["matchup"]} /> };
/** Ten champions; YOU marks my row. */
export const MatchupComplete: Story = { render: () => <Demo scene={scenes.champSelectComplete} parts={["matchup"]} /> };
export const ViewersAndEnemyPicks: Story = { render: () => <Demo scene={scenes.champSelectComplete} parts={["viewers"]} /> };
/** Hidden viewers look like any other row (M-006); the eye button on hover shows the state. */
export const ViewersWithHidden: Story = { render: () => <Demo scene={withHidden} parts={["viewers"]} /> };
export const ViewersThree: Story = { render: () => <Demo scene={threeViewers} parts={["viewers"]} /> };
export const ViewersEmpty: Story = { render: () => <Demo scene={scenes.idle} parts={["viewers"]} /> };

const toasts: Toast[] = [
  { id: 1, kind: "info", text: "Matchup refreshed." },
  { id: 2, kind: "success", text: "Copied to clipboard" },
  { id: 3, kind: "warn", text: "Viewer limit reached (20). Close one first." },
];
export const ToastList: Story = {
  render: () => (
    <div style={{ width: 320, background: "var(--bg-1)" }}>
      <Toasts toasts={toasts} onDismiss={() => {}} />
    </div>
  ),
};
