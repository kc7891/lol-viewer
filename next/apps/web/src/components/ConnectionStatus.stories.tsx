import type { Meta, StoryObj } from "@storybook/react-vite";
import { ConnectionStatus } from "./ConnectionStatus.tsx";

const meta = {
  title: "Components/ConnectionStatus",
  component: ConnectionStatus,
  decorators: [(S) => <div style={{ width: 200, background: "var(--sidebar-background)" }}><S /></div>],
} satisfies Meta<typeof ConnectionStatus>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Connecting: Story = { args: { status: "connecting" } };
export const Connected: Story = { args: { status: "connected" } };
export const Disconnected: Story = { args: { status: "disconnected" } };
