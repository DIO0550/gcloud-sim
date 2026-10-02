import type { ReactElement, ReactNode } from "react";

/**
 * タブ（`role="tablist"` の中に並べる 1 つ）。選んでいるものに下線を引く。
 * 余白や文字の大きさは置き場ごとに違うので `className` で渡す。
 */
export const Tab = ({
  selected,
  onClick,
  children,
  className = "",
}: Readonly<{
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}>): ReactElement => (
  <button
    type="button"
    role="tab"
    aria-selected={selected}
    className={`-mb-px border-b-2 ${selected ? "border-accent font-bold" : "border-transparent text-muted"} ${className}`}
    onClick={onClick}
  >
    {children}
  </button>
);
