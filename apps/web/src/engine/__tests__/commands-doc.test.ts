// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "vitest";

import { Engine } from "@/engine";

/** `docs/COMMANDS.md` は登録簿から作っている。登録簿を変えたら表も直す。 */
const doc = readFileSync(join(__dirname, "../../../../../docs/COMMANDS.md"), "utf8");

test("登録されているコマンドはすべて docs/COMMANDS.md に載っている", () => {
  const missing = Engine.registry.specs
    .map((s) => s.path.join(" "))
    .filter((path) => !doc.includes(`| \`${path}\` |`));
  expect(missing).toEqual([]);
});

test("docs/COMMANDS.md の件数は登録簿と一致する", () => {
  const implemented = Engine.registry.specs.filter((s) => s.kind !== "not-implemented").length;
  const stubs = Engine.registry.specs.length - implemented;
  expect(doc).toContain(`## 実装済み（${implemented}）`);
  expect(doc).toContain(`## 解決はできるが未実装（${stubs}）`);
});
