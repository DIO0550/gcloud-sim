import type { ReactElement } from "react";

import { ButtonBase, type ButtonProps } from "@/components/ButtonBase";

/** 画面の主操作（作成・保存・開始）。1 画面に 1 つが目安。 */
export const PrimaryButton = (props: ButtonProps): ReactElement => (
  <ButtonBase
    {...props}
    look="rounded bg-accent px-3.5 py-1.5 font-medium text-sm text-white shadow-[0_1px_2px_rgba(26,115,232,0.28)] transition-colors hover:bg-accent-hover disabled:opacity-50 disabled:shadow-none"
  />
);
