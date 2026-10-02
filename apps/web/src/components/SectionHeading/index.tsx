import type { ReactElement, ReactNode } from "react";

/** ペインの中の小見出し（`基本` / `コマンド履歴` / ドメイン名）。余白は置き場が決める。 */
export const SectionHeading = ({
  children,
  className = "mb-1",
}: Readonly<{ children: ReactNode; className?: string }>): ReactElement => (
  <h4 className={`font-bold text-[13px] text-muted tracking-wider ${className}`}>{children}</h4>
);
