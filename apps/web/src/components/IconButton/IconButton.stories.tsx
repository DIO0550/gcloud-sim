import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";

import { IconButton } from "@/components/IconButton";

const meta = {
  title: "Components/IconButton",
  component: IconButton,
  args: { children: "×", ariaLabel: "閉じる", className: "text-2xl", onClick: fn() },
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
