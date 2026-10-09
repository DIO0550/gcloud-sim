import type { Database, Table } from "@/engine/domains/relational/model";
import { evaluateSql, type SqlEvaluation } from "@/engine/domains/relational/sql";
import { Result } from "@/utils/Result";

/** GoogleSQL teaching subset; conversion never executes input or rewrites quoted text. */
const rewrite = (sql: string): Result<string, string> => {
  const tokens = sql.split(/('(?:[^']|'')*')/g);
  const converted = tokens
    .map((token, index) => {
      if (index % 2 === 1) {
        return token;
      }
      return token
        .replace(/\bINT64\b/gi, "integer")
        .replace(/\bSTRING\(MAX\)/gi, "text")
        .replace(/\bARRAY<FLOAT64>/gi, "vector(3)")
        .replace(
          /COSINE_DISTANCE\(([a-z][a-z0-9_]*),\s*(\[[\d.,eE+\-\s]+\])\)/gi,
          "$1 <=> '$2'::vector",
        )
        .replace(/(?<!')\[([\d.,eE+\-\s]+)\](?!')/g, "'[$1]'");
    })
    .join("");
  const ddl =
    /^CREATE TABLE ([a-z][a-z0-9_]*)\s*\((.+)\)\s*PRIMARY KEY\s*\(([a-z][a-z0-9_]*)\)$/is.exec(
      converted.trim(),
    );
  if (ddl) {
    const columns = (ddl[2] ?? "").split(",").map((c) => c.trim());
    const key = ddl[3] ?? "";
    if (!columns.some((c) => c.startsWith(`${key} `))) {
      return Result.err("PRIMARY KEY must name an existing column.");
    }
    const keyed = columns.map((c) =>
      c.startsWith(`${key} `) ? `${c.replace(/\s+NOT NULL$/i, "")} PRIMARY KEY NOT NULL` : c,
    );
    return Result.ok(`CREATE TABLE ${ddl[1]} (${keyed.join(", ")})`);
  }
  return Result.ok(converted);
};
export const spannerSql = (
  tables: readonly Table[],
  sql: string,
): Result<SqlEvaluation, string> => {
  if (sql.includes(";") || /\bCREATE EXTENSION\b/i.test(sql)) {
    return Result.err(
      "Spanner lesson accepts one statement per call; PostgreSQL extensions are unsupported.",
    );
  }
  const rewritten = rewrite(sql);
  if (!rewritten.ok) {
    return rewritten;
  }
  const db: Database = {
    projectId: "",
    kind: "sql",
    server: "",
    name: "app",
    vector: true,
    tables,
  };
  return Result.flatMap(evaluateSql(db, rewritten.value, true), (value) => {
    if (!value.database.tables.every((t) => t.columns.some((c) => c.primary))) {
      return Result.err("Spanner tables require a primary key.");
    }
    return Result.ok(value);
  });
};
