import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";

import { PrimaryButton } from "@/components/PrimaryButton";

const meta = {
  title: "Components/PrimaryButton",
  component: PrimaryButton,
  args: { children: "作成", onClick: fn() },
} satisfies Meta<typeof PrimaryButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Disabled: Story = { args: { disabled: true } };
