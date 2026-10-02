import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { fn } from "storybook/test";

import { RadioGroup } from "@/components/RadioGroup";

type Model = "standard" | "spot";

const meta = {
  title: "Components/RadioGroup",
  component: RadioGroup<Model>,
  args: {
    label: "プロビジョニング モデル",
    name: "provisioning-model",
    value: "standard",
    options: [
      { value: "standard", label: "標準" },
      { value: "spot", label: "Spot" },
    ],
    onChange: fn(),
  },
  render: (args) => {
    const [value, setValue] = useState(args.value);
    return <RadioGroup {...args} value={value} onChange={setValue} />;
  },
} satisfies Meta<typeof RadioGroup<Model>>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Vertical: Story = {};

export const Inline: Story = { args: { inline: true } };
