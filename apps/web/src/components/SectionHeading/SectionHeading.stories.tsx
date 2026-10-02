import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { SectionHeading } from "@/components/SectionHeading";

const meta = {
  title: "Components/SectionHeading",
  component: SectionHeading,
  args: { children: "コマンド履歴" },
} satisfies Meta<typeof SectionHeading>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
