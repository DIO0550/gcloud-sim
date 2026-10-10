import type { HclBlock } from "@/engine/domains/terraform/hcl";

const fail = (message: string): never => {
  throw new Error(message);
};
const compare = (a: readonly number[], b: readonly number[]): number => {
  for (let i = 0; i < 3; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
};
export const TfVersions = {
  terraform: "1.9.8",
  google: ["4.84.0", "5.45.0", "6.0.0"] as readonly string[],
  matches(version: string, constraint: string): boolean {
    if (constraint.length > 200) {
      return fail("Version constraint is too long.");
    }
    const actual = version.split(".").map(Number);
    return constraint.split(",").every((part) => {
      const match = /^\s*(~>|>=|<=|!=|>|<|=)?\s*(\d+)\.(\d+)(?:\.(\d+))?\s*$/.exec(part);
      if (!match) {
        return fail(`Unsupported version constraint: ${part}`);
      }
      const expected = [Number(match[2]), Number(match[3]), Number(match[4] ?? 0)];
      const difference = compare(actual, expected);
      switch (match[1] ?? "=") {
        case "=":
          return difference === 0;
        case "!=":
          return difference !== 0;
        case ">":
          return difference > 0;
        case "<":
          return difference < 0;
        case ">=":
          return difference >= 0;
        case "<=":
          return difference <= 0;
        default: {
          const upper =
            match[4] === undefined
              ? [(expected[0] ?? 0) + 1, 0, 0]
              : [expected[0] ?? 0, (expected[1] ?? 0) + 1, 0];
          return difference >= 0 && compare(actual, upper) < 0;
        }
      }
    });
  },
  constraints(blocks: readonly HclBlock[], root: boolean): readonly string[] {
    const constraints: string[] = [];
    for (const block of blocks.filter((b) => b.type === "terraform")) {
      if (block.labels.length) {
        fail("terraform does not accept labels.");
      }
      for (const [key, value] of Object.entries(block.body.attributes)) {
        if (key !== "required_version" || typeof value !== "string") {
          fail(`Unsupported terraform attribute: ${key}`);
        }
        if (!TfVersions.matches(TfVersions.terraform, value as string)) {
          fail(
            `No simulated Terraform version satisfies ${value}. Installed: ${TfVersions.terraform}`,
          );
        }
      }
      for (const child of block.body.blocks) {
        if (child.type === "backend") {
          if (!root) {
            fail("Backend configuration is only allowed in the root module.");
          }
          continue;
        }
        if (
          child.type !== "required_providers" ||
          child.labels.length ||
          child.body.blocks.length
        ) {
          fail(`Unsupported terraform block: ${child.type}`);
        }
        for (const [name, expr] of Object.entries(child.body.attributes)) {
          if (name !== "google" || typeof expr !== "object" || !("object" in expr)) {
            fail("Only hashicorp/google is supported.");
          }
          if (typeof expr !== "object" || !("object" in expr)) {
            continue;
          }
          const attrs = expr.object;
          if (
            attrs.source !== "hashicorp/google" ||
            Object.keys(attrs).some((k) => !["source", "version"].includes(k))
          ) {
            fail("Only source = hashicorp/google with an optional version is supported.");
          }
          if (attrs.version === undefined) {
            continue;
          }
          if (typeof attrs.version !== "string") {
            fail("Provider version must be a literal string.");
          }
          constraints.push(attrs.version as string);
        }
      }
    }
    return constraints;
  },
  select(constraints: readonly string[], locked?: string): string {
    if (locked) {
      if (
        !TfVersions.google.includes(locked) ||
        !constraints.every((c) => TfVersions.matches(locked, c))
      ) {
        fail(
          "Locked Google provider does not satisfy the configuration. Run terraform init -upgrade.",
        );
      }
      return locked;
    }
    const found = [...TfVersions.google]
      .reverse()
      .find((v) => constraints.every((c) => TfVersions.matches(v, c)));
    return found ?? fail("No simulated Google provider version satisfies all module constraints.");
  },
} as const;
