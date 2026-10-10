import { Flag, ParsedArgs } from "@/engine/cli/command-spec";
import type { TfCompileOptions } from "@/engine/domains/terraform/compiler";
import { TfExpressions as E, type TfValue } from "@/engine/domains/terraform/expressions";
import { Hcl } from "@/engine/domains/terraform/hcl";
import { TfStructure } from "@/engine/domains/terraform/structure";
import type { World } from "@/engine/domains/world";
export const TerraformVariableFlags = [
  {
    ...Flag.literals("var", "Override a root input variable: NAME=VALUE (repeatable)."),
    aliases: ["-var"],
  },
  {
    ...Flag.literals("var-file", "Read a virtual tfvars file (repeatable, in order)."),
    aliases: ["-var-file"],
  },
];
export const terraformOptions = (world: World, args: ParsedArgs): TfCompileOptions => {
  const variables: Record<string, TfValue> = {};
  const definitions = Object.entries(world.terraform.files)
    .filter(([name]) => name.endsWith(".tf") && !name.includes("/"))
    .flatMap(([, text]) => Hcl.parse(text).blocks.filter((b) => b.type === "variable"));
  for (const raw of ParsedArgs.list(args, "var")) {
    const split = raw.indexOf("=");
    const key = raw.slice(0, split);
    if (split < 1 || !TfStructure.identifier(key)) {
      throw new Error("-var requires NAME=VALUE.");
    }
    const value = raw.slice(split + 1);
    const type = definitions.find((b) => b.labels[0] === key)?.body.attributes.type;
    if (
      typeof type === "object" &&
      "ref" in type &&
      type.ref === "string" &&
      !value.startsWith('"')
    ) {
      variables[key] = value;
      continue;
    }
    variables[key] = E.evaluate(Hcl.expression(value), (ref) => {
      throw new Error(`-var values cannot reference ${ref}.`);
    });
  }
  return {
    variables,
    varFiles: ParsedArgs.list(args, "var-file"),
    providerVersion: world.terraform.providerVersion || undefined,
  };
};
