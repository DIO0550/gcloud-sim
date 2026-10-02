import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Pill } from "@/components/Pill";

const meta = {
  title: "Components/Pill",
  component: Pill,
  args: { tone: "ok", children: "RUNNING" },
} satisfies Meta<typeof Pill>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ok: Story = {};

export const Accent: Story = { args: { tone: "accent", children: "挑戦中" } };

export const Muted: Story = { args: { tone: "muted", children: "TERMINATED" } };
