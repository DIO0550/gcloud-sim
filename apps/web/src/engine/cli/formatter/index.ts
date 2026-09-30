import { CommandFailure } from "@/engine/cli/command-failure";
import type { Column, JsonRecord, JsonValue } from "@/engine/cli/command-spec";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

/** `--format` を解釈した結果（DJ-009）。 */
export type OutputFormat =
  | Readonly<{ kind: "default" }>
  | Readonly<{ kind: "table"; paths: readonly string[] }>
  | Readonly<{ kind: "json" }>
  | Readonly<{ kind: "yaml" }>
  | Readonly<{ kind: "value"; paths: readonly string[] }>
  | Readonly<{ kind: "none" }>;

const splitPaths = (inner: string): readonly string[] =>
  inner
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p !== "");

export const OutputFormat = {
  /**
   * `--format` の綴りを解釈する。対応するのは `json` / `yaml` / `value(a,b)` / `table(a,b)` /
   * `none`。`text` / `flattened` / `csv` と projection / transform 構文は対応しない（E-003 に
   * する。yaml に寄せると本物と違う出力を学んでしまう）。
   *
   * @param value `--format` の値。無ければ既定
   * @returns 解釈した形式。未対応なら E-003
   */
  parse(value: Option<string>): Result<OutputFormat, CommandFailure> {
    if (!Option.isSome(value)) return Result.ok({ kind: "default" });
    const raw = value.value.trim();
    if (raw === "json") return Result.ok({ kind: "json" });
    if (raw === "yaml") return Result.ok({ kind: "yaml" });
    if (raw === "none") return Result.ok({ kind: "none" });
    const call = /^(value|table)\((.*)\)$/.exec(raw);
    if (call !== null) {
      const [, name, inner] = call;
      const paths = splitPaths(inner ?? "");
      return name === "value"
        ? Result.ok({ kind: "value", paths })
        : Result.ok({ kind: "table", paths });
    }
    return Result.err(
      CommandFailure.invalidValue(
        "--format",
        `Unsupported format [${raw}]. gcloud-sim supports json, yaml, value(FIELDS), table(FIELDS) and none.`,
      ),
    );
  },
} as const;

export const JsonPath = {
  /**
   * `a.b[0].c` の形でレコードから値を取り出す。
   *
   * @param record レコード
   * @param path ドットと `[n]` のパス
   * @returns 値。途中で無ければ `undefined`
   */
  get(record: JsonValue, path: string): JsonValue {
    const segments = path
      .replace(/\[(\d+)\]/g, ".$1")
      .split(".")
      .filter((s) => s !== "");
    return segments.reduce<JsonValue>((current, segment) => {
      if (Array.isArray(current)) return current[Number(segment)];
      if (current !== null && typeof current === "object") {
        return (current as Readonly<Record<string, JsonValue>>)[segment];
      }
      return undefined;
    }, record);
  },
} as const;

const basename = (value: JsonValue): JsonValue =>
  typeof value === "string" ? value.slice(value.lastIndexOf("/") + 1) : value;

const cell = (value: JsonValue): string => {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(cell).join(",");
  return JSON.stringify(value);
};

const columnValue = (record: JsonRecord, column: Column): string => {
  const raw = JsonPath.get(record, column.path);
  switch (column.transform) {
    case "none":
      return cell(raw);
    case "basename":
      return cell(basename(raw));
    case "join":
      return Array.isArray(raw) ? raw.map(cell).join(",") : cell(raw);
    case "flag":
      return raw === true ? "true" : "";
  }
};

const renderTable = (
  records: readonly JsonRecord[],
  columns: readonly Column[],
): readonly string[] => {
  const rows = records.map((record) => columns.map((column) => columnValue(record, column)));
  const widths = columns.map((column, i) =>
    Math.max(column.header.length, ...rows.map((row) => (row[i] ?? "").length)),
  );
  const line = (cells: readonly string[]): string =>
    cells
      .map((c, i) => c.padEnd(widths[i] ?? 0))
      .join("  ")
      .trimEnd();
  return [line(columns.map((c) => c.header)), ...rows.map(line)];
};

const yamlScalar = (value: string | number | boolean | null): string => {
  if (value === null) return "null";
  if (typeof value !== "string") return String(value);
  const needsQuote =
    value === "" || /^[\s#&*!|>'"%@`{}[\],:?-]|:\s|\s$|^(true|false|null|~)$|^-?\d/.test(value);
  return needsQuote ? JSON.stringify(value) : value;
};

const yamlLines = (value: JsonValue, indent: number): readonly string[] => {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${pad}[]`];
    return value.flatMap((item) => {
      const nested = yamlLines(item, indent + 2);
      const isScalar = item === null || typeof item !== "object";
      if (isScalar) return [`${pad}- ${nested[0]?.trimStart() ?? ""}`];
      const [first = "", ...rest] = nested;
      return [`${pad}- ${first.trimStart()}`, ...rest];
    });
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return [`${pad}{}`];
    return entries.flatMap(([key, item]) => {
      const isScalar = item === null || typeof item !== "object";
      const isEmpty =
        !isScalar && (Array.isArray(item) ? item.length === 0 : Object.keys(item).length === 0);
      if (isScalar)
        return [`${pad}${key}: ${yamlScalar(item as string | number | boolean | null)}`];
      if (isEmpty) return [`${pad}${key}: ${Array.isArray(item) ? "[]" : "{}"}`];
      // 配列の `-` はキーと同じ深さに置く（本物の gcloud の YAML と同じ）。
      return [`${pad}${key}:`, ...yamlLines(item, Array.isArray(item) ? indent : indent + 2)];
    });
  }
  return [`${pad}${yamlScalar(value === undefined ? null : value)}`];
};

export const Yaml = {
  /**
   * レコードを YAML の行にする。キーは辞書順ではなく挿入順（本物は辞書順だが、
   * ポリシーの `bindings` のような主要項目を先頭に出したい）。
   *
   * @param value 出力する値
   * @returns 行の並び
   */
  render(value: JsonValue): readonly string[] {
    return yamlLines(value, 0);
  },
} as const;

// --- filter ---

/** `--filter` の式（設計書 9.2 の簡易版: `=` `!=` `:` `NOT` `AND` `OR`）。 */
export type FilterExpr =
  | Readonly<{
      kind: "compare";
      path: string;
      op: "=" | "!=" | ":" | ">" | "<" | ">=" | "<=";
      value: string;
    }>
  | Readonly<{ kind: "not"; expr: FilterExpr }>
  | Readonly<{ kind: "and"; left: FilterExpr; right: FilterExpr }>
  | Readonly<{ kind: "or"; left: FilterExpr; right: FilterExpr }>;

type Cursor = Readonly<{ tokens: readonly string[]; index: number }>;
type Parsed = Readonly<{ expr: FilterExpr; cursor: Cursor }>;

const peek = (cursor: Cursor): string | undefined => cursor.tokens[cursor.index];
const advance = (cursor: Cursor): Cursor => ({ ...cursor, index: cursor.index + 1 });

const tokenizeFilter = (raw: string): readonly string[] => {
  const tokens: string[] = [];
  const pattern = /"[^"]*"|'[^']*'|\(|\)|\S+/g;
  for (const match of raw.matchAll(pattern)) tokens.push(match[0]);
  return tokens;
};

const unquote = (value: string): string =>
  (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))
    ? value.slice(1, -1)
    : value;

const parseTerm = (cursor: Cursor): Result<Parsed, string> => {
  const token = peek(cursor);
  if (token === undefined) return Result.err("expected an expression");
  if (token === "(") {
    const inner = parseOr(advance(cursor));
    if (!Result.isOk(inner)) return inner;
    if (peek(inner.value.cursor) !== ")") return Result.err("expected ')'");
    return Result.ok({ expr: inner.value.expr, cursor: advance(inner.value.cursor) });
  }
  if (token.toUpperCase() === "NOT" || token === "-") {
    return Result.map(parseTerm(advance(cursor)), (p) => ({
      expr: { kind: "not", expr: p.expr },
      cursor: p.cursor,
    }));
  }
  const match = /^(-)?([A-Za-z0-9_.[\]]+)(>=|<=|!=|=|:|>|<)(.*)$/.exec(token);
  if (match === null) return Result.err(`unexpected token [${token}]`);
  const [, negate, path = "", op, rest = ""] = match;
  const next = rest === "" ? peek(advance(cursor)) : undefined;
  const value = rest === "" ? next : rest;
  if (value === undefined) return Result.err(`expected a value after [${token}]`);
  const compare: FilterExpr = {
    kind: "compare",
    path,
    op: op as ">=" | "<=" | "!=" | "=" | ":" | ">" | "<",
    value: unquote(value),
  };
  const after = rest === "" ? advance(advance(cursor)) : advance(cursor);
  return Result.ok({ expr: negate ? { kind: "not", expr: compare } : compare, cursor: after });
};

const parseAnd = (cursor: Cursor): Result<Parsed, string> => {
  const first = parseTerm(cursor);
  if (!Result.isOk(first)) return first;
  let current = first.value;
  while (true) {
    const token = peek(current.cursor);
    const isAnd = token?.toUpperCase() === "AND";
    const isImplicit =
      token !== undefined && token !== ")" && token.toUpperCase() !== "OR" && !isAnd;
    if (!isAnd && !isImplicit) return Result.ok(current);
    const right = parseTerm(isAnd ? advance(current.cursor) : current.cursor);
    if (!Result.isOk(right)) return right;
    current = {
      expr: { kind: "and", left: current.expr, right: right.value.expr },
      cursor: right.value.cursor,
    };
  }
};

const parseOr = (cursor: Cursor): Result<Parsed, string> => {
  const first = parseAnd(cursor);
  if (!Result.isOk(first)) return first;
  let current = first.value;
  while (peek(current.cursor)?.toUpperCase() === "OR") {
    const right = parseAnd(advance(current.cursor));
    if (!Result.isOk(right)) return right;
    current = {
      expr: { kind: "or", left: current.expr, right: right.value.expr },
      cursor: right.value.cursor,
    };
  }
  return Result.ok(current);
};

/** 1 つの値を比較する。`=` / `!=` は URL の末尾（basename）とも突き合わせる。 */
const compareOne = (candidate: JsonValue, op: FilterExpr & { kind: "compare" }): boolean => {
  const text = cell(candidate);
  const short = cell(basename(candidate));
  const expected = op.value;
  switch (op.op) {
    case "=":
      return text === expected || short === expected;
    case "!=":
      return text !== expected && short !== expected;
    case ":":
      return text.toLowerCase().includes(expected.toLowerCase());
    case ">":
      return Number(text) > Number(expected);
    case "<":
      return Number(text) < Number(expected);
    case ">=":
      return Number(text) >= Number(expected);
    case "<=":
      return Number(text) <= Number(expected);
  }
};

const compareValues = (actual: JsonValue, op: FilterExpr & { kind: "compare" }): boolean => {
  const candidates = Array.isArray(actual) ? actual : [actual];
  return candidates.some((candidate) => compareOne(candidate, op));
};

const evaluate = (expr: FilterExpr, record: JsonRecord): boolean => {
  switch (expr.kind) {
    case "compare":
      return compareValues(JsonPath.get(record, expr.path), expr);
    case "not":
      return !evaluate(expr.expr, record);
    case "and":
      return evaluate(expr.left, record) && evaluate(expr.right, record);
    case "or":
      return evaluate(expr.left, record) || evaluate(expr.right, record);
  }
};

export const Filter = {
  /**
   * `--filter` の式を解釈する。
   *
   * @param raw `status=RUNNING AND name:web` のような式
   * @returns 式。文法に合わなければ E-003
   */
  parse(raw: string): Result<FilterExpr, CommandFailure> {
    const parsed = parseOr({ tokens: tokenizeFilter(raw), index: 0 });
    if (!Result.isOk(parsed)) {
      return Result.err(
        CommandFailure.invalidValue("--filter", `Invalid filter expression: ${parsed.error}`),
      );
    }
    if (peek(parsed.value.cursor) !== undefined) {
      return Result.err(
        CommandFailure.invalidValue(
          "--filter",
          `Invalid filter expression: unexpected [${peek(parsed.value.cursor)}]`,
        ),
      );
    }
    return Result.ok(parsed.value.expr);
  },

  matches: evaluate,
} as const;

/** 出力の並び替えと絞り込みの指定。 */
export type ListOptions = Readonly<{
  format: OutputFormat;
  filter: Option<FilterExpr>;
  limit: Option<number>;
  sortBy: Option<string>;
}>;

const sortRecords = (
  records: readonly JsonRecord[],
  sortBy: Option<string>,
): readonly JsonRecord[] => {
  if (!Option.isSome(sortBy)) return records;
  const descending = sortBy.value.startsWith("~");
  const path = descending ? sortBy.value.slice(1) : sortBy.value;
  const sorted = records.toSorted((a, b) =>
    cell(JsonPath.get(a, path)).localeCompare(cell(JsonPath.get(b, path))),
  );
  return descending ? sorted.toReversed() : sorted;
};

export const Formatter = {
  /**
   * レコードを `--format` / `--filter` / `--sort-by` / `--limit` に従って行にする。
   *
   * @param records コマンドが返したレコード
   * @param columns 既定の table の列
   * @param defaultFormat 既定の形式（list / create は table、describe は yaml）
   * @param options 出力の指定
   * @returns 出力行。table で 0 件なら `Listed 0 items.`
   */
  render(
    records: readonly JsonRecord[],
    columns: readonly Column[],
    defaultFormat: "table" | "yaml" | "none",
    options: ListOptions,
  ): readonly string[] {
    const filterExpr = options.filter;
    const filtered = Option.isSome(filterExpr)
      ? records.filter((r) => Filter.matches(filterExpr.value, r))
      : records;
    const sorted = sortRecords(filtered, options.sortBy);
    const limited = Option.isSome(options.limit) ? sorted.slice(0, options.limit.value) : sorted;
    const format: Exclude<OutputFormat, { kind: "default" }> =
      options.format.kind === "default"
        ? defaultFormat === "none"
          ? { kind: "none" }
          : defaultFormat === "table"
            ? { kind: "table", paths: [] }
            : { kind: "yaml" }
        : options.format;
    switch (format.kind) {
      case "none":
        return [];
      case "json":
        return JSON.stringify(
          defaultFormat === "yaml" && limited.length === 1 ? limited[0] : limited,
          null,
          2,
        ).split("\n");
      case "yaml":
        return limited.flatMap((record, i) =>
          i === 0 ? Yaml.render(record) : ["---", ...Yaml.render(record)],
        );
      case "value":
        return limited.map((record) =>
          format.paths.map((path) => cell(JsonPath.get(record, path))).join("\t"),
        );
      case "table": {
        const chosen =
          format.paths.length === 0
            ? columns
            : format.paths.map(
                (path): Column => ({ header: path.toUpperCase(), path, transform: "none" }),
              );
        if (limited.length === 0) return ["Listed 0 items."];
        return renderTable(limited, chosen);
      }
    }
  },
} as const;
