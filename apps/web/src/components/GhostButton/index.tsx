import type { ReactElement } from "react";

import { ButtonBase, type ButtonProps } from "@/components/ButtonBase";

const GhostLook = {
  /** ヘッダーなどに並べる、枠の無い操作 */
  neutral: "rounded-lg px-3 py-1.5 hover:bg-canvas disabled:opacity-50",
  /** 一覧のツールバーに並べる操作 */
  accent:
    "rounded-md px-2.5 py-1 text-accent hover:bg-accent-soft disabled:text-muted/60 disabled:hover:bg-transparent",
} as const;

/** 枠も背景も無く、乗せたときだけ背景が付く操作。 */
export const GhostButton = ({
  tone = "neutral",
  ...props
}: ButtonProps & Readonly<{ tone?: keyof typeof GhostLook }>): ReactElement => (
  <ButtonBase {...props} look={GhostLook[tone]} />
);
