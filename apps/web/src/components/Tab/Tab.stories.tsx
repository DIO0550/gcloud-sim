import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { fn } from "storybook/test";

import { Tab } from "@/components/Tab";

const meta = {
  title: "Components/Tab",
  component: Tab,
  args: { selected: true, children: "プロパティ", className: "px-4 py-3.5", onClick: fn() },
} satisfies Meta<typeof Tab>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Selected: Story = {};

export const NotSelected: Story = { args: { selected: false } };

/** tablist に並べた形。押したタブが選択になる。 */
export const Tabs: Story = {
  render: () => {
    const tabs = ["プリンシパル別", "ロール別"];
    const [selected, setSelected] = useState(tabs[0]);
    return (
      <div className="flex border-line border-b" role="tablist" aria-label="表示の単位">
        {tabs.map((tab) => (
          <Tab
            key={tab}
            selected={tab === selected}
            className="px-5 py-2.5 text-[15px]"
            onClick={() => setSelected(tab)}
          >
            {tab}
          </Tab>
        ))}
      </div>
    );
  },
};
