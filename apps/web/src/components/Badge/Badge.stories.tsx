import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Badge } from "@/components/Badge";

const meta = {
  title: "Components/Badge",
  component: Badge,
  args: { tone: "ok", children: "RUNNING" },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ok: Story = {};

export const Accent: Story = { args: { tone: "accent", children: "挑戦中" } };

export const Muted: Story = { args: { tone: "muted", children: "TERMINATED" } };
