import { Result } from "@/utils/Result";
import {
  type Cell,
  type Column,
  type Database,
  type Table,
  validCell,
  validIdentifier,
  validTable,
} from "./model";

export type SqlEvaluation = Readonly<{
  database: Database;
  rows: readonly Readonly<Record<string, Cell>>[];
  affected: number;
  write: boolean;
  attemptedWrite: boolean;
  transaction: "NONE" | "COMMIT" | "ROLLBACK";
}>;
/** Split only outside SQL string literals and parentheses; never evaluate input as code. */
const split = (input: string, separator: string): Result<readonly string[], string> => {
  const parts: string[] = [];
  let quote = false;
  let depth = 0;
  let start = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === "'") {
      if (quote && input[i + 1] === "'") {
        i++;
        continue;
      }
      quote = !quote;
      continue;
    }
    if (quote) {
      continue;
    }
    if (char === "(") {
      depth++;
    }
    if (char === ")") {
      depth--;
    }
    if (depth < 0) {
      return Result.err("Unbalanced SQL parentheses.");
    }
    if (char === separator && depth === 0) {
      parts.push(input.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (quote || depth !== 0) {
    return Result.err("Unterminated SQL string or parentheses.");
  }
  parts.push(input.slice(start).trim());
  return Result.ok(parts);
};
const parseLiteral = (raw: string): Result<Cell, string> => {
  if (/^-?\d+$/.test(raw) && Number.isSafeInteger(Number(raw))) {
    return Result.ok(Number(raw));
  }
  if (/^'(?:[^']|'')*'$/.test(raw)) {
    return Result.ok(raw.slice(1, -1).replaceAll("''", "'"));
  }
  const vector = /^'\[([^\]]+)\]'(?:::vector)?$/i.exec(raw);
  if (vector) {
    return Result.ok((vector[1] ?? "").split(",").map(Number));
  }
  return Result.err(
    "Only integer, quoted text and three-dimensional vector literals are supported.",
  );
};
const typedValue = (raw: string, column: Column): Result<Cell, string> => {
  if (column.type === "vector") {
    const m = /^'\[([^\]]+)\]'(?:::vector)?$/i.exec(raw);
    const components = m?.[1]?.split(",") ?? [];
    if (components.some((v) => !/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(v.trim()))) {
      return Result.err("Invalid vector numeric literal.");
    }
    const cell = components.map(Number);
    return validCell(cell, column)
      ? Result.ok(cell)
      : Result.err("Vector must have three finite components and a nonzero norm.");
  }
  return Result.flatMap(parseLiteral(raw), (v) =>
    validCell(v, column) ? Result.ok(v) : Result.err(`Invalid value for ${column.name}.`),
  );
};
const finish = (
  database: Database,
  write: boolean,
  affected = 0,
  rows: SqlEvaluation["rows"] = [],
): Result<SqlEvaluation, string> =>
  Result.ok({ database, write, affected, rows, attemptedWrite: write, transaction: "NONE" });
const wherePredicate = (
  table: Table,
  raw?: string,
): Result<(row: Readonly<Record<string, Cell>>) => boolean, string> => {
  if (!raw) {
    return Result.ok(() => true);
  }
  const m = /^([a-z][a-z0-9_]*)\s*=\s*(.+)$/i.exec(raw.trim());
  const c = table.columns.find((c) => c.name === m?.[1]);
  if (!m || !c || c.type === "vector") {
    return Result.err("WHERE supports one equality on an existing integer/text column.");
  }
  return Result.map(typedValue(m[2] ?? "", c), (v) => (row) => row[c.name] === v);
};
const replaceTable = (database: Database, table: Table) => ({
  ...database,
  tables: database.tables.map((t) => (t.name === table.name ? table : t)),
});
const distance = (a: readonly number[], b: readonly number[]): number => {
  const normA = Math.hypot(...a);
  const normB = Math.hypot(...b);
  const dot = a.reduce((n, v, i) => n + (v / normA) * ((b[i] ?? 0) / normB), 0);
  return Math.max(0, Math.min(2, 1 - dot));
};
const evaluateOne = (
  database: Database,
  sql: string,
  postgres: boolean,
): Result<SqlEvaluation, string> => {
  if (/^CREATE EXTENSION(?: IF NOT EXISTS)? vector$/i.test(sql)) {
    if (database.vector && !/IF NOT EXISTS/i.test(sql)) {
      return Result.err("vector extension already exists.");
    }
    if (!postgres) {
      return Result.err("vector extension requires PostgreSQL.");
    }
    return finish({ ...database, vector: true }, true);
  }
  const create = /^CREATE TABLE ([a-z][a-z0-9_]*)\s*\((.+)\)$/is.exec(sql);
  if (create) {
    if (
      !validIdentifier(create[1] ?? "") ||
      database.tables.some((t) => t.name === (create[1] ?? "")) ||
      database.tables.length >= 20
    ) {
      return Result.err("Table already exists, has an invalid name or exceeds the 20-table limit.");
    }
    const defs = split(create[2] ?? "", ",");
    if (!defs.ok) {
      return defs;
    }
    const columns: Column[] = [];
    for (const definition of defs.value) {
      const m =
        /^([a-z][a-z0-9_]*)\s+(integer|int|text|vector\(3\))(\s+PRIMARY KEY)?(\s+NOT NULL)?$/i.exec(
          definition,
        );
      if (!m || !validIdentifier(m[1] ?? "")) {
        return Result.err(
          "Unsupported column definition; use integer, text, vector(3), PRIMARY KEY and NOT NULL.",
        );
      }
      let type: Column["type"] = "integer";
      if ((m[2] ?? "").toLowerCase() === "text") {
        type = "text";
      }
      if ((m[2] ?? "").toLowerCase() === "vector(3)") {
        type = "vector";
      }
      if (type === "vector" && !database.vector) {
        return Result.err("Enable vector extension first.");
      }
      columns.push({
        name: m[1] ?? "",
        type,
        primary: Boolean(m[3] ?? ""),
        required: Boolean((m[3] ?? "") || (m[4] ?? "")),
      });
    }
    const table: Table = { name: create[1] ?? "", columns, rows: [] };
    if (!validTable(table)) {
      return Result.err("Invalid or duplicate column/primary key.");
    }
    return finish({ ...database, tables: [...database.tables, table] }, true);
  }
  const insert = /^INSERT INTO ([a-z][a-z0-9_]*)(?:\s*\(([^)]+)\))?\s+VALUES\s*\((.+)\)$/is.exec(
    sql,
  );
  if (insert) {
    const table = database.tables.find((t) => t.name === (insert[1] ?? ""));
    if (!table) {
      return Result.err("Table does not exist.");
    }
    const names = insert[2]?.split(",").map((n) => n.trim()) ?? table.columns.map((c) => c.name);
    if (
      names.length !== table.columns.length ||
      new Set(names).size !== names.length ||
      names.some((n) => !table.columns.some((c) => c.name === n))
    ) {
      return Result.err("INSERT must provide every column exactly once.");
    }
    const values = split(insert[3] ?? "", ",");
    if (!values.ok) {
      return values;
    }
    if (values.value.length !== names.length) {
      return Result.err("INSERT column/value count mismatch.");
    }
    const row: Record<string, Cell> = {};
    for (const [i, n] of names.entries()) {
      const column = table.columns.find((c) => c.name === n);
      if (!column) {
        return Result.err("Unknown column.");
      }
      const value = typedValue(values.value[i] ?? "", column);
      if (!value.ok) {
        return value;
      }
      row[n] = value.value;
    }
    const next = { ...table, rows: [...table.rows, row] };
    if (!validTable(next)) {
      return Result.err("Duplicate primary key or 200-row limit exceeded.");
    }
    return finish(replaceTable(database, next), true, 1);
  }
  const update = /^UPDATE ([a-z][a-z0-9_]*) SET ([a-z][a-z0-9_]*)\s*=\s*(.+?) WHERE (.+)$/is.exec(
    sql,
  );
  const deletion = /^DELETE FROM ([a-z][a-z0-9_]*)(?: WHERE (.+))?$/is.exec(sql);
  if (update || deletion) {
    const table = database.tables.find((t) => t.name === (update?.[1] ?? deletion?.[1]));
    if (!table) {
      return Result.err("Table does not exist.");
    }
    const predicate = wherePredicate(table, update?.[4] ?? deletion?.[2]);
    if (!predicate.ok) {
      return predicate;
    }
    const affected = table.rows.filter(predicate.value).length;
    if (deletion) {
      return finish(
        replaceTable(database, {
          ...table,
          rows: table.rows.filter((row) => !predicate.value(row)),
        }),
        true,
        affected,
      );
    }
    const column = table.columns.find((c) => c.name === update?.[2]);
    if (!update || !column) {
      return Result.err("Unknown UPDATE column.");
    }
    const value = typedValue(update[3] ?? "", column);
    if (!value.ok) {
      return value;
    }
    const next = {
      ...table,
      rows: table.rows.map((row) =>
        predicate.value(row) ? { ...row, [column.name]: value.value } : row,
      ),
    };
    if (!validTable(next)) {
      return Result.err("UPDATE violates the primary key or schema.");
    }
    return finish(replaceTable(database, next), true, affected);
  }
  const select =
    /^SELECT (.+?) FROM ([a-z][a-z0-9_]*)(?: WHERE (.+?))?(?: ORDER BY (.+?))?(?: LIMIT (\d+))?$/is.exec(
      sql,
    );
  if (select) {
    const table = database.tables.find((t) => t.name === (select[2] ?? ""));
    if (!table) {
      return Result.err("Table does not exist.");
    }
    const predicate = wherePredicate(table, select[3] ?? "");
    if (!predicate.ok) {
      return predicate;
    }
    const fields = split(select[1] ?? "", ",");
    if (!fields.ok) {
      return fields;
    }
    let vectorColumn = "";
    let vector: readonly number[] = [];
    const distanceFields = fields.value.filter((f) => f.includes("<=>"));
    if (distanceFields.length > 1) {
      return Result.err("Only one distance projection is supported.");
    }
    const distanceField = distanceFields[0];
    const distanceRaw = distanceField ?? select[4] ?? "";
    if (distanceRaw?.includes("<=>")) {
      const m = /^([a-z][a-z0-9_]*)\s*<=>\s*'\[([^\]]+)\]'::vector(?:\s+AS distance)?$/i.exec(
        distanceRaw,
      );
      const c = table.columns.find((c) => c.name === m?.[1] && c.type === "vector");
      const components = m?.[2]?.split(",") ?? [];
      if (components.some((v) => !/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(v.trim()))) {
        return Result.err("Invalid cosine vector literal.");
      }
      vector = components.map(Number);
      if (!c || !validCell(vector, c) || !database.vector) {
        return Result.err("Invalid cosine distance expression.");
      }
      vectorColumn = c.name;
    }
    if (distanceField && !/ AS distance$/i.test(distanceField)) {
      return Result.err("Distance projections require AS distance.");
    }
    if (vectorColumn && table.columns.some((c) => c.name === "distance")) {
      return Result.err("Distance alias conflicts with a table column.");
    }
    const names = fields.value.filter((f) => f !== distanceField);
    if (names.some((n) => n !== "*" && !table.columns.some((c) => c.name === n))) {
      return Result.err("Unsupported SELECT projection.");
    }
    if (names.includes("*") && fields.value.length !== 1) {
      return Result.err("Use * alone.");
    }
    let rows = table.rows.filter(predicate.value).map((row) => ({ ...row }));
    if (vectorColumn) {
      rows = rows.map((row) => ({
        ...row,
        distance: distance(row[vectorColumn] as readonly number[], vector),
      }));
    }
    if (select[4] ?? "") {
      const order = /^([a-z][a-z0-9_]*)(?:\s+(ASC|DESC))?$/i.exec(select[4] ?? "");
      const directDistance = /^([a-z][a-z0-9_]*)\s*<=>\s*'\[([^\]]+)\]'::vector$/i.exec(
        select[4] ?? "",
      );
      if (!order && (!directDistance || distanceField)) {
        return Result.err("Unsupported ORDER BY.");
      }
      const name = order?.[1] ?? (vectorColumn ? "distance" : "");
      if (
        (!table.columns.some((c) => c.name === name && c.type !== "vector") &&
          name !== "distance") ||
        (name === "distance" &&
          !vectorColumn &&
          !table.columns.some((c) => c.name === "distance" && c.type !== "vector"))
      ) {
        return Result.err("Unsupported ORDER BY.");
      }
      rows.sort((a, b) => {
        const x = a[name];
        const y = b[name];
        const comparison =
          typeof x === "number" && typeof y === "number"
            ? x - y
            : String(x).localeCompare(String(y));
        return order?.[2]?.toUpperCase() === "DESC" ? -comparison : comparison;
      });
    }
    if (new Set(names).size !== names.length) {
      return Result.err("Duplicate SELECT projections are not supported.");
    }
    const limit = Number(select[5] ?? 200);
    if (limit < 1 || limit > 200) {
      return Result.err("LIMIT must be 1–200.");
    }
    rows = rows.slice(0, limit);
    const projection = names.includes("*") ? table.columns.map((c) => c.name) : names;
    if (distanceField) {
      projection.push("distance");
    }
    return finish(
      database,
      false,
      0,
      rows.map((row) => Object.fromEntries(projection.map((n) => [n, row[n] ?? ""]))),
    );
  }
  return Result.err(
    "Unsupported SQL. Supported: CREATE EXTENSION vector, CREATE TABLE, one-row INSERT, SELECT/equality/ORDER BY/LIMIT, UPDATE/equality, DELETE; BEGIN…COMMIT/ROLLBACK in one call.",
  );
};
export const evaluateSql = (
  database: Database,
  input: string,
  postgres: boolean,
): Result<SqlEvaluation, string> => {
  if (input.length > 20000) {
    return Result.err("SQL input exceeds 20,000 characters.");
  }
  const separated = split(input, ";");
  if (!separated.ok) {
    return separated;
  }
  const statements = separated.value.filter(Boolean);
  if (!statements.length || statements.length > 30) {
    return Result.err("Provide 1–30 SQL statements.");
  }
  const transaction = /^BEGIN$/i.test(statements[0] ?? "");
  const rollback = /^ROLLBACK$/i.test(statements.at(-1) ?? "");
  if (transaction && !/^(COMMIT|ROLLBACK)$/i.test(statements.at(-1) ?? "")) {
    return Result.err("BEGIN requires COMMIT or ROLLBACK in the same call.");
  }
  const body = transaction ? statements.slice(1, -1) : statements;
  let current = database;
  let write = false;
  let affected = 0;
  let rows: SqlEvaluation["rows"] = [];
  for (const sql of body) {
    const result = evaluateOne(current, sql, postgres);
    if (!result.ok) {
      return result;
    }
    current = result.value.database;
    write ||= result.value.write;
    affected += result.value.affected;
    rows = result.value.rows;
  }
  if (transaction && rollback) {
    return Result.map(finish(database, false), (v) => ({
      ...v,
      attemptedWrite: write,
      transaction: "ROLLBACK",
    }));
  }
  return Result.map(finish(current, write, affected, rows), (v) => ({
    ...v,
    transaction: transaction ? "COMMIT" : "NONE",
  }));
};
