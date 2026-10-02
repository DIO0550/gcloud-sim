import type { ReactElement } from "react";

import { ButtonBase, type ButtonProps } from "@/components/ButtonBase";

const TextLook = {
  accent: "text-accent disabled:text-muted/70",
  muted: "text-muted disabled:opacity-50",
  /** 置き場の文字色をそのまま使う */
  inherit: "disabled:opacity-50",
} as const;

/** 文字（や記号）だけの小さな操作（変更・閉じる・SSH・× ）。 */
export const TextButton = ({
  tone = "accent",
  ...props
}: ButtonProps & Readonly<{ tone?: keyof typeof TextLook }>): ReactElement => (
  <ButtonBase {...props} look={TextLook[tone]} />
);
