import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { fn } from "storybook/test";

import { Checkbox } from "@/components/Checkbox";

const meta = {
  title: "Components/Checkbox",
  component: Checkbox,
  args: { checked: true, onChange: fn() },
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 見えるラベルを添えた形（予算のしきい値）。 */
export const WithLabel: Story = { args: { children: "50%" } };

/** 表の行の選択のように、見えるラベルが無い形。 */
export const WithoutLabel: Story = { args: { ariaLabel: "web-1 を選択" } };

/** 押すと切り替わる。 */
export const Interactive: Story = {
  args: { children: "90%" },
  render: (args) => {
    const [checked, setChecked] = useState(args.checked);
    return <Checkbox {...args} checked={checked} onChange={setChecked} />;
  },
};
