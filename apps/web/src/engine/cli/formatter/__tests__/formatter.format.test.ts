// @vitest-environment node
import { expect, test } from "vitest";

import { Column } from "@/engine/cli/command-spec";
import { Filter, Formatter, type ListOptions, OutputFormat } from "@/engine/cli/formatter";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const records = [
  {
    name: "web-1",
    status: "RUNNING",
    zone: "https://www.googleapis.com/compute/v1/projects/p/zones/asia-northeast1-a",
    tags: { items: ["http-server"] },
  },
  {
    name: "batch-1",
    status: "TERMINATED",
    zone: "https://www.googleapis.com/compute/v1/projects/p/zones/asia-northeast1-b",
    tags: { items: [] },
  },
];
const columns = [
  Column.create("NAME", "name"),
  Column.create("ZONE", "zone", "basename"),
  Column.create("STATUS", "status"),
];

const options = (overrides: Partial<ListOptions> = {}): ListOptions => ({
  format: { kind: "default" },
  filter: Option.none,
  limit: Option.none,
  sortBy: Option.none,
  ...overrides,
});

test("既定の table は列を揃えて出す", () => {
  const lines = Formatter.render(records, columns, "table", options());
  expect(lines).toEqual([
    "NAME     ZONE               STATUS",
    "web-1    asia-northeast1-a  RUNNING",
    "batch-1  asia-northeast1-b  TERMINATED",
  ]);
});

test("table で 0 件なら Listed 0 items. を出す", () => {
  expect(Formatter.render([], columns, "table", options())).toEqual(["Listed 0 items."]);
});

test("--format=json は API 表現のキーで出す", () => {
  const lines = Formatter.render(records, columns, "table", options({ format: { kind: "json" } }));
  expect(JSON.parse(lines.join("\n"))).toEqual(records);
});

test("--format=json で describe（1 件の yaml 既定）は配列ではなく単体で出す", () => {
  const lines = Formatter.render(
    [records[0] as (typeof records)[number]],
    columns,
    "yaml",
    options({ format: { kind: "json" } }),
  );
  expect(JSON.parse(lines.join("\n"))).toEqual(records[0]);
});

test("--format=yaml はキーと値を行にし、入れ子をインデントする", () => {
  const lines = Formatter.render(
    [records[0] as (typeof records)[number]],
    columns,
    "yaml",
    options({ format: { kind: "yaml" } }),
  );
  expect(lines).toEqual([
    "name: web-1",
    "status: RUNNING",
    "zone: https://www.googleapis.com/compute/v1/projects/p/zones/asia-northeast1-a",
    "tags:",
    "  items:",
    "  - http-server",
  ]);
});

test("--format=value(name,status) はタブ区切りの 1 行にする", () => {
  const lines = Formatter.render(
    records,
    columns,
    "table",
    options({ format: { kind: "value", paths: ["name", "status"] } }),
  );
  expect(lines).toEqual(["web-1\tRUNNING", "batch-1\tTERMINATED"]);
});

test("--format=table(name) は列を差し替える", () => {
  const lines = Formatter.render(
    records,
    columns,
    "table",
    options({ format: { kind: "table", paths: ["name"] } }),
  );
  expect(lines).toEqual(["NAME", "web-1", "batch-1"]);
});

test("--filter=status=RUNNING は等価で絞る", () => {
  const filter = Option.some(Result.unwrap(Filter.parse("status=RUNNING")));
  const lines = Formatter.render(
    records,
    columns,
    "table",
    options({ filter, format: { kind: "value", paths: ["name"] } }),
  );
  expect(lines).toEqual(["web-1"]);
});

test("--filter=name:bat は部分一致で絞る", () => {
  const filter = Option.some(Result.unwrap(Filter.parse("name:bat")));
  const lines = Formatter.render(
    records,
    columns,
    "table",
    options({ filter, format: { kind: "value", paths: ["name"] } }),
  );
  expect(lines).toEqual(["batch-1"]);
});

test("--filter は URL の末尾（basename）とも等価比較する", () => {
  const filter = Option.some(Result.unwrap(Filter.parse("zone=asia-northeast1-b")));
  const lines = Formatter.render(
    records,
    columns,
    "table",
    options({ filter, format: { kind: "value", paths: ["name"] } }),
  );
  expect(lines).toEqual(["batch-1"]);
});

test("NOT と AND を組み合わせられる", () => {
  const filter = Option.some(Result.unwrap(Filter.parse("NOT status=RUNNING AND name:1")));
  const lines = Formatter.render(
    records,
    columns,
    "table",
    options({ filter, format: { kind: "value", paths: ["name"] } }),
  );
  expect(lines).toEqual(["batch-1"]);
});

test("OR は片方が真なら通す", () => {
  const filter = Option.some(Result.unwrap(Filter.parse("name=web-1 OR name=batch-1")));
  const lines = Formatter.render(
    records,
    columns,
    "table",
    options({ filter, format: { kind: "value", paths: ["name"] } }),
  );
  expect(lines).toEqual(["web-1", "batch-1"]);
});

test("配列の中も : で探せる", () => {
  const filter = Option.some(Result.unwrap(Filter.parse("tags.items:http")));
  const lines = Formatter.render(
    records,
    columns,
    "table",
    options({ filter, format: { kind: "value", paths: ["name"] } }),
  );
  expect(lines).toEqual(["web-1"]);
});

test("--sort-by=~name は降順、--limit=1 は先頭だけ", () => {
  const lines = Formatter.render(
    records,
    columns,
    "table",
    options({
      sortBy: Option.some("~name"),
      limit: Option.some(1),
      format: { kind: "value", paths: ["name"] },
    }),
  );
  expect(lines).toEqual(["web-1"]);
});

test("未対応の --format は E-003 になる", () => {
  const result = OutputFormat.parse(Option.some("table[box](name)"));
  expect(Result.isOk(result)).toBe(false);
  if (!Result.isOk(result)) expect(result.error.code).toBe("E-003");
});

test.each(["text", "flattened", "csv(name)"])(
  "本物にはあるが再現していない --format=%s は yaml に寄せず E-003 になる",
  (format) => {
    const result = OutputFormat.parse(Option.some(format));
    expect(Result.isOk(result)).toBe(false);
    if (!Result.isOk(result))
      expect(result.error.message).toContain(`Unsupported format [${format}]`);
  },
);

test("文法に合わない --filter は E-003 になる", () => {
  const result = Filter.parse("status=");
  expect(Result.isOk(result)).toBe(false);
  if (!Result.isOk(result)) expect(result.error.code).toBe("E-003");
});
