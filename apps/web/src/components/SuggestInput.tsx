import { type KeyboardEvent, type ReactElement, useEffect, useId, useRef, useState } from "react";

export type Suggestion = Readonly<{ value: string; description: string }>;

type SuggestInputProps = Readonly<{
  id?: string;
  value: string;
  suggestions: readonly Suggestion[];
  onChange: (value: string) => void;
  /** 入力欄の見た目（Field の入力欄と揃える） */
  className: string;
  /** 一度に出す候補の数 */
  limit?: number;
}>;

/** 打った文字を値か説明に含む候補（大文字小文字は区別しない）。空なら全部。 */
const matches = (suggestions: readonly Suggestion[], text: string): readonly Suggestion[] => {
  const needle = text.trim().toLowerCase();
  if (needle === "") return suggestions;
  return suggestions.filter(
    (s) => s.value.toLowerCase().includes(needle) || s.description.toLowerCase().includes(needle),
  );
};

/**
 * 自由入力に候補を添える入力欄（ネイティブの `<datalist>` の代わり。WAI-ARIA の list autocomplete）。
 * 候補に無い値もそのまま打てる。↑↓ で候補を選び、Enter で入れる。
 */
export const SuggestInput = ({
  id,
  value,
  suggestions,
  onChange,
  className,
  limit = 50,
}: SuggestInputProps): ReactElement => {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<number | undefined>(undefined);
  const listRef = useRef<HTMLDivElement>(null);
  const shown = matches(suggestions, value).slice(0, limit);
  const isOpen = open && shown.length > 0;
  const optionId = (index: number): string => `${listId}-${index}`;

  useEffect(() => {
    if (!isOpen || active === undefined) return;
    const el = listRef.current?.querySelector(`[data-index="${active}"]`);
    // jsdom には scrollIntoView が無い
    if (el instanceof HTMLElement) el.scrollIntoView?.({ block: "nearest" });
  }, [isOpen, active]);

  const choose = (suggestion: Suggestion): void => {
    onChange(suggestion.value);
    setOpen(false);
    setActive(undefined);
  };
  const move = (delta: 1 | -1): void => {
    setOpen(true);
    setActive((i) => {
      if (i === undefined) return delta === 1 ? 0 : shown.length - 1;
      return Math.min(Math.max(i + delta, 0), shown.length - 1);
    });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        event.preventDefault();
        move(event.key === "ArrowDown" ? 1 : -1);
        return;
      case "Enter": {
        const suggestion = active === undefined ? undefined : shown[active];
        if (!isOpen || suggestion === undefined) return;
        event.preventDefault();
        choose(suggestion);
        return;
      }
      case "Escape":
        if (!isOpen) return;
        event.preventDefault();
        setOpen(false);
        setActive(undefined);
        return;
    }
  };

  return (
    <div className="relative">
      <input
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={listId}
        aria-activedescendant={isOpen && active !== undefined ? optionId(active) : undefined}
        autoComplete="off"
        className={className}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setActive(undefined);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setActive(undefined);
        }}
        onKeyDown={onKeyDown}
      />
      {isOpen && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          className="absolute top-full left-0 z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-line bg-surface py-1 text-sm shadow-lg"
        >
          {shown.map((suggestion, index) => (
            // biome-ignore lint/a11y/useKeyWithClickEvents: キーボードでの選択は aria-activedescendant を使い、フォーカスを持つ入力側の onKeyDown で受ける
            <div
              key={suggestion.value}
              id={optionId(index)}
              data-index={index}
              role="option"
              tabIndex={-1}
              aria-selected={index === active}
              className={`cursor-pointer px-3 py-1.5 ${index === active ? "bg-accent-soft" : ""}`}
              // 入力欄からフォーカスを外さない（外れると blur で一覧が閉じ、click が届かない）
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(suggestion)}
            >
              <span className="block font-mono text-xs">{suggestion.value}</span>
              <span className="block text-muted text-xs">{suggestion.description}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
