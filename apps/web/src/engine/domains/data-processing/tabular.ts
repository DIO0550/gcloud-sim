import { validIdentifier } from "@/engine/domains/relational/model";
import { Result } from "@/utils/Result";
import {
  type DataTable,
  type Field,
  type Row,
  rowMatches,
  type Scalar,
  validSchema,
} from "./model";

export const parseSchema = (raw: string): Result<readonly Field[], string> => {
  const fields = raw.split(",").map((s) => s.split(":"));
  if (fields.some((s) => s.length !== 2)) {
    return Result.err("Schema must be field:TYPE pairs.");
  }
  const schema = fields.map(([name, type]) => ({ name, type })) as Field[];
  return validSchema(schema)
    ? Result.ok(schema)
    : Result.err(
        "Invalid schema: supported types are STRING, INT64, FLOAT64, BOOL; 1..20 unique fields.",
      );
};
const csvCells = (line: string): Result<readonly string[], string> => {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  let closed = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"' && quoted && line[i + 1] === '"') {
      cell += '"';
      i += 1;
      continue;
    }
    if (ch === '"') {
      if (quoted) {
        quoted = false;
        closed = true;
      } else if (cell === "" && !closed) {
        quoted = true;
      } else {
        return Result.err("Malformed CSV quoting.");
      }
      continue;
    }
    if (ch === "," && !quoted) {
      cells.push(cell);
      cell = "";
      closed = false;
      continue;
    }
    if (closed) {
      return Result.err("Characters after CSV quote.");
    }
    cell += ch;
  }
  if (quoted) {
    return Result.err("Multiline CSV fields are unsupported.");
  }
  return Result.ok([...cells, cell]);
};
const convert = (raw: string, field: Field): Result<Scalar, string> => {
  if (field.type === "STRING") {
    return Result.ok(raw);
  }
  if (raw === "") {
    return Result.ok(null);
  }
  if (field.type === "BOOL") {
    if (!["true", "false"].includes(raw)) {
      return Result.err("BOOL requires true or false.");
    }
    return Result.ok(raw === "true");
  }
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw)) {
    return Result.err("Invalid numeric CSV value.");
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || (field.type === "INT64" && !Number.isSafeInteger(n))) {
    return Result.err("Numeric value is outside the supported range.");
  }
  return Result.ok(n);
};
export const parseRows = (
  data: string,
  schema: readonly Field[],
  format: string,
  skip = 0,
): Result<readonly Row[], string> => {
  if (
    !["CSV", "NEWLINE_DELIMITED_JSON"].includes(format) ||
    ![0, 1].includes(skip) ||
    (format !== "CSV" && skip !== 0)
  ) {
    return Result.err("Only CSV (skip 0/1) and NEWLINE_DELIMITED_JSON are supported.");
  }
  const lines = data
    .replaceAll("\r\n", "\n")
    .split("\n")
    .filter((v) => v !== "")
    .slice(skip);
  if (lines.length > 1000) {
    return Result.err("At most 1000 rows are supported.");
  }
  const rows: Row[] = [];
  for (const line of lines) {
    if (format === "NEWLINE_DELIMITED_JSON") {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        return Result.err("Invalid NDJSON row.");
      }
      if (
        typeof value !== "object" ||
        value === null ||
        Array.isArray(value) ||
        !rowMatches(value as Row, schema)
      ) {
        return Result.err("NDJSON row must match all schema fields and types.");
      }
      rows.push(value as Row);
      continue;
    }
    const cells = csvCells(line);
    if (!cells.ok) {
      return cells;
    }
    if (cells.value.length !== schema.length) {
      return Result.err("CSV field count differs from schema.");
    }
    const row: Record<string, Scalar> = Object.create(null);
    for (const [i, field] of schema.entries()) {
      const value = convert(cells.value[i] ?? "", field);
      if (!value.ok) {
        return value;
      }
      row[field.name] = value.value;
    }
    rows.push(row);
  }
  return Result.ok(rows);
};
export const select = (sql: string, table: DataTable): Result<readonly Row[], string> => {
  const match =
    /^SELECT\s+(.+?)\s+FROM\s+([`][a-z0-9_.-]+[`]|[a-z0-9_.-]+)(?:\s+WHERE\s+([a-z][a-z0-9_]*)\s*=\s*('[^']*'|true|false|null|[+-]?\d+(?:\.\d+)?))?(?:\s+GROUP\s+BY\s+([a-z][a-z0-9_]*))?(?:\s+ORDER\s+BY\s+([a-z][a-z0-9_]*)(?:\s+(ASC|DESC))?)?(?:\s+LIMIT\s+(\d+))?\s*;?$/i.exec(
      sql.trim(),
    );
  if (!match) {
    return Result.err(
      "Unsupported SQL. Use SELECT, equality WHERE, one GROUP BY, output ORDER BY and LIMIT.",
    );
  }
  const [, projection = "", , where, raw = "", group, order, direction, limitText] = match;
  const field = (name: string) => table.schema.find((f) => f.name === name);
  if ((where && !field(where)) || (group && !field(group))) {
    return Result.err("Unknown WHERE/GROUP BY field.");
  }
  let rows = [...table.rows];
  if (where) {
    let value: Scalar = null;
    if (raw.startsWith("'")) {
      value = raw.slice(1, -1);
    } else if (/^(true|false)$/i.test(raw)) {
      value = raw.toLowerCase() === "true";
    } else if (raw.toLowerCase() !== "null") {
      value = Number(raw);
    }
    const probe = Object.fromEntries(
      table.schema.map((f) => [f.name, f.name === where ? value : null]),
    );
    if (!rowMatches(probe, table.schema)) {
      return Result.err("WHERE literal type differs from schema.");
    }
    rows = rows.filter((r) => value !== null && r[where] === value);
  }
  const parts = projection.split(",").map((v) => v.trim());
  const expressions = parts.map((v) =>
    /^(COUNT\(\*\)|SUM\(([a-z][a-z0-9_]*)\))\s+AS\s+([a-z][a-z0-9_]*)$/i.exec(v),
  );
  const aggregate = expressions.some((v) => v !== null);
  let output: Row[];
  if (aggregate) {
    if (parts.some((v, i) => !expressions[i] && v !== group)) {
      return Result.err(
        "Aggregates require AS aliases and only the grouped field may be projected.",
      );
    }
    for (const expression of expressions) {
      if (expression?.[2] && !["INT64", "FLOAT64"].includes(field(expression[2])?.type ?? "")) {
        return Result.err("SUM requires a numeric field.");
      }
    }
    const keys = parts.map((v, i) => expressions[i]?.[3] ?? v);
    if (new Set(keys).size !== keys.length || keys.some((v) => !validIdentifier(v))) {
      return Result.err("Invalid/duplicate output aliases.");
    }
    const groups = new Map<Scalar, Row[]>();
    if (!group) {
      groups.set(null, rows);
    } else {
      for (const row of rows) {
        const key = row[group] ?? null;
        groups.set(key, [...(groups.get(key) ?? []), row]);
      }
    }
    output = [];
    for (const [key, members] of groups) {
      const row: Record<string, Scalar> = Object.create(null);
      for (const [i, part] of parts.entries()) {
        const expression = expressions[i];
        if (!expression) {
          row[part] = key;
          continue;
        }
        if (!expression[2]) {
          row[expression[3] ?? ""] = members.length;
          continue;
        }
        const numbers = members
          .map((r) => r[expression[2] ?? ""])
          .filter((v): v is number => typeof v === "number");
        const sum = numbers.reduce((a, b) => a + b, 0);
        if (
          !Number.isFinite(sum) ||
          (field(expression[2])?.type === "INT64" && !Number.isSafeInteger(sum))
        ) {
          return Result.err("SUM overflow.");
        }
        row[expression[3] ?? ""] = numbers.length === 0 ? null : sum;
      }
      output.push(row);
    }
  } else {
    if (group || (projection !== "*" && parts.some((v) => !field(v)))) {
      return Result.err("Unknown projection or unsupported grouping.");
    }
    const keys = projection === "*" ? table.schema.map((f) => f.name) : parts;
    if (new Set(keys).size !== keys.length) {
      return Result.err("Duplicate projection.");
    }
    output = rows.map((r) => Object.fromEntries(keys.map((k) => [k, r[k] ?? null])));
  }
  let outputKeys = parts;
  if (aggregate) {
    outputKeys = parts.map((v, i) => expressions[i]?.[3] ?? v);
  } else if (projection === "*") {
    outputKeys = table.schema.map((f) => f.name);
  }
  if (order && !outputKeys.includes(order)) {
    return Result.err("ORDER BY requires an output field.");
  }
  if (order) {
    output.sort((a, b) => {
      const x = a[order] ?? null;
      const y = b[order] ?? null;
      let result = 0;
      if (x !== y) {
        if (x === null) {
          result = -1;
        } else if (y === null) {
          result = 1;
        } else {
          result = x < y ? -1 : 1;
        }
      }
      return direction?.toUpperCase() === "DESC" ? -result : result;
    });
  }
  const limit = limitText ? Number(limitText) : 1000;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
    return Result.err("LIMIT must be 1..1000.");
  }
  return Result.ok(output.slice(0, limit));
};
