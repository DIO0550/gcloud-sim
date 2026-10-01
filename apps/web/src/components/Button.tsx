import type { ReactElement, ReactNode } from "react";

type ButtonProps = Readonly<{
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** 置き場の都合の余白（`mt-3` 等）。見た目の種類はここでは変えない */
  className?: string;
}>;

/** 画面の主操作（作成・保存・開始）。1 画面に 1 つが目安。 */
export const PrimaryButton = (props: ButtonProps): ReactElement => (
  <button
    type="button"
    className={`rounded-lg bg-accent px-3 py-1.5 font-semibold text-sm text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 ${props.className ?? ""}`}
    onClick={props.onClick}
    disabled={props.disabled ?? false}
  >
    {props.children}
  </button>
);

/** 主操作に添える操作（キャンセル・コピー・挿入・ヒント）。 */
export const SecondaryButton = (props: ButtonProps): ReactElement => (
  <button
    type="button"
    className={`rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50 ${props.className ?? ""}`}
    onClick={props.onClick}
    disabled={props.disabled ?? false}
  >
    {props.children}
  </button>
);
