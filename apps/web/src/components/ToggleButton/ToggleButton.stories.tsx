import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { fn } from "storybook/test";

import { ToggleButton } from "@/components/ToggleButton";

const meta = {
  title: "Components/ToggleButton",
  component: ToggleButton,
  args: { pressed: true, variant: "chip", children: "E2", onClick: fn() },
} satisfies Meta<typeof ToggleButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Chip: Story = {};

export const Ghost: Story = {
  args: {
    variant: "ghost",
    children: (
      <>
        <span className="font-mono">&gt;_</span> ターミナル
      </>
    ),
  },
};

/** 並べて択一にする使い方（ヘッダーの CLI / Console）。押すと切り替わる。 */
export const Segment: Story = {
  render: () => {
    const [view, setView] = useState<"cli" | "console">("cli");
    return (
      <fieldset className="flex w-fit rounded-lg border border-line bg-canvas p-0.5 text-sm">
        <legend className="sr-only">表示</legend>
        <ToggleButton variant="segment" pressed={view === "cli"} onClick={() => setView("cli")}>
          CLI
        </ToggleButton>
        <ToggleButton
          variant="segment"
          pressed={view === "console"}
          onClick={() => setView("console")}
        >
          Console
        </ToggleButton>
      </fieldset>
    );
  },
};
