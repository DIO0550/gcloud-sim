import type { ReactElement } from "react";

/** オン・オフのスイッチ（`role="switch"`）。名前は `ariaLabel` で付ける。 */
export const Switch = ({
  checked,
  onChange,
  ariaLabel,
}: Readonly<{
  checked: boolean;
  /** 切り替えた後の値を返す */
  onChange: (checked: boolean) => void;
  ariaLabel: string;
}>): ReactElement => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={ariaLabel}
    className={`relative h-5 w-9 rounded-full transition-colors ${checked ? "bg-accent" : "bg-line"}`}
    onClick={() => onChange(!checked)}
  >
    <span
      className={`absolute top-0.5 h-4 w-4 rounded-full bg-surface transition-all ${checked ? "left-[1.125rem]" : "left-0.5"}`}
    />
  </button>
);
