import type { Meta, StoryObj } from "@storybook/react-vite";
import type { RecorderApi, RecorderStatus } from "@lol-viewer/protocol";
import { RecorderSection } from "./RecorderSection.tsx";

const folder = "C:\\Users\\you\\Documents\\LoL Viewer Next\\recordings";
const fake = (s: RecorderStatus): RecorderApi => ({
  start: async () => ({ ...s, recording: true, startedAt: Date.now() - 65_000, lines: 0 }),
  stop: async () => ({ ...s, recording: false, startedAt: null }),
  status: async () => s,
  openFolder: () => {},
  onStatus: () => () => {},
});

const meta = {
  title: "Components/RecorderSection",
  component: RecorderSection,
  decorators: [(S) => <div className="modal" style={{ margin: 24 }}><S /></div>],
} satisfies Meta<typeof RecorderSection>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = { args: { recorder: fake({ recording: false, file: null, lines: 0, startedAt: null, folder }) } };
export const Recording: Story = {
  args: {
    recorder: fake({ recording: true, file: `${folder}\\session-20261122-153000.jsonl`, lines: 42, startedAt: Date.now() - 125_000, folder }),
  },
};
export const Saved: Story = {
  args: { recorder: fake({ recording: false, file: `${folder}\\session-20261122-153000.jsonl`, lines: 0, startedAt: null, folder }) },
};
/** Browser / PR preview: no recorder available. */
export const BrowserOnly: Story = { args: { recorder: undefined } };
