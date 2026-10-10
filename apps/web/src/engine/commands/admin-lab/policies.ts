import {
  type CommandContext,
  type CommandSpec,
  Flag,
  ParsedArgs,
  Positional,
} from "@/engine/cli/command-spec";
import {
  Constraints,
  type OrgPolicy,
  patchAdmin,
  validateAdminLab,
  validScope,
} from "@/engine/domains/admin-lab/model";
import { effectiveOrgPolicy } from "@/engine/domains/admin-lab/policies";
import type { JsonRecord } from "@/types/Json";
import { Result } from "@/utils/Result";
import {
  finish,
  invalid,
  isRecord,
  missing,
  permitTarget,
  readJson,
  ScopeFlags,
  scopeArgument,
  scoped,
} from "./shared";

const parsedPolicy = (ctx: CommandContext, a: ParsedArgs) =>
  Result.flatMap(readJson(ctx, ParsedArgs.requiredPositional(a, 0)), (value) => {
    if (
      !isRecord(value) ||
      typeof value.name !== "string" ||
      !isRecord(value.spec) ||
      Object.keys(value).some((k) => !["name", "spec"].includes(k))
    ) {
      return invalid("Policy JSON requires name and spec only.");
    }
    const match = /^(projects|folders|organizations)\/([^/]+)\/policies\/([^/]+)$/.exec(value.name);
    const spec = value.spec;
    if (
      !match ||
      !validScope(ctx.world, `${match[1]}/${match[2]}`) ||
      !Constraints.some((c) => c === match[3]) ||
      Object.keys(spec).some((k) => !["reset", "inheritFromParent", "rules"].includes(k))
    ) {
      return invalid("Unsupported policy scope, constraint or spec field.");
    }
    if (
      (spec.reset !== undefined && typeof spec.reset !== "boolean") ||
      (spec.inheritFromParent !== undefined && typeof spec.inheritFromParent !== "boolean")
    ) {
      return invalid("reset/inheritFromParent must be booleans.");
    }
    const rules = spec.rules ?? [];
    if (!Array.isArray(rules) || rules.length > 1 || (spec.reset === true && rules.length > 0)) {
      return invalid("Use one unconditional rule, or reset=true with no rules.");
    }
    const policy: OrgPolicy = {
      scope: `${match[1]}/${match[2]}`,
      constraint: match[3] ?? "",
      reset: spec.reset === true,
      enforce: false,
      inherit: spec.inheritFromParent === true,
      allowed: [],
      denied: [],
    };
    if (policy.reset) {
      return policy.inherit
        ? invalid("reset=true requires inheritFromParent=false.")
        : Result.ok(policy);
    }
    const rule = rules[0];
    if (!isRecord(rule)) {
      return invalid("An unconditional rule is required.");
    }
    if (policy.constraint !== "gcp.resourceLocations") {
      if (Object.keys(rule).length !== 1 || typeof rule.enforce !== "boolean" || policy.inherit) {
        return invalid(
          "Boolean constraints require enforce=true/false; list inheritance is not applicable.",
        );
      }
      return Result.ok({ ...policy, enforce: rule.enforce });
    }
    if (
      Object.keys(rule).length !== 1 ||
      !isRecord(rule.values) ||
      Object.keys(rule.values).some((k) => !["allowedValues", "deniedValues"].includes(k))
    ) {
      return invalid(
        "Location rules accept values.allowedValues/deniedValues only. Conditions and allowAll/denyAll are unsupported.",
      );
    }
    const allowed = rule.values.allowedValues ?? [];
    const denied = rule.values.deniedValues ?? [];
    if (
      !Array.isArray(allowed) ||
      !Array.isArray(denied) ||
      [...allowed, ...denied].length === 0 ||
      ![...allowed, ...denied].every((s) => typeof s === "string" && /^is:[a-z][a-z0-9-]*$/.test(s))
    ) {
      return invalid("Use explicit is:LOCATION values; location groups are outside this lesson.");
    }
    return Result.ok({
      ...policy,
      allowed: [...new Set(allowed)] as string[],
      denied: [...new Set(denied)] as string[],
    });
  });
const record = (p: OrgPolicy): JsonRecord => {
  if (p.reset) {
    return {
      name: `${p.scope}/policies/${p.constraint}`,
      spec: { reset: true, inheritFromParent: false },
    };
  }
  if (p.constraint === "gcp.resourceLocations") {
    return {
      name: `${p.scope}/policies/${p.constraint}`,
      spec: {
        inheritFromParent: p.inherit,
        rules: [{ values: { allowedValues: [...p.allowed], deniedValues: [...p.denied] } }],
      },
    };
  }
  return { name: `${p.scope}/policies/${p.constraint}`, spec: { rules: [{ enforce: p.enforce }] } };
};
const constraint = (a: ParsedArgs) =>
  ParsedArgs.requiredPositional(a, 0).replace(/^constraints\//, "");
const positional = [
  Positional.required("CONSTRAINT", "Supported organization constraint.", () => Constraints),
];
export const OrgPolicyCommands: readonly CommandSpec[] = [
  scoped({
    path: ["gcloud", "org-policies", "set-policy"],
    permission: [],
    api: "orgpolicy.googleapis.com",
    scope: (ctx, a) => Result.map(parsedPolicy(ctx, a), (p) => p.scope),
    positionals: [
      Positional.required("POLICY_FILE", "Virtual JSON policy file.", (w) =>
        Object.keys(w.kubeFiles).filter((p) => p.endsWith(".json")),
      ),
    ],
    run: (ctx, a) =>
      Result.flatMap(parsedPolicy(ctx, a), (p) => {
        const existing = ctx.world.adminLab.policies.some(
          (old) => old.scope === p.scope && old.constraint === p.constraint,
        );
        const permitted = permitTarget(
          ctx,
          existing ? "orgpolicy.policies.update" : "orgpolicy.policies.create",
        );
        if (!permitted.ok) {
          return permitted;
        }
        const world = patchAdmin(ctx.world, {
          policies: [
            ...ctx.world.adminLab.policies.filter(
              (old) => !(old.scope === p.scope && old.constraint === p.constraint),
            ),
            p,
          ],
        });
        const validation = validateAdminLab(world);
        if (!validation.ok) {
          return invalid(validation.error);
        }
        return finish(world, record(p));
      }),
  }),
  ...["describe", "reset", "delete"].map((op) =>
    scoped({
      path: ["gcloud", "org-policies", op],
      permission:
        op === "describe"
          ? "orgpolicy.policy.get"
          : `orgpolicy.policies.${op === "delete" ? "delete" : "update"}`,
      api: "orgpolicy.googleapis.com",
      scope: (ctx, a) => scopeArgument(ctx, a),
      positionals: positional,
      flags: [
        ...ScopeFlags,
        ...(op === "describe" ? [Flag.boolean("effective", "Resolve inherited policy.")] : []),
      ],
      destructive: op === "delete",
      run: (ctx, a, scope) => {
        const name = constraint(a);
        if (!Constraints.some((c) => c === name)) {
          return invalid("Unsupported organization constraint.");
        }
        const policies = ctx.world.adminLab.policies;
        const direct = policies.find((p) => p.scope === scope && p.constraint === name);
        if (op === "describe") {
          if (ParsedArgs.boolean(a, "effective")) {
            return finish(ctx.world, record(effectiveOrgPolicy(ctx.world, scope, name)));
          }
          return direct
            ? finish(ctx.world, record(direct))
            : missing("Direct policy not found; use --effective for inheritance/default.");
        }
        if (op === "delete") {
          if (!direct) {
            return missing("Direct policy not found.");
          }
          return finish(patchAdmin(ctx.world, { policies: policies.filter((p) => p !== direct) }), {
            scope,
            constraint: name,
            result: "Direct policy deleted; parent inheritance resumes.",
          });
        }
        const reset: OrgPolicy = {
          scope,
          constraint: name,
          reset: true,
          enforce: false,
          inherit: false,
          allowed: [],
          denied: [],
        };
        return finish(
          patchAdmin(ctx.world, { policies: [...policies.filter((p) => p !== direct), reset] }),
          record(reset),
        );
      },
    }),
  ),
];
