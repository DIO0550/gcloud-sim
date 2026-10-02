import type { ReactElement, ReactNode } from "react";

const ToggleLook = {
  /** 枠の中に並べる切り替え（表示の切り替え） */
  segment: {
    on: "rounded-md px-3 py-1 bg-surface font-semibold shadow-sm",
    off: "rounded-md px-3 py-1 text-muted",
  },
  /** 枠付きの札を並べる切り替え（マシンのシリーズ） */
  chip: {
    on: "rounded-md border px-4 py-1.5 text-[15px] border-accent bg-accent-soft font-bold text-accent",
    off: "rounded-md border px-4 py-1.5 text-[15px] border-line bg-surface",
  },
  /** 枠の無い、押したままになる操作（ターミナルの開閉） */
  ghost: {
    on: "rounded-lg px-3 py-1.5 bg-accent-soft font-semibold text-accent",
    off: "rounded-lg px-3 py-1.5 hover:bg-canvas",
  },
} as const;

/** 押した状態を持つボタン（`aria-pressed`）。並べて択一にも、単独で開閉にも使う。 */
export const ToggleButton = ({
  pressed,
  variant,
  children,
  onClick,
  className = "",
}: Readonly<{
  pressed: boolean;
  variant: keyof typeof ToggleLook;
  children: ReactNode;
  onClick: () => void;
  className?: string;
}>): ReactElement => (
  <button
    type="button"
    aria-pressed={pressed}
    className={`${ToggleLook[variant][pressed ? "on" : "off"]} ${className}`}
    onClick={onClick}
  >
    {children}
  </button>
);
