import type { ReactElement } from "react";

export type DotStatus = "none" | "running" | "stopped" | "suspended";

/** ツリーの点とConsoleの状態アイコンで色・アクセシビリティを共有する。 */
export const StatusDot = ({
  status,
  label,
  variant = "dot",
}: Readonly<{
  status: DotStatus;
  label?: string;
  variant?: "dot" | "icon";
}>): ReactElement => {
  if (status === "none") {
    return <span className="hidden" />;
  }
  const accessibleLabel = label ?? (status === "running" ? "RUNNING" : "停止中");
  if (variant === "dot") {
    return (
      <span
        role="img"
        aria-label={accessibleLabel}
        className={`inline-block h-2 w-2 rounded-full ${status === "running" ? "bg-ok" : "bg-[#b5bcc5]"}`}
      />
    );
  }
  const symbol = () => {
    if (status === "running") {
      return <path d="M6 10.2l2.6 2.6L14 7.4" fill="none" stroke="white" strokeWidth="1.8" />;
    }
    if (status === "suspended") {
      return <path d="M8 6.5v7M12 6.5v7" stroke="white" strokeWidth="1.8" />;
    }
    return <rect x="7" y="7" width="6" height="6" rx="0.5" fill="white" />;
  };
  return (
    <span role="img" aria-label={accessibleLabel} title={accessibleLabel} className="inline-flex">
      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5">
        <circle
          cx="10"
          cy="10"
          r="9"
          className={status === "running" ? "fill-ok" : "fill-[#8a919c]"}
        />
        {symbol()}
      </svg>
    </span>
  );
};
