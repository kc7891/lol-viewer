import type { Meta, StoryObj } from "@storybook/react-vite";
import { fixtures } from "../fixtures.ts";
import { BridgeProvider } from "../bridge/context.tsx";
import { staticBridge } from "../bridge/mock.ts";
import { ViewerPane } from "./ViewerPane.tsx";

const meta = {
  title: "Components/ViewerPane",
  component: ViewerPane,
  decorators: [
    (S) => (
      <BridgeProvider bridge={staticBridge(fixtures.idle)}>
        <div style={{ width: 520, height: 360, display: "flex" }}>
          <S />
        </div>
      </BridgeProvider>
    ),
  ],
} satisfies Meta<typeof ViewerPane>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Build: Story = { args: { target: { kind: "build", championId: 103 } } };
export const Matchup: Story = {
  args: { target: { kind: "matchup", championId: 122, opponentId: 86, lane: "top" } },
};
export const UnknownChampion: Story = { args: { target: { kind: "build", championId: 999999 } } };
