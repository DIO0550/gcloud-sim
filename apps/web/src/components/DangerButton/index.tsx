import type { ReactElement } from "react";

import { ButtonBase, type ButtonProps } from "@/components/ButtonBase";

/** 取り消せない操作（リセット・削除）。 */
export const DangerButton = (props: ButtonProps): ReactElement => (
  <ButtonBase
    {...props}
    look="rounded-md border border-danger/40 px-5 py-2.5 font-bold text-danger hover:bg-danger-soft disabled:opacity-50"
  />
);
