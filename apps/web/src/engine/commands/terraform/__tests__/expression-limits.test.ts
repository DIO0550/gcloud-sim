// @vitest-environment node
import { expect, test } from "vitest";
import { TfConfiguration } from "@/engine/domains/terraform/configuration";

const repeatedLocals = (levels: number, width = 10): string => {
  const declarations = ['value0 = "x"'];
  for (let level = 1; level <= levels; level++) {
    const references = Array.from({ length: width }, () => `local.value${level - 1}`);
    declarations.push(`value${level} = [${references.join(", ")}]`);
  }
  return `locals { ${declarations.join("\n")} }`;
};

const compile = (source: string) => TfConfiguration.compile({ "main.tf": source });

test("small local-reference graphs cannot expand into oversized JSON outputs", () => {
  const source = `${repeatedLocals(5)} output "expanded" { value = local.value5 }`;
  expect(source.length).toBeLessThan(1000);
  expect(() => compile(source)).toThrow(/limit/i);
});

test("contains and equality reject oversized compound operands before serializing them", () => {
  for (const expression of [
    'contains([local.value5], "missing")',
    "local.value5 == local.value5",
    "local.value5 != local.value5",
  ]) {
    expect(() =>
      compile(`${repeatedLocals(5)} output "comparison" { value = ${expression} }`),
    ).toThrow(/limit/i);
  }
});

test("resource materialization rejects compound expansion before converting it into literals", () => {
  const source = `${repeatedLocals(5)}
    provider "google" { project = "ace-dev-01" }
    resource "google_compute_network" "oversized" {
      name = local.value5
      auto_create_subnetworks = false
    }`;
  expect(() => compile(source)).toThrow(/limit/i);
});

test("local references cannot bypass the compound-value depth limit", () => {
  const source = `${repeatedLocals(30, 1)} output "deep" { value = local.value30 }`;
  expect(() => compile(source)).toThrow(/limit/i);
});

test("bounded compound outputs remain deterministic and unused locals stay lazy", () => {
  const source = `${repeatedLocals(5)}
    output "small" { value = { z = ["two", "three"] a = "one" } }`;
  expect(compile(source).outputs.small).toBe('{"a":"one","z":["two","three"]}');
});
test("template concatenation is bounded before joining repeated large local strings", () => {
  const source =
    'locals { big="' +
    "x".repeat(10000) +
    '" } output "huge" { value="' +
    "${local.big}".repeat(20) +
    '" }';
  expect(() => compile(source)).toThrow(/limit/i);
});
