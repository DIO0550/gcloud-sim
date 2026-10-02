import type { ReactElement } from "react";

/** 択一の項目（ラジオボタンの並び）。`inline` なら横に、そうでなければ縦に並べる。 */
export const RadioGroup = <T extends string>({
  label,
  name,
  value,
  options,
  onChange,
  inline = false,
}: Readonly<{
  label: string;
  name: string;
  value: T;
  options: readonly Readonly<{ value: T; label: string }>[];
  onChange: (value: T) => void;
  inline?: boolean;
}>): ReactElement => (
  <fieldset>
    <legend className="mb-2 font-bold text-sm">{label}</legend>
    <div className={inline ? "flex gap-5" : "flex flex-col gap-1.5"}>
      {options.map((option) => (
        <label key={option.value} className="flex items-center gap-1.5 text-[15px]">
          <input
            type="radio"
            name={name}
            className="h-4 w-4 accent-ink"
            checked={option.value === value}
            onChange={() => onChange(option.value)}
          />
          {option.label}
        </label>
      ))}
    </div>
  </fieldset>
);
