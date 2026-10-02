import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { fn } from "storybook/test";

import { TextInput } from "@/components/TextInput";

const meta = {
  title: "Components/TextInput",
  component: TextInput,
  args: { value: "instance-1", ariaLabel: "名前", onChange: fn() },
  render: (args) => {
    const [value, setValue] = useState(args.value);
    return (
      <div className="w-80">
        <TextInput {...args} value={value} onChange={setValue} />
      </div>
    );
  },
} satisfies Meta<typeof TextInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Field: Story = {};

export const Invalid: Story = { args: { value: "Instance_1", invalid: true } };

export const Placeholder: Story = {
  args: { value: "", placeholder: "プロパティ名または値を入力" },
};

/** 枠を持つ置き場の中に入れる素の形（VM 一覧のフィルタ）。 */
export const Bare: Story = {
  args: { value: "", variant: "bare", font: "sans", placeholder: "プロパティ名または値を入力" },
  render: (args) => {
    const [value, setValue] = useState(args.value);
    return (
      <div className="flex h-11 w-96 items-center gap-3 rounded-lg border border-line bg-surface px-4">
        <span className="font-bold text-[15px]">フィルタ</span>
        <TextInput {...args} className="min-w-0 flex-1" value={value} onChange={setValue} />
      </div>
    );
  },
};
