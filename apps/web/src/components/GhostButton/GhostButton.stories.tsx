import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";

import { GhostButton } from "@/components/GhostButton";

const meta = {
  title: "Components/GhostButton",
  component: GhostButton,
  args: { children: "設定", onClick: fn() },
} satisfies Meta<typeof GhostButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Disabled: Story = { args: { disabled: true } };

export const Accent: Story = { args: { tone: "accent", children: "停止" } };

export const AccentDisabled: Story = { args: { tone: "accent", children: "停止", disabled: true } };
