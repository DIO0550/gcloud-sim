import type { ReactElement } from "react";

import { ButtonBase, type ButtonProps } from "@/components/ButtonBase";

/** 主操作に添える操作（キャンセル・コピー・挿入・ヒント）。 */
export const SecondaryButton = (props: ButtonProps): ReactElement => (
  <ButtonBase
    {...props}
    look="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:bg-canvas disabled:opacity-50"
  />
);
