import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";

import { SecondaryButton } from "@/components/SecondaryButton";

const meta = {
  title: "Components/SecondaryButton",
  component: SecondaryButton,
  args: { children: "キャンセル", onClick: fn() },
} satisfies Meta<typeof SecondaryButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Disabled: Story = { args: { disabled: true } };
