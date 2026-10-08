// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "vitest";

/**
 * `engine/` は React・DOM・I/O に依存しない（DJ-002）。lint に import 制限が無いので、
 * ソースを走査して禁止の語が無いことを確かめる。テストは対象外。
 */
const engineRoot = join(__dirname, "..");

const sourceFiles = (dir: string): readonly string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === "__tests__" ? [] : sourceFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });

const Forbidden = [
  /from "react/,
  /from "next\//,
  /\bwindow\b/,
  /localStorage/,
  /console\./,
  /\bfetch\(/,
  /Date\.now\(/,
  /new Date\(\)/,
];

test("engine のソースは React・DOM・I/O・現在時刻に触れない", () => {
  const violations = sourceFiles(engineRoot).flatMap((file) => {
    const text = readFileSync(file, "utf8");
    // Ignore Firestore's literal type/filter and property name, while rejecting the DOM global.
    const code = text.replace(
      /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g,
      "",
    );
    const domReferences = /(?<![\w.])document\b(?!\s*:)/.test(code)
      ? [`${file.replace(engineRoot, "engine")}: global document reference`]
      : [];
    return [
      ...domReferences,
      ...Forbidden.filter((pattern) => pattern.test(text)).map(
        (pattern) => `${file.replace(engineRoot, "engine")}: ${pattern}`,
      ),
    ];
  });
  expect(violations).toEqual([]);
});
