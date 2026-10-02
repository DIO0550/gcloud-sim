import type { ReactElement, ReactNode } from "react";

type CheckboxProps = Readonly<{
  checked: boolean;
  /** 切り替えた後の値を返す */
  onChange: (checked: boolean) => void;
  /** 見えるラベルが無いとき（表の行の選択など）の名前 */
  ariaLabel?: string;
  /** 横に並べる見えるラベル。渡せば `<label>` で包み、文字を押しても切り替わる */
  children?: ReactNode;
}>;

const BoxClass = "h-4 w-4 accent-accent";

/** チェックボックス。素の `<input type="checkbox">` の代わりに使い、見た目を揃える。 */
export const Checkbox = ({
  checked,
  onChange,
  ariaLabel,
  children,
}: CheckboxProps): ReactElement => {
  const box = (
    <input
      type="checkbox"
      aria-label={ariaLabel}
      className={BoxClass}
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
  if (children === undefined) return box;
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: 中の box が input で、label がそれを包んで結ぶ
    <label className="flex items-center gap-1.5">
      {box}
      {children}
    </label>
  );
};
