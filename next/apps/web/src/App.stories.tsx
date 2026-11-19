import type { Meta, StoryObj } from "@storybook/react-vite";
import { App } from "./App.tsx";
import { BridgeProvider } from "./bridge/context.tsx";
import { staticBridge } from "./bridge/mock.ts";
import { fixtures, type FixtureName } from "./fixtures.ts";

type Args = { fixture: FixtureName; layout: 1 | 2 | 3; settingsOpen: boolean };

const meta = {
  title: "Screens/App",
  args: { fixture: "champSelectComplete", layout: 2, settingsOpen: false },
  argTypes: {
    fixture: { control: "select", options: Object.keys(fixtures) },
    layout: { control: "inline-radio", options: [1, 2, 3] },
  },
  render: ({ fixture, layout, settingsOpen }) => (
    <div style={{ height: "100vh" }}>
      <BridgeProvider key={fixture} bridge={staticBridge(fixtures[fixture])}>
        <App key={`${layout}-${settingsOpen}`} initialLayout={layout} initialSettingsOpen={settingsOpen} />
      </BridgeProvider>
    </div>
  ),
} satisfies Meta<Args>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Disconnected: Story = { args: { fixture: "disconnected" } };
export const WaitingForChampSelect: Story = { args: { fixture: "idle" } };
export const ChampSelectPartial: Story = { args: { fixture: "champSelectPartial" } };
export const ChampSelectComplete: Story = {};
export const ThreePanes: Story = { args: { layout: 3 } };
export const InGame: Story = { args: { fixture: "inGame", layout: 1 } };
export const SecondMatchResets: Story = { args: { fixture: "secondMatch" } };
export const SettingsOverlay: Story = { args: { settingsOpen: true } };
