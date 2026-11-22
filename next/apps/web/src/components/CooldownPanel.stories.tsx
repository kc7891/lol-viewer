import type { Meta, StoryObj } from "@storybook/react-vite";
import { CooldownPanel } from "./CooldownPanel.tsx";

const meta = {
  title: "Components/CooldownPanel",
  component: CooldownPanel,
  decorators: [(S) => <div style={{ width: 340, background: "var(--sidebar-background)" }}><S /></div>],
} satisfies Meta<typeof CooldownPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Ahri: Story = { args: { championId: 103 } };
/** Fractional values (Aatrox W: 18 / 16.5 / …). */
export const Aatrox: Story = { args: { championId: 266 } };
/** Transform champion: 6 ranks on Q/W/E, 1 rank on R; longest Japanese spell names (ellipsis). */
export const Jayce: Story = { args: { championId: 126 } };
/** Ammo-based E has no cooldown in Data Dragon -> "—". */
export const Gangplank: Story = { args: { championId: 41 } };
export const NoSelection: Story = { args: { championId: null } };
