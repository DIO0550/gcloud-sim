import type { ReactElement, ReactNode } from "react";

type ButtonProps = Readonly<{
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

/** どのボタンも `type="button"`（フォームを送信しない）で描く土台。 */
const ButtonBase = ({ look, ...props }: ButtonProps & Readonly<{ look: string }>): ReactElement => (
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

/** 画面の主操作（作成・保存・開始）。1 画面に 1 つが目安。 */
export const PrimaryButton = (props: ButtonProps): ReactElement => (
  <ButtonBase
    {...props}
    look="rounded-lg bg-accent px-3 py-1.5 font-semibold text-sm text-white hover:bg-accent-hover disabled:opacity-50"
  />
);

/** 主操作に添える操作（キャンセル・コピー・挿入・ヒント）。 */
export const SecondaryButton = (props: ButtonProps): ReactElement => (
  <ButtonBase
    {...props}
    look="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:bg-canvas disabled:opacity-50"
  />
);

/** 取り消せない操作（リセット・削除）。 */
export const DangerButton = (props: ButtonProps): ReactElement => (
  <ButtonBase
    {...props}
    look="rounded-md border border-danger/40 px-5 py-2.5 font-bold text-danger hover:bg-danger-soft disabled:opacity-50"
  />
);

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

/** 記号だけのボタン（ダイアログの × など）。名前は `ariaLabel` で必ず付ける。 */
export const IconButton = (
  props: Omit<ButtonProps, "ariaLabel"> & Readonly<{ ariaLabel: string }>,
): ReactElement => (
  <ButtonBase
    {...props}
    look="rounded px-2 py-1 text-muted leading-none hover:bg-canvas disabled:opacity-50"
  />
);

const ToggleLook = {
  /** 枠の中に並べる切り替え（表示の切り替え） */
  segment: {
    on: "rounded-md px-3 py-1 bg-surface font-semibold shadow-sm",
    off: "rounded-md px-3 py-1 text-muted",
  },
  /** 枠付きの札を並べる切り替え（マシンのシリーズ） */
  chip: {
    on: "rounded-md border px-4 py-1.5 text-[15px] border-accent bg-accent-soft font-bold text-accent",
    off: "rounded-md border px-4 py-1.5 text-[15px] border-line bg-surface",
  },
  /** 枠の無い、押したままになる操作（ターミナルの開閉） */
  ghost: {
    on: "rounded-lg px-3 py-1.5 bg-accent-soft font-semibold text-accent",
    off: "rounded-lg px-3 py-1.5 hover:bg-canvas",
  },
} as const;

/** 押した状態を持つボタン（`aria-pressed`）。並べて択一にも、単独で開閉にも使う。 */
export const ToggleButton = ({
  pressed,
  variant,
  children,
  onClick,
  className = "",
}: Readonly<{
  pressed: boolean;
  variant: keyof typeof ToggleLook;
  children: ReactNode;
  onClick: () => void;
  className?: string;
}>): ReactElement => (
  <button
    type="button"
    aria-pressed={pressed}
    className={`${ToggleLook[variant][pressed ? "on" : "off"]} ${className}`}
    onClick={onClick}
  >
    {children}
  </button>
);
