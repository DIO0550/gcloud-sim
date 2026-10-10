import { type CommandSpec, Flag, ParsedArgs, Positional } from "@/engine/cli/command-spec";
import {
  observeAdmin,
  patchAdmin,
  type QuotaPreference,
  validateAdminLab,
} from "@/engine/domains/admin-lab/model";
import { QuotaRegions, quotaUsage } from "@/engine/domains/admin-lab/quotas";
import { Option } from "@/utils/Option";
import {
  finish,
  invalid,
  missing,
  records,
  ScopeFlags,
  scopeArgument,
  scoped,
  sf,
  text,
} from "./shared";

const service = "compute.googleapis.com";
const quotaId = "CpusPerProjectPerRegion";
const record = (q: QuotaPreference) => ({
  name: `${q.scope}/locations/global/quotaPreferences/${q.name}`,
  service: q.service,
  quotaId: q.quotaId,
  dimensions: { region: q.region },
  quotaConfig: { preferredValue: String(q.preferred), grantedValue: String(q.granted) },
  reconciling: q.reconciling,
  contactEmail: q.email,
});
export const QuotaCommands: readonly CommandSpec[] = [
  scoped({
    path: ["gcloud", "quotas", "info", "list"],
    api: "cloudquotas.googleapis.com",
    permission: "cloudquotas.quotas.get",
    scope: (ctx, a) => scopeArgument(ctx, a, true),
    flags: [...ScopeFlags, sf("service", true)],
    run: (ctx, a, scope) => {
      if (text(a, "service") !== service) {
        return invalid("Only the Compute regional CPU teaching profile is modeled.");
      }
      return records(
        ctx.world,
        QuotaRegions.map((region) => ({
          name: `${scope}/locations/global/services/${service}/quotaInfos/${quotaId}`,
          service,
          quotaId,
          dimensionsInfos: [
            {
              dimensions: { region },
              details: {
                value: String(
                  ctx.world.adminLab.quotas.find((q) => q.scope === scope && q.region === region)
                    ?.granted ?? 24,
                ),
              },
            },
          ],
          teachingUsage: quotaUsage(ctx.world, scope, region),
          model: "24 is a fixed lesson allowance, not your Google Cloud quota.",
        })),
      );
    },
  }),
  ...["create", "update"].map((op) =>
    scoped({
      path: ["gcloud", "quotas", "preferences", op],
      api: "cloudquotas.googleapis.com",
      permission: "cloudquotas.quotas.update",
      scope: (ctx, a) => scopeArgument(ctx, a, true),
      flags: [
        ...ScopeFlags,
        sf("service", true),
        sf("quota-id", true),
        Flag.integer("preferred-value", "Requested value; -1 means request unlimited.", {
          required: true,
        }),
        Flag.keyvalue("dimensions", "region=REGION.", { required: true }),
        sf("email", true),
        ...(op === "create" ? [sf("preference-id", true)] : []),
      ],
      positionals:
        op === "update"
          ? [
              Positional.required("PREFERENCE_ID", "Existing preference ID.", (w) =>
                w.adminLab.quotas.map((q) => q.name),
              ),
            ]
          : [],
      run: (ctx, a, scope) => {
        const name =
          op === "create" ? text(a, "preference-id") : ParsedArgs.requiredPositional(a, 0);
        const dimensions = ParsedArgs.keyvalue(a, "dimensions");
        if (Object.keys(dimensions).some((k) => k !== "region")) {
          return invalid("Only the immutable region dimension is modeled.");
        }
        const existing = ctx.world.adminLab.quotas.find(
          (q) => q.scope === scope && q.name === name,
        );
        if (
          op === "create" &&
          (existing ||
            ctx.world.adminLab.quotas.some(
              (q) => q.scope === scope && q.region === dimensions.region,
            ))
        ) {
          return invalid("A preference already exists for this region.");
        }
        if (op === "update" && !existing) {
          return missing("Preference not found in this scope.");
        }
        if (
          existing &&
          (existing.region !== dimensions.region ||
            existing.service !== text(a, "service") ||
            existing.quotaId !== text(a, "quota-id"))
        ) {
          return invalid("Service, quotaId and dimensions are immutable in this lesson.");
        }
        const preferred = Option.unwrapOr(ParsedArgs.integer(a, "preferred-value"), Number.NaN);
        const granted = existing?.granted ?? 24;
        const quota: QuotaPreference = {
          scope,
          name,
          service: text(a, "service"),
          quotaId: text(a, "quota-id"),
          region: dimensions.region ?? "",
          preferred,
          granted,
          reconciling: preferred !== granted,
          email: text(a, "email"),
        };
        const world = patchAdmin(ctx.world, {
          quotas: [...ctx.world.adminLab.quotas.filter((q) => q !== existing), quota],
        });
        const validation = validateAdminLab(world);
        return validation.ok ? finish(world, record(quota)) : invalid(validation.error);
      },
    }),
  ),
  scoped({
    path: ["sim", "quotas", "resolve"],
    api: "cloudquotas.googleapis.com",
    permission: "cloudquotas.quotas.update",
    scope: (ctx, a) => scopeArgument(ctx, a, true),
    flags: [
      ...ScopeFlags,
      Flag.integer("granted-value", "Explicit simulated service decision; 0..100000.", {
        required: true,
      }),
    ],
    positionals: [
      Positional.required("PREFERENCE_ID", "Existing preference ID.", (w) =>
        w.adminLab.quotas.map((q) => q.name),
      ),
    ],
    run: (ctx, a, scope) => {
      const existing = ctx.world.adminLab.quotas.find(
        (q) => q.scope === scope && q.name === ParsedArgs.requiredPositional(a, 0),
      );
      if (!existing) {
        return missing("Preference not found.");
      }
      const granted = Option.unwrapOr(ParsedArgs.integer(a, "granted-value"), Number.NaN);
      if (
        granted < 0 ||
        granted > 100000 ||
        (existing.preferred !== -1 && granted > existing.preferred) ||
        granted < quotaUsage(ctx.world, scope, existing.region)
      ) {
        return invalid(
          "Grant must respect the requested value and existing usage within the teaching limit.",
        );
      }
      const quota = { ...existing, granted, reconciling: false };
      return finish(
        patchAdmin(ctx.world, {
          quotas: ctx.world.adminLab.quotas.map((q) => (q === existing ? quota : q)),
        }),
        {
          ...record(quota),
          model:
            "Explicit teaching decision; real approval is performed by Google, not by this CLI command.",
        },
      );
    },
  }),
  scoped({
    path: ["sim", "quotas", "evaluate"],
    api: "cloudquotas.googleapis.com",
    permission: "cloudquotas.quotas.get",
    scope: (ctx, a) => scopeArgument(ctx, a, true),
    flags: [
      ...ScopeFlags,
      sf("region", true),
      Flag.integer("additional-cpus", "Nonnegative proposed CPU demand.", { required: true }),
    ],
    run: (ctx, a, scope) => {
      const region = text(a, "region");
      const additional = Option.unwrapOr(ParsedArgs.integer(a, "additional-cpus"), Number.NaN);
      if (!QuotaRegions.some((r) => r === region) || additional < 0 || additional > 100000) {
        return invalid("Choose a supported region and 0..100000 additional CPUs.");
      }
      const usage = quotaUsage(ctx.world, scope, region);
      const quota = ctx.world.adminLab.quotas.find((q) => q.scope === scope && q.region === region);
      const granted = quota?.granted ?? 24;
      const allowed = usage + additional <= granted;
      const projectId = ctx.projectId.some ? ctx.projectId.value : "";
      const world = observeAdmin(ctx.world, {
        projectId,
        kind: "quota",
        resource: `${scope}/${region}`,
        result: allowed ? "allowed" : "denied",
        value: additional,
      });
      return finish(world, {
        usage,
        additional,
        granted,
        allowed,
        reconciling: quota?.reconciling ?? false,
      });
    },
  }),
];
