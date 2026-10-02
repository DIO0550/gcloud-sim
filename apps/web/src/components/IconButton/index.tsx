import type { ReactElement } from "react";

import { ButtonBase, type ButtonProps } from "@/components/ButtonBase";

/** 記号だけのボタン（ダイアログの × など）。名前は `ariaLabel` で必ず付ける。 */
export const IconButton = (
  props: Omit<ButtonProps, "ariaLabel"> & Readonly<{ ariaLabel: string }>,
): ReactElement => (
  <ButtonBase
    {...props}
    look="rounded px-2 py-1 text-muted leading-none hover:bg-canvas disabled:opacity-50"
  />
);
