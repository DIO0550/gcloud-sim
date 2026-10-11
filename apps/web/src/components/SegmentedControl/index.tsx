import type { ReactElement } from "react";
import { Tab } from "@/components/Tab";
import { ToggleButton } from "@/components/ToggleButton";

/** 表示切り替えのラベル・選択状態・ボタン生成を共通化する。 */
export const SegmentedControl = <T extends string>({
  label,
  value,
  options,
  onChange,
  variant = "segment",
  className = "",
}: Readonly<{
  label: string;
  value: T;
  options: readonly Readonly<{ value: T; label: string }>[];
  onChange: (value: T) => void;
  variant?: "segment" | "tabs";
  className?: string;
}>): ReactElement => {
  if (variant === "tabs") {
    return (
      <div role="tablist" aria-label={label} className={`flex border-line border-b ${className}`}>
        {options.map((option) => (
          <Tab
            key={option.value}
            selected={value === option.value}
            className="px-5 py-2.5 text-[15px]"
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </Tab>
        ))}
      </div>
    );
  }
  return (
    <fieldset className={`flex rounded-lg border border-line bg-canvas p-0.5 text-sm ${className}`}>
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <ToggleButton
          key={option.value}
          variant="segment"
          pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </ToggleButton>
      ))}
    </fieldset>
  );
};
