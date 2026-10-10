import { CommandFailure } from "@/engine/cli/command-failure";
import { ParsedArgs } from "@/engine/cli/command-spec";
import { EffectivePermissions } from "@/engine/domains/effective-permissions";
import { Principal } from "@/engine/domains/principal";
import type { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

export const authorizeImpersonation = (
  world: World,
  caller: Principal,
  email: string,
): Result<Principal, CommandFailure> => {
  const account = world.serviceAccounts.find((s) => s.email === email);
  if (!account) {
    return Result.err(CommandFailure.notFoundWith("Impersonated service account does not exist."));
  }
  if (
    !world.projects.some((p) => p.projectId === account.projectId && p.lifecycleState === "ACTIVE")
  ) {
    return Result.err(
      CommandFailure.invalidState("Impersonated service account belongs to an inactive project."),
    );
  }
  if (
    !world.projects.some(
      (p) =>
        p.projectId === account.projectId &&
        p.enabledApis.includes("iamcredentials.googleapis.com"),
    )
  ) {
    return Result.err(
      CommandFailure.apiDisabled(
        "IAM Credentials API",
        "iamcredentials.googleapis.com",
        account.projectId,
      ),
    );
  }
  const effective = EffectivePermissions.resolve(world, Principal.toMember(caller), {
    type: "service-account",
    id: email,
  });
  if (!effective.permissions.has("iam.serviceAccounts.getAccessToken")) {
    return Result.err(
      CommandFailure.permissionDenied({
        permission: "iam.serviceAccounts.getAccessToken",
        target: { type: "service-account", id: email },
        rolesIncluding: ["roles/iam.serviceAccountTokenCreator", "roles/iam.workloadIdentityUser"],
      }),
    );
  }
  return Result.mapErr(Principal.parse(email), CommandFailure.invalidArgumentWith);
};
export const callerPrincipal = (world: World, a: ParsedArgs): Result<Principal, CommandFailure> => {
  const account = ParsedArgs.string(a, "account");
  if (account.some) {
    return Result.mapErr(Principal.parse(account.value), CommandFailure.invalidArgumentWith);
  }
  const current = world.config.configurations[world.config.activeConfiguration];
  const email = current?.["core/account"];
  if (!email) {
    return Result.err(CommandFailure.noActiveAccount());
  }
  return Result.mapErr(Principal.parse(email), CommandFailure.invalidArgumentWith);
};
export const requestedImpersonation = (
  world: World,
  a: ParsedArgs,
  caller: Principal,
): Result<Principal, CommandFailure> => {
  const target = ParsedArgs.string(a, "impersonate-service-account");
  if (!Option.isSome(target)) {
    return Result.ok(caller);
  }
  if (target.value.includes(",")) {
    return Result.err(
      CommandFailure.unsupportedOperation("Delegation chains are not supported by this lesson."),
    );
  }
  return authorizeImpersonation(world, caller, target.value);
};
