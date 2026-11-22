import type { Meta, StoryObj } from "@storybook/react-vite";
import { fixtures } from "../fixtures.ts";
import { MatchupList } from "./MatchupList.tsx";

const meta = {
  title: "Components/MatchupList",
  component: MatchupList,
  decorators: [(S) => <div style={{ width: 640 }}><S /></div>],
} satisfies Meta<typeof MatchupList>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = { args: { state: fixtures.champSelectStart } };
export const Partial: Story = { args: { state: fixtures.champSelectPartial } };
export const Complete: Story = { args: { state: fixtures.champSelectComplete } };
export const NewMatch: Story = { args: { state: fixtures.secondMatch } };
