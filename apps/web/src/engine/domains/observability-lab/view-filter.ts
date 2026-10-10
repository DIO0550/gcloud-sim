import { CommandFailure } from "@/engine/cli/command-failure";
import type { FilterExpr } from "@/engine/cli/formatter";
import { LogFilter } from "@/engine/commands/observability/filter";
import { Result } from "@/utils/Result";

const supported = (expr: FilterExpr): boolean => {
  if (expr.kind === "compare") {
    return (
      expr.op === "=" &&
      ["resource.type", "resource.labels.project_id", "logName"].includes(expr.path)
    );
  }
  if (expr.kind === "not") {
    return supported(expr.expr);
  }
  return supported(expr.left) && supported(expr.right);
};

/** Bounded view grammar: source(), log_id(), resource.type, AND/OR/NOT. */
export const parseViewFilter = (raw: string, projectId: string) => {
  const normalized = raw
    .replace(/source\("projects\/([a-z0-9-]+)"\)/g, 'resource.labels.project_id="$1"')
    .replace(
      /log_id\("([^"\n]+)"\)/g,
      (_, id: string) => `logName="projects/${projectId}/logs/${encodeURIComponent(id)}"`,
    );
  return Result.flatMap(LogFilter.parse(normalized), (expr) => {
    if (!supported(expr)) {
      return Result.err(
        CommandFailure.invalidArgumentWith(
          "Views support source(), log_id() and resource.type equality with AND/OR/NOT. Severity and payload filters are unsupported.",
        ),
      );
    }
    return Result.ok(expr);
  });
};
