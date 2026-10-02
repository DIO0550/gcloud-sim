import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";

import { TextButton } from "@/components/TextButton";

const meta = {
  title: "Components/TextButton",
  component: TextButton,
  args: { children: "変更", onClick: fn() },
} satisfies Meta<typeof TextButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Disabled: Story = { args: { disabled: true } };

export const Muted: Story = { args: { tone: "muted", children: "×", ariaLabel: "web を外す" } };

export const Inherit: Story = {
  args: { tone: "inherit", children: "閉じる", className: "text-xs underline" },
};
