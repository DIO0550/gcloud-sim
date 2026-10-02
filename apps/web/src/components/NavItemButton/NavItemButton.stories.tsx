import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { fn } from "storybook/test";

import { NavItemButton } from "@/components/NavItemButton";

const meta = {
  title: "Components/NavItemButton",
  component: NavItemButton,
  args: {
    current: true,
    children: "VM インスタンス",
    className: "rounded-lg px-4 py-2 text-[15px]",
    onClick: fn(),
  },
} satisfies Meta<typeof NavItemButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Current: Story = {};

export const NotCurrent: Story = { args: { current: false } };

/** 縦に並べたナビ。押した行が選択になる。 */
export const List: Story = {
  render: () => {
    const items = ["VM インスタンス", "インスタンス グループ", "ディスク"];
    const [current, setCurrent] = useState(items[0]);
    return (
      <ul className="w-60">
        {items.map((item) => (
          <li key={item}>
            <NavItemButton
              current={item === current}
              currentKind="page"
              className="rounded-lg px-4 py-2 text-[15px]"
              onClick={() => setCurrent(item)}
            >
              {item}
            </NavItemButton>
          </li>
        ))}
      </ul>
    );
  },
};
