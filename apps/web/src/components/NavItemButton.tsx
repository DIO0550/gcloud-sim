import type { ReactElement, ReactNode } from "react";

/**
 * 縦に並べた一覧の 1 行を選ぶボタン（Console のナビ・ミッション一覧）。
 * 選んでいる行は背景で示し、`aria-current` を付ける。
 */
export const NavItemButton = ({
  current,
  currentKind = "true",
  onClick,
  children,
  className = "",
}: Readonly<{
  current: boolean;
  /** ページを切り替えるナビなら page、一覧の中の選択なら true */
  currentKind?: "page" | "true";
  onClick: () => void;
  children: ReactNode;
  /** 余白・文字の大きさ・中の並べ方（置き場ごとに違う） */
  className?: string;
}>): ReactElement => (
  <button
    type="button"
    aria-current={current ? currentKind : undefined}
    className={`w-full text-left ${current ? "bg-accent-soft" : "hover:bg-canvas"} ${className}`}
    onClick={onClick}
  >
    {children}
  </button>
);
