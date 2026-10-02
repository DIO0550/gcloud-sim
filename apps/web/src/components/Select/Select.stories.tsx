import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { fn } from "storybook/test";

import { Select } from "@/components/Select";

const Zones = ["asia-northeast1-a", "asia-northeast1-b", "asia-northeast1-c"] as const;
type Zone = (typeof Zones)[number];

const meta = {
  title: "Components/Select",
  component: Select<Zone>,
  args: {
    value: "asia-northeast1-a",
    options: Zones.map((z) => ({ value: z, label: z })),
    ariaLabel: "ゾーン",
    onChange: fn(),
  },
  render: (args) => {
    const [value, setValue] = useState(args.value);
    return (
      <div className="w-80">
        <Select {...args} value={value} onChange={setValue} />
      </div>
    );
  },
} satisfies Meta<typeof Select<Zone>>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Field: Story = {};

/** 枠の中に置く素の形（ヘッダーのプロジェクト選択）。 */
export const Bare: Story = { args: { variant: "bare" } };
