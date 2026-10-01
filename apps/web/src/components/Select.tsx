import { type KeyboardEvent, type ReactElement, useEffect, useId, useRef, useState } from "react";

export type SelectOption<T extends string> = Readonly<{ value: T; label: string }>;

type SelectProps<T extends string> = Readonly<{
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  /** `<label htmlFor>` で結ぶときの id（Field から渡す） */
  id?: string;
  /** 見えるラベルが無いときの名前 */
  ariaLabel?: string;
  /** field = フォームの入力欄と同じ枠、bare = 枠の中に置く素の形（ヘッダー） */
  variant?: "field" | "bare";
  /** 一覧をボタンのどちら側に揃えるか（画面の右端に置くなら end） */
  align?: "start" | "end";
  /** 文字色など、置き場の都合の見た目 */
  className?: string;
}>;

const TriggerClass = {
  field:
    "flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-left font-mono text-sm focus:border-accent focus:outline-none",
  bare: "flex items-center gap-1.5 rounded bg-transparent text-left font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
} as const;

const clamp = (index: number, length: number): number => Math.min(Math.max(index, 0), length - 1);

/**
 * ネイティブの `<select>` の代わりの選択ボックス（WAI-ARIA の select-only combobox）。
 * フォーカスはボタンに置いたまま、一覧の現在地は `aria-activedescendant` で示す。
 * 選択肢は型付きの値で返すので、呼び側で文字列を読み直さなくてよい。
 */
export const Select = <T extends string>({
  value,
  options,
  onChange,
  id,
  ariaLabel,
  variant = "field",
  align = "start",
  className,
}: SelectProps<T>): ReactElement => {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const selectedIndex = options.findIndex((o) => o.value === value);
  const [active, setActive] = useState(Math.max(selectedIndex, 0));
  const listRef = useRef<HTMLDivElement>(null);
  const optionId = (index: number): string => `${listId}-${index}`;
  const selected = options[selectedIndex];

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector(`[data-index="${active}"]`);
    // jsdom には scrollIntoView が無い
    if (el instanceof HTMLElement) el.scrollIntoView?.({ block: "nearest" });
  }, [open, active]);

  const openList = (): void => {
    setActive(Math.max(selectedIndex, 0));
    setOpen(true);
  };
  const choose = (index: number): void => {
    const option = options[index];
    setOpen(false);
    if (option !== undefined && option.value !== value) onChange(option.value);
  };
  /** 打った文字で始まる次の選択肢へ（ネイティブの select と同じ先頭一致の飛び先）。 */
  const jumpTo = (key: string): void => {
    const lower = key.toLowerCase();
    const start = open ? active + 1 : selectedIndex + 1;
    const order = options.map((_, i) => (start + i) % options.length);
    const hit = order.find((i) => options[i]?.label.toLowerCase().startsWith(lower));
    if (hit === undefined) return;
    if (open) setActive(hit);
    else choose(hit);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const last = options.length - 1;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        if (!open) {
          openList();
          return;
        }
        setActive((i) => clamp(i + (event.key === "ArrowDown" ? 1 : -1), options.length));
        return;
      }
      case "Home":
      case "End":
        if (!open) return;
        event.preventDefault();
        setActive(event.key === "Home" ? 0 : last);
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        if (open) choose(active);
        else openList();
        return;
      case "Escape":
        if (!open) return;
        event.preventDefault();
        setOpen(false);
        return;
      case "Tab":
        setOpen(false);
        return;
      default:
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          jumpTo(event.key);
        }
    }
  };

  return (
    <div className={`relative ${variant === "field" ? "w-full" : "inline-block"}`}>
      <button
        id={id}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? optionId(active) : undefined}
        className={`${TriggerClass[variant]} ${className ?? ""}`}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
      >
        <span className="truncate">{selected?.label ?? ""}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      {open && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className={`absolute top-full z-30 mt-1 max-h-64 min-w-full overflow-auto rounded-lg border border-line bg-surface py-1 text-sm shadow-lg ${align === "end" ? "right-0" : "left-0"}`}
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            return (
              // biome-ignore lint/a11y/useKeyWithClickEvents: キーボードでの選択は aria-activedescendant を使い、フォーカスを持つ入力側の onKeyDown で受ける
              <div
                key={option.value}
                id={optionId(index)}
                data-index={index}
                role="option"
                tabIndex={-1}
                aria-selected={isSelected}
                className={`flex cursor-pointer items-center gap-2 whitespace-nowrap px-3 py-2 font-mono ${index === active ? "bg-accent-soft" : ""} ${isSelected ? "font-semibold text-accent" : ""}`}
                // ボタンからフォーカスを外さない（外れると blur で一覧が閉じ、click が届かない）
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(index)}
              >
                <span aria-hidden="true" className="w-3 shrink-0">
                  {isSelected ? "✓" : ""}
                </span>
                {option.label}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
