import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { fn } from "storybook/test";

import { SuggestInput } from "@/components/SuggestInput";

const meta = {
  title: "Components/SuggestInput",
  component: SuggestInput,
  args: {
    value: "",
    suggestions: [
      { value: "roles/viewer", description: "閲覧者" },
      { value: "roles/editor", description: "編集者" },
      { value: "roles/owner", description: "オーナー" },
      { value: "roles/storage.admin", description: "ストレージ管理者" },
    ],
    onChange: fn(),
  },
  render: (args) => {
    const [value, setValue] = useState(args.value);
    return (
      <div className="w-80">
        <SuggestInput {...args} value={value} onChange={setValue} />
      </div>
    );
  },
} satisfies Meta<typeof SuggestInput>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 入力欄にフォーカスすると候補が開く。候補に無い値も打てる。 */
export const Default: Story = {};
