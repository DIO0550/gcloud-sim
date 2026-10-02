import type { KeyboardEvent, ReactElement } from "react";

/** フォームの入力欄の枠（Select の field と揃える）。SuggestInput にも渡す */
export const TextInputClass =
  "h-9 w-full rounded-md border border-line bg-surface px-3 text-[15px] focus:border-accent focus:outline-none aria-invalid:border-danger";

const VariantClass = {
  field: TextInputClass,
  bare: "bg-transparent text-[15px] placeholder:text-muted focus:outline-none",
} as const;

type TextInputProps = Readonly<{
  value: string;
  /** 打った文字列をそのまま返す（イベントは呼び側に渡さない） */
  onChange: (value: string) => void;
  /** `<label htmlFor>` で結ぶときの id（Field から渡す） */
  id?: string;
  /** 見えるラベルが無いときの名前 */
  ariaLabel?: string;
  placeholder?: string;
  /** 値が不正か。field では枠が赤くなる */
  invalid?: boolean;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  /** field = フォームの入力欄の枠、bare = 枠の中に置く素の形（検索欄・タグ入力） */
  variant?: "field" | "bare";
  /** 値の書体。ID や綴りは等幅（既定）、名前や検索語はプロポーショナル */
  font?: "mono" | "sans";
  /** 置き場の都合の幅や余白（`flex-1` 等） */
  className?: string;
}>;

/** 1 行のテキスト入力欄。素の `<input>` の代わりに使い、見た目を揃える。 */
export const TextInput = ({
  value,
  onChange,
  id,
  ariaLabel,
  placeholder,
  invalid,
  onKeyDown,
  variant = "field",
  font = "mono",
  className = "",
}: TextInputProps): ReactElement => (
  <input
    id={id}
    type="text"
    aria-label={ariaLabel}
    aria-invalid={invalid}
    placeholder={placeholder}
    className={`${VariantClass[variant]} ${font === "mono" ? "font-mono" : ""} ${className}`}
    value={value}
    onChange={(event) => onChange(event.target.value)}
    onKeyDown={onKeyDown}
  />
);
