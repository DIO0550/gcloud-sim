import { type CommandSpec, Flag, ParsedArgs, Positional } from "@/engine/cli/command-spec";
import { plainCommand, projectCommand } from "@/engine/commands/shared";
import { storageNow } from "@/engine/commands/storage-lab/runtime";
import { authorizeImpersonation, callerPrincipal } from "@/engine/domains/admin-lab/credentials";
import { credentialAvailable } from "@/engine/domains/admin-lab/federation";
import { observeAdmin, patchAdmin, type ShortCredential } from "@/engine/domains/admin-lab/model";
import { World } from "@/engine/domains/world";
import { Result } from "@/utils/Result";
import { finish, invalid, missing, sf, text } from "./shared";

export const CredentialCommands: readonly CommandSpec[] = [
  plainCommand({
    path: ["gcloud", "auth", "print-access-token"],
    summary: "Issue simulated one-hour-or-shorter SA credential metadata; no real bearer token.",
    flags: [sf("impersonate-service-account", true), sf("lifetime")],
    run: (ctx, a) =>
      Result.flatMap(callerPrincipal(ctx.world, a), (caller) =>
        Result.flatMap(
          authorizeImpersonation(ctx.world, caller, text(a, "impersonate-service-account")),
          (subject) => {
            const raw = text(a, "lifetime", "3600s");
            const seconds = /^(\d+)s$/.test(raw) ? Number(raw.slice(0, -1)) : Number.NaN;
            if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) {
              return invalid(
                "Supported lifetime is 1s..3600s. Lifetime-extension org policies are outside this lesson.",
              );
            }
            const account = ctx.world.serviceAccounts.find((s) => s.email === subject);
            if (!account) {
              return missing("Service account not found.");
            }
            const numbered = World.nextNumber(ctx.world);
            const created = storageNow(ctx);
            const credential: ShortCredential = {
              id: `SIMULATED-credential-${numbered.number}`,
              projectId: account.projectId,
              subject,
              caller,
              method: "impersonation",
              created,
              expires: new Date(Date.parse(created) + seconds * 1000).toISOString(),
            };
            return finish(
              patchAdmin(numbered.world, {
                credentials: [...numbered.world.adminLab.credentials, credential],
              }),
              {
                accessToken: credential.id,
                expireTime: credential.expires,
                subject,
                model: "Metadata only; cannot authenticate real API requests.",
              },
            );
          },
        ),
      ),
  }),
  projectCommand({
    path: ["sim", "auth", "credentials", "check"],
    summary: "Check credential expiry and current subject availability.",
    permission: "iam.serviceAccounts.get",
    requiredApis: ["iamcredentials.googleapis.com"],
    flags: [sf("project"), sf("account")],
    positionals: [
      Positional.required("TOKEN", "SIMULATED credential metadata ID.", (w, p) =>
        w.adminLab.credentials.filter((c) => p.some && c.projectId === p.value).map((c) => c.id),
      ),
    ],
    run: (ctx, a) => {
      const credential = ctx.world.adminLab.credentials.find(
        (c) =>
          c.id === ParsedArgs.requiredPositional(a, 0) && c.projectId === ctx.project.projectId,
      );
      if (!credential) {
        return missing("Credential metadata not found in this project.");
      }
      const expired = Date.parse(storageNow(ctx)) >= Date.parse(credential.expires);
      const exists = credentialAvailable(ctx.world, credential);
      const result = expired ? "expired" : "available";
      const allowed = !expired && exists;
      const world = observeAdmin(ctx.world, {
        projectId: ctx.project.projectId,
        kind: "credential",
        resource: credential.id,
        result: exists ? result : "subject-unavailable",
        value: allowed ? 1 : 0,
      });
      return finish(world, {
        id: credential.id,
        allowed,
        reason: exists ? result : "subject-unavailable",
        expireTime: credential.expires,
      });
    },
  }),
  projectCommand({
    path: ["sim", "iam", "runtime", "check"],
    summary: "Distinguish actAs from access-token issuance on an existing runtime SA.",
    permission: "iam.serviceAccounts.get",
    requiredApis: ["iam.googleapis.com"],
    flags: [
      sf("project"),
      sf("account"),
      sf("service-account", true),
      Flag.enum("operation", "Requested SA operation.", ["attach", "token"], { required: true }),
    ],
    run: (ctx, a) => {
      const email = text(a, "service-account");
      const account = ctx.world.serviceAccounts.find(
        (s) => s.email === email && s.projectId === ctx.project.projectId,
      );
      if (!account) {
        return missing("Runtime SA not found in this project.");
      }
      const operation = text(a, "operation");
      const permission =
        operation === "attach" ? "iam.serviceAccounts.actAs" : "iam.serviceAccounts.getAccessToken";
      const effective = importPermission(ctx.world, ctx.principal, email, permission);
      const world = observeAdmin(ctx.world, {
        projectId: ctx.project.projectId,
        kind: "runtime",
        resource: `${email}/${operation}/${ctx.principal}`,
        result: effective ? "allowed" : "denied",
        value: effective ? 1 : 0,
      });
      return finish(world, { serviceAccount: email, operation, permission, allowed: effective });
    },
  }),
];

import { EffectivePermissions } from "@/engine/domains/effective-permissions";
import { Principal, type Principal as PrincipalType } from "@/engine/domains/principal";

const importPermission = (world: World, caller: PrincipalType, email: string, permission: string) =>
  EffectivePermissions.resolve(world, Principal.toMember(caller), {
    type: "service-account",
    id: email,
  }).permissions.has(permission);
