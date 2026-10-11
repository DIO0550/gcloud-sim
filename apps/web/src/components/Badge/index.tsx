import type { ReactElement, ReactNode } from "react";

export type BadgeTone = "ok" | "accent" | "muted";

const toneClass = (tone: BadgeTone): string => {
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
export const Badge = ({
  tone,
  children,
  className = "",
}: Readonly<{ tone: BadgeTone; children: ReactNode; className?: string }>): ReactElement => (
  <span className={`rounded px-1.5 py-0.5 text-xs ${toneClass(tone)} ${className}`}>
    {children}
  </span>
);
