import type { Meta, StoryObj } from "@storybook/react-vite";
import { TopBar } from "./TopBar.tsx";

const meta = {
  title: "Components/TopBar",
  component: TopBar,
  args: { page: "viewers", onPage: () => {}, onConnectionClick: () => {}, connection: "connected", phase: "ChampSelect" },
} satisfies Meta<typeof TopBar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ChampSelect: Story = {};
export const InGame: Story = { args: { phase: "InProgress", page: "live" } };
export const Connecting: Story = { args: { connection: "connecting", phase: "None" } };
export const Disconnected: Story = { args: { connection: "disconnected", phase: "None" } };
export const UpdateAvailable: Story = { args: { updateAvailable: true, page: "settings" } };
/** Feature flag teamBalancer on (M-038): the Teams tab sits between Live Game and Settings. */
export const WithTeamsTab: Story = { args: { showTeams: true, page: "teams" } };
