import { CommandFailure } from "@/engine/cli/command-failure";
import { Filter, type FilterExpr } from "@/engine/cli/formatter";
import type { JsonRecord } from "@/types/Json";
import { Result } from "@/utils/Result";

const Severity = {
  DEFAULT: 0,
  DEBUG: 100,
  INFO: 200,
  NOTICE: 300,
  WARNING: 400,
  ERROR: 500,
  CRITICAL: 600,
  ALERT: 700,
  EMERGENCY: 800,
} as const;
const severity = (value: string): number | undefined =>
  Object.entries(Severity).find(([name]) => name === value)?.[1];

const normalize = (expr: FilterExpr): Result<FilterExpr, CommandFailure> => {
  if (expr.kind === "compare") {
    if (expr.path !== "severity" || expr.op === ":") return Result.ok(expr);
    const level = severity(expr.value);
    if (level === undefined)
      return Result.err(
        CommandFailure.invalidValue("LOG_FILTER", `Unknown severity: ${expr.value}`),
      );
    return Result.ok({ ...expr, value: String(level) });
  }
  if (expr.kind === "not")
    return Result.map(normalize(expr.expr), (child) => ({ ...expr, expr: child }));
  return Result.flatMap(normalize(expr.left), (left) =>
    Result.map(normalize(expr.right), (right) => ({ ...expr, left, right })),
  );
};

export const LogFilter = {
  parse(raw: string): Result<FilterExpr, CommandFailure> {
    return Result.flatMap(Filter.parse(raw), normalize);
  },
  matches(expr: FilterExpr, record: JsonRecord): boolean {
    if (expr.kind === "compare") {
      if (expr.path !== "severity" || expr.op === ":") return Filter.matches(expr, record);
      return Filter.matches(expr, { ...record, severity: severity(String(record.severity)) });
    }
    if (expr.kind === "not") return !LogFilter.matches(expr.expr, record);
    if (expr.kind === "and")
      return LogFilter.matches(expr.left, record) && LogFilter.matches(expr.right, record);
    return LogFilter.matches(expr.left, record) || LogFilter.matches(expr.right, record);
  },
} as const;
