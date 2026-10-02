import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";

import { DangerButton } from "@/components/DangerButton";

const meta = {
  title: "Components/DangerButton",
  component: DangerButton,
  args: { children: "リセット", onClick: fn() },
} satisfies Meta<typeof DangerButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Disabled: Story = { args: { disabled: true } };
