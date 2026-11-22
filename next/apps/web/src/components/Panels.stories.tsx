import type { Meta, StoryObj } from "@storybook/react-vite";
import { champ } from "../fixtures.ts";
import { ChampionPanel } from "./ChampionPanel.tsx";
import { LanePanel } from "./LanePanel.tsx";
import { QrPanel } from "./QrPanel.tsx";

const Frame = ({ children }: { children: React.ReactNode }) => (
  <div className="story-frame" style={{ width: 520, height: 420, position: "relative", display: "flex" }}>
    <div style={{ position: "relative", flex: 1 }}>{children}</div>
  </div>
);

const meta = {
  title: "Components/Panels",
  parameters: { layout: "centered" },
  decorators: [(S) => <Frame><S /></Frame>],
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const ChampionPicker: Story = {
  render: () => <ChampionPanel title="Select champion" value={champ("Ahri")} onPick={() => {}} onClose={() => {}} />,
};
/** None first, then Suggested (the enemies of the table), then everyone. */
export const OpponentPicker: Story = {
  render: () => (
    <ChampionPanel
      title="Select opponent"
      value={null}
      allowNone
      suggested={[champ("Zed"), champ("Garen"), champ("Lee Sin")]}
      onPick={() => {}}
      onClose={() => {}}
    />
  ),
};
export const Lane: Story = { render: () => <LanePanel value="middle" onPick={() => {}} onClose={() => {}} /> };
export const Qr: Story = {
  render: () => <QrPanel url="https://lolalytics.com/lol/ahri/vs/zed/build/?lane=middle&vslane=middle" onCopy={() => {}} onClose={() => {}} />,
};
