import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { StatusDot } from "@/components/StatusDot";

const meta = {
  title: "Components/StatusDot",
  component: StatusDot,
  args: { status: "running" },
} satisfies Meta<typeof StatusDot>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = {};
export const Stopped: Story = { args: { status: "stopped", label: "TERMINATED" } };
export const RunningIcon: Story = { args: { variant: "icon" } };
export const StoppedIcon: Story = {
  args: { status: "stopped", label: "TERMINATED", variant: "icon" },
};
export const SuspendedIcon: Story = {
  args: { status: "suspended", label: "SUSPENDED", variant: "icon" },
};
