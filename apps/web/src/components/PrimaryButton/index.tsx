import type { ReactElement } from "react";

import { ButtonBase, type ButtonProps } from "@/components/ButtonBase";

/** 画面の主操作（作成・保存・開始）。1 画面に 1 つが目安。 */
export const PrimaryButton = (props: ButtonProps): ReactElement => (
  <ButtonBase
    {...props}
    look="rounded-lg bg-accent px-3 py-1.5 font-semibold text-sm text-white hover:bg-accent-hover disabled:opacity-50"
  />
);
