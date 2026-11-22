import type { Meta, StoryObj } from "@storybook/react-vite";
import { AddViewerDialog } from "./AddViewerDialog.tsx";

const meta = {
  title: "Components/AddViewerDialog",
  component: AddViewerDialog,
  args: { onAdd: () => {}, onClose: () => {} },
  decorators: [(S) => <div style={{ height: "100vh" }}><S /></div>],
} satisfies Meta<typeof AddViewerDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const DefaultLaneMid: Story = { args: { defaultLane: "middle" } };
