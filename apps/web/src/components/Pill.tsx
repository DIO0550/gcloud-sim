import type { ReactElement, ReactNode } from "react";

export type PillTone = "ok" | "accent" | "muted";

const toneClass = (tone: PillTone): string => {
  switch (tone) {
    case "ok":
      return "bg-ok-soft text-ok-ink";
    case "accent":
      return "bg-accent-soft text-accent";
    case "muted":
      return "bg-canvas text-muted";
  }
};

/** 状態を示す小さな札（`RUNNING` / `クリア` / `挑戦中`）。 */
export const Pill = ({
  tone,
  children,
  className = "",
}: Readonly<{ tone: PillTone; children: ReactNode; className?: string }>): ReactElement => (
  <span className={`rounded px-1.5 py-0.5 text-xs ${toneClass(tone)} ${className}`}>
    {children}
  </span>
);
