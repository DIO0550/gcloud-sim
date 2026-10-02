import type { ReactElement, ReactNode } from "react";

export type ButtonProps = Readonly<{
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** 見える文字が無い（記号だけ）・文字だけでは足りないときの名前 */
  ariaLabel?: string;
  /** 開閉を切り替えるボタンなら、いま開いているか */
  ariaExpanded?: boolean;
  /** 置き場の都合の余白（`mt-3` 等）。見た目の種類はここでは変えない */
  className?: string;
}>;

/**
 * どのボタンも `type="button"`（フォームを送信しない）で描く土台。
 * 見た目（`look`）は PrimaryButton などの各ボタンが決める。画面からは直接使わない。
 */
export const ButtonBase = ({
  look,
  ...props
}: ButtonProps & Readonly<{ look: string }>): ReactElement => (
  <button
    type="button"
    className={`disabled:cursor-not-allowed ${look} ${props.className ?? ""}`}
    onClick={props.onClick}
    disabled={props.disabled ?? false}
    aria-label={props.ariaLabel}
    aria-expanded={props.ariaExpanded}
  >
    {props.children}
  </button>
);
