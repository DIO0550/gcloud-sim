import {
  type CommandContext,
  type CommandSpec,
  Flag,
  ParsedArgs,
  Positional,
} from "@/engine/cli/command-spec";
import { projectCommand } from "@/engine/commands/shared";
import { storageNow } from "@/engine/commands/storage-lab/runtime";
import { credentialAvailable, poolPath, providerPath } from "@/engine/domains/admin-lab/federation";
import {
  type IdentityPool,
  type IdentityProvider,
  observeAdmin,
  patchAdmin,
  type ShortCredential,
  validateAdminLab,
} from "@/engine/domains/admin-lab/model";
import { allows } from "@/engine/domains/serverless-lab/runtime";
import { GsUrl } from "@/engine/domains/storage";
import { keyAccess, storageAllows } from "@/engine/domains/storage-lab/model";
import { World } from "@/engine/domains/world";
import { Result } from "@/utils/Result";
import { finish, invalid, missing, records, scopeArgument, scoped, sf, text } from "./shared";

const kinds = ["workload", "workforce"] as const;
const permissionVerb = (op: string) => {
  if (op === "create-oidc") {
    return "create";
  }
  if (op === "describe") {
    return "get";
  }
  return op;
};
const scopeFor = (
  kind: IdentityPool["kind"],
  ctx: CommandContext,
  a: ParsedArgs,
  requireOrganization = true,
) => {
  if (text(a, "location") !== "global") {
    return invalid("Identity federation uses --location=global.");
  }
  if (kind === "workload") {
    if (!ctx.projectId.some) {
      return invalid("Choose a project for the workload pool.");
    }
    return Result.ok(`projects/${ctx.projectId.value}`);
  }
  if (!requireOrganization) {
    return Result.ok(`organizations/${ctx.world.organization.id}`);
  }
  return scopeArgument(ctx, a);
};
const poolOwner = (scope: string) => scope.split("/")[1] ?? "";
export const FederationCommands: readonly CommandSpec[] = [
  ...kinds.flatMap((kind) =>
    ["create", "list", "describe", "delete"].map((op) =>
      scoped({
        path: ["gcloud", "iam", `${kind}-identity-pools`, op].map((s) =>
          s === "workforce-identity-pools" ? "workforce-pools" : s,
        ),
        api: "iam.googleapis.com",
        permission: `iam.${kind === "workload" ? "workloadIdentityPools" : "workforcePools"}.${op === "describe" ? "get" : op}`,
        scope: (ctx, a) => scopeFor(kind, ctx, a, op === "create" || op === "list"),
        flags: [
          sf("location", true),
          ...(kind === "workforce" && (op === "create" || op === "list")
            ? [sf("organization", true)]
            : []),
        ],
        positionals:
          op === "list"
            ? []
            : [
                Positional.required("POOL", "Federation pool ID.", (w) =>
                  w.adminLab.pools.filter((p) => p.kind === kind).map((p) => p.name),
                ),
              ],
        destructive: op === "delete",
        run: (ctx, a, scope) => {
          if (kind === "workforce" && !scope.startsWith("organizations/")) {
            return invalid("Workforce pools belong to the organization.");
          }
          const owner = poolOwner(scope);
          const pools = ctx.world.adminLab.pools;
          const local = pools.filter((p) => p.kind === kind && p.owner === owner);
          const name = op === "list" ? "" : ParsedArgs.requiredPositional(a, 0);
          const existing = local.find((p) => p.name === name);
          const record = (p: IdentityPool) => ({
            name: poolPath(ctx.world, p),
            state: p.disabled ? "DISABLED" : "ACTIVE",
          });
          if (op === "list") {
            return records(ctx.world, local.map(record));
          }
          if (op === "describe") {
            return existing
              ? finish(ctx.world, record(existing))
              : missing("Pool not found in this scope.");
          }
          if (op === "delete") {
            if (!existing) {
              return missing("Pool not found in this scope.");
            }
            if (
              ctx.world.adminLab.providers.some(
                (p) => p.kind === kind && p.owner === owner && p.pool === name,
              )
            ) {
              return invalid("Delete providers before deleting the pool.");
            }
            return finish(patchAdmin(ctx.world, { pools: pools.filter((p) => p !== existing) }), {
              deleted: poolPath(ctx.world, existing),
            });
          }
          if (
            existing ||
            (kind === "workforce" && pools.some((p) => p.kind === kind && p.name === name))
          ) {
            return invalid("Pool ID already exists.");
          }
          const pool: IdentityPool = { kind, owner, name, disabled: false };
          const world = patchAdmin(ctx.world, { pools: [...pools, pool] });
          const validation = validateAdminLab(world);
          return validation.ok ? finish(world, record(pool)) : invalid(validation.error);
        },
      }),
    ),
  ),
  ...kinds.flatMap((kind) =>
    ["create-oidc", "list", "describe", "delete"].map((op) =>
      scoped({
        path: [
          "gcloud",
          "iam",
          kind === "workload" ? "workload-identity-pools" : "workforce-pools",
          "providers",
          op,
        ],
        api: "iam.googleapis.com",
        permission: `iam.${kind === "workload" ? "workloadIdentityPoolProviders" : "workforcePoolProviders"}.${permissionVerb(op)}`,
        scope: (ctx, a) => scopeFor(kind, ctx, a, false),
        flags: [
          sf("location", true),
          sf(kind === "workload" ? "workload-identity-pool" : "workforce-pool", true),

          ...(op === "create-oidc"
            ? [
                sf("issuer-uri", true),
                sf("attribute-mapping", true),
                ...(kind === "workload"
                  ? [Flag.list("allowed-audiences", "OIDC allowed audiences.")]
                  : []),
                ...(kind === "workforce"
                  ? [
                      sf("client-id", true),
                      sf("web-sso-response-type", true),
                      sf("web-sso-assertion-claims-behavior", true),
                    ]
                  : []),
              ]
            : []),
        ],
        positionals:
          op === "list"
            ? []
            : [
                Positional.required("PROVIDER", "OIDC provider ID.", (w) =>
                  w.adminLab.providers.filter((p) => p.kind === kind).map((p) => p.name),
                ),
              ],
        destructive: op === "delete",
        run: (ctx, a, scope) => {
          const owner = poolOwner(scope);
          const pool = text(a, kind === "workload" ? "workload-identity-pool" : "workforce-pool");
          if (
            !ctx.world.adminLab.pools.some(
              (p) => p.kind === kind && p.owner === owner && p.name === pool && !p.disabled,
            )
          ) {
            return missing("Active pool not found in this scope.");
          }
          const providers = ctx.world.adminLab.providers;
          const local = providers.filter(
            (p) => p.kind === kind && p.owner === owner && p.pool === pool,
          );
          const name = op === "list" ? "" : ParsedArgs.requiredPositional(a, 0);
          const existing = local.find((p) => p.name === name);
          const record = (p: IdentityProvider) => ({
            name: providerPath(ctx.world, p),
            state: p.disabled ? "DISABLED" : "ACTIVE",
            oidc:
              p.kind === "workforce"
                ? { issuerUri: p.issuer, clientId: p.clientId }
                : { issuerUri: p.issuer, allowedAudiences: [...p.audiences] },
            attributeMapping: { "google.subject": "assertion.sub" },
          });
          if (op === "list") {
            return records(ctx.world, local.map(record));
          }
          if (op === "describe") {
            return existing
              ? finish(ctx.world, record(existing))
              : missing("Provider not found in this pool.");
          }
          if (op === "delete") {
            if (!existing) {
              return missing("Provider not found in this pool.");
            }
            return finish(
              patchAdmin(ctx.world, { providers: providers.filter((p) => p !== existing) }),
              { deleted: providerPath(ctx.world, existing) },
            );
          }
          if (existing) {
            return invalid("Provider ID already exists.");
          }
          if (text(a, "attribute-mapping") !== "google.subject=assertion.sub") {
            return invalid(
              "Only google.subject=assertion.sub is modeled; groups, attributes and CEL expressions are unsupported.",
            );
          }
          if (
            kind === "workforce" &&
            (text(a, "web-sso-response-type") !== "id-token" ||
              text(a, "web-sso-assertion-claims-behavior") !== "only-id-token-claims")
          ) {
            return invalid(
              "Only the id-token Workforce Web SSO profile is modeled; secrets/code flows are unsupported.",
            );
          }
          const provider: IdentityProvider = {
            kind,
            owner,
            pool,
            name,
            issuer: text(a, "issuer-uri"),
            audiences: ParsedArgs.list(a, "allowed-audiences"),
            clientId: text(a, "client-id"),
            disabled: false,
          };
          const world = patchAdmin(ctx.world, { providers: [...providers, provider] });
          const validation = validateAdminLab(world);
          return validation.ok ? finish(world, record(provider)) : invalid(validation.error);
        },
      }),
    ),
  ),
  projectCommand({
    path: ["sim", "identity", "federation", "exchange"],
    summary:
      "Validate teaching OIDC claims and issue metadata only; no JWT verification or network.",
    permission: "iam.serviceAccounts.get",
    requiredApis: ["iam.googleapis.com"],
    flags: [
      sf("project"),
      sf("account"),
      Flag.enum("kind", "Federation kind.", kinds, { required: true }),
      sf("pool", true),
      sf("provider", true),
      sf("issuer", true),
      sf("audience", true),
      sf("subject", true),
      sf("service-account"),
    ],
    run: (ctx, a) => {
      const kind = text(a, "kind") as IdentityPool["kind"];
      const owner = kind === "workload" ? ctx.project.projectId : ctx.world.organization.id;
      const provider = ctx.world.adminLab.providers.find(
        (p) =>
          p.kind === kind &&
          p.owner === owner &&
          p.pool === text(a, "pool") &&
          p.name === text(a, "provider") &&
          !p.disabled,
      );
      const pool = ctx.world.adminLab.pools.find(
        (p) => p.kind === kind && p.owner === owner && p.name === text(a, "pool") && !p.disabled,
      );
      if (!provider || !pool) {
        return missing("Active provider/pool not found.");
      }
      const canonical = `//iam.googleapis.com/${providerPath(ctx.world, provider)}`;
      const audience = text(a, "audience");
      const audienceAllowed = (): boolean => {
        if (kind === "workforce") {
          return audience === provider.clientId;
        }
        if (provider.audiences.length > 0) {
          return provider.audiences.includes(audience);
        }
        return audience === canonical || audience === `https:${canonical}`;
      };
      const accepted = audienceAllowed();
      const subject = text(a, "subject");
      if (
        text(a, "issuer") !== provider.issuer ||
        !accepted ||
        new TextEncoder().encode(subject).length > 127 ||
        !/^[a-zA-Z0-9._@-]+$/.test(subject)
      ) {
        return invalid("OIDC issuer/audience/subject does not match the configured profile.");
      }
      let principal = `principal://iam.googleapis.com/${poolPath(ctx.world, pool)}/subject/${subject}`;
      const account = text(a, "service-account");
      if (account) {
        const sa = ctx.world.serviceAccounts.find(
          (s) => s.email === account && s.projectId === ctx.project.projectId,
        );
        if (!sa) {
          return missing("Target service account not found in this project.");
        }
        if (
          !World.hasApi(ctx.world, sa.projectId, "iamcredentials.googleapis.com") ||
          !allows(
            ctx.world,
            sa.projectId,
            principal,
            "iam.serviceAccounts.getAccessToken",
            sa.iamPolicy,
          )
        ) {
          return invalid(
            "Keyless SA access requires IAM Credentials API and getAccessToken on the target SA for this federation principal.",
          );
        }
        principal = account;
      }
      const numbered = World.nextNumber(ctx.world);
      const created = storageNow(ctx);
      const credential: ShortCredential = {
        id: `SIMULATED-credential-${numbered.number}`,
        projectId: ctx.project.projectId,
        subject: principal,
        caller: providerPath(ctx.world, provider),
        method: kind,
        created,
        expires: new Date(Date.parse(created) + 3600000).toISOString(),
      };
      return finish(
        patchAdmin(numbered.world, {
          credentials: [...numbered.world.adminLab.credentials, credential],
        }),
        {
          token: credential.id,
          principal,
          expireTime: credential.expires,
          keyCreated: false,
          model: "Claims are teaching inputs, never verified credentials.",
        },
      );
    },
  }),
  projectCommand({
    path: ["sim", "identity", "federation", "access"],
    summary: "Check current Cloud Storage read IAM using unexpired simulated federation metadata.",
    permission: "storage.buckets.get",
    requiredApis: ["storage.googleapis.com"],
    positionals: [Positional.required("URL", "Existing gs://BUCKET/OBJECT.")],
    flags: [sf("project"), sf("account"), sf("token", true)],
    run: (ctx, a) => {
      const credential = ctx.world.adminLab.credentials.find(
        (c) =>
          c.projectId === ctx.project.projectId &&
          c.id === text(a, "token") &&
          c.method !== "impersonation",
      );
      if (!credential) {
        return missing("Federation metadata not found.");
      }
      if (
        Date.parse(storageNow(ctx)) >= Date.parse(credential.expires) ||
        !credentialAvailable(ctx.world, credential)
      ) {
        return invalid("Federation metadata expired or its provider is unavailable.");
      }
      const uri = GsUrl.parse(ParsedArgs.requiredPositional(a, 0));
      if (!uri.ok) {
        return invalid(uri.error);
      }
      const bucket = ctx.world.buckets.find((b) => b.name === uri.value.bucket);
      const object = bucket?.objects.find((o) => o.name === uri.value.object);
      if (!bucket || !object) {
        return missing("Object not found.");
      }
      if (
        !World.hasApi(ctx.world, bucket.projectId, "storage.googleapis.com") ||
        !storageAllows(ctx.world, bucket, credential.subject, "storage.objects.get") ||
        !keyAccess(ctx.world, bucket, object.kmsKey ?? "", "Decrypt").ok
      ) {
        return invalid("Federated principal lacks current object IAM/API/CMEK access.");
      }
      return finish(
        observeAdmin(ctx.world, {
          projectId: ctx.project.projectId,
          kind: "federation",
          resource: ParsedArgs.requiredPositional(a, 0),
          result: credential.method,
          value: 1,
        }),
        {
          allowed: true,
          principal: credential.subject,
          resource: ParsedArgs.requiredPositional(a, 0),
          keyCreated: false,
        },
      );
    },
  }),
];
