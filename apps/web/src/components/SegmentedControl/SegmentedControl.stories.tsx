import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { fn } from "storybook/test";

import { SegmentedControl } from "@/components/SegmentedControl";

const meta = {
  title: "Components/SegmentedControl",
  component: SegmentedControl,
  args: {
    label: "表示",
    value: "cli",
    options: [
      { value: "cli", label: "CLI" },
      { value: "console", label: "Console" },
    ],
    onChange: fn(),
  },
} satisfies Meta<typeof SegmentedControl>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Segment: Story = {
  render: (args) => {
    const [value, setValue] = useState(args.value);
    return <SegmentedControl {...args} value={value} onChange={setValue} />;
  },
};

export const Tabs: Story = { ...Segment, args: { variant: "tabs" } };
