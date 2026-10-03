import { CommandFailure } from "@/engine/cli/command-failure";
import {
  type CommandContext,
  CommandOutput,
  type CommandResult,
  type JsonRecord,
  OutputMessage,
  ParsedArgs,
} from "@/engine/cli/command-spec";
import {
  type ArtifactRepository,
  ContainerLab,
  type RegistryRef,
} from "@/engine/domains/container-lab";
import { EffectivePermissions } from "@/engine/domains/effective-permissions";
import { Principal } from "@/engine/domains/principal";
import type { PolicyTarget } from "@/engine/domains/resource-hierarchy";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
export const fail = (message: string): never => {
  throw new Error(message);
};
export const guarded =
  (fn: (ctx: CommandContext, args: ParsedArgs) => CommandResult) =>
  (ctx: CommandContext, args: ParsedArgs): CommandResult => {
    try {
      return fn(ctx, args);
    } catch (e) {
      return Result.err(
        CommandFailure.invalidState(
          e instanceof Error ? e.message : "Invalid container operation.",
        ),
      );
    }
  };
export const success = (world: World, message: string): CommandResult =>
  Result.ok({ world, output: CommandOutput.messages(OutputMessage.plain(message)) });
export const record = (world: World, item: JsonRecord): CommandResult =>
  Result.ok({ world, output: CommandOutput.yaml(item) });
export const commit = (world: World, lab: ContainerLab): World => {
  const validated = ContainerLab.validate(lab);
  if (!Result.isOk(validated)) return fail(validated.error);
  return { ...world, containerLab: validated.value };
};
export const account = (world: World, args?: ParsedArgs): Principal => {
  const selected = args ? ParsedArgs.string(args, "account") : Option.none;
  const current = Option.isSome(selected)
    ? Principal.parse(selected.value)
    : Option.toResult(
        World.currentPrincipal(world),
        () => "No active account. Run gcloud auth login.",
      );
  if (!Result.isOk(current)) return fail(current.error);
  if (!world.session.accounts.includes(current.value))
    fail("Account is not logged in. Run gcloud auth login.");
  return current.value;
};
export const authorize = (
  world: World,
  principal: Principal,
  projectId: string,
  permission: string,
  target: PolicyTarget = { type: "project", id: projectId },
): void => {
  if (!Option.isSome(World.findActiveProject(world, projectId)))
    fail(`Project not found or inactive: ${projectId}`);
  if (!World.hasApi(world, projectId, "artifactregistry.googleapis.com"))
    fail(`artifactregistry.googleapis.com is disabled in project ${projectId}.`);
  const effective = EffectivePermissions.resolve(world, Principal.toMember(principal), target);
  if (!effective.permissions.has(permission))
    fail(`Permission denied: ${permission} on ${target.id} for ${principal}.`);
};
export const repositoryRef = (
  ctx: CommandContext,
  args: ParsedArgs,
): Readonly<{ id: string; projectId: string; location: string; name: string }> => {
  const raw = ParsedArgs.requiredPositional(args, 0);
  const full = /^projects\/([^/]+)\/locations\/([^/]+)\/repositories\/([^/]+)$/.exec(raw);
  if (raw.includes("/") && !full) return fail("Invalid repository resource name.");
  const projectId =
    full?.[1] ?? (Option.isSome(ctx.projectId) ? ctx.projectId.value : fail("Specify a project."));
  const flagLocation = ParsedArgs.string(args, "location");
  const location =
    full?.[2] ?? (Option.isSome(flagLocation) ? flagLocation.value : fail("Specify --location."));
  if (
    full &&
    ((Option.isSome(ctx.projectFlag) && ctx.projectFlag.value !== projectId) ||
      (Option.isSome(flagLocation) && flagLocation.value !== location))
  )
    fail("Repository resource and project/location flags do not match.");
  ContainerLab.location(location);
  const name = ContainerLab.repositoryName(full?.[3] ?? raw);
  return { id: ContainerLab.repositoryId(projectId, location, name), projectId, location, name };
};
export const requireRepository = (world: World, id: string): ArtifactRepository =>
  world.containerLab.repositories.find((r) => r.id === id) ??
  fail(`Repository not found: ${id}. Create it before pushing.`);
export const dockerRepository = (
  world: World,
  ref: RegistryRef,
  write: boolean,
): ArtifactRepository => {
  if (!world.containerLab.authHosts.includes(ref.host))
    fail(
      `Docker authentication is not configured for ${ref.host}. Run gcloud auth configure-docker ${ref.host}.`,
    );
  const repo = requireRepository(world, ref.repositoryId);
  authorize(
    world,
    account(world),
    repo.projectId,
    `artifactregistry.repositories.${write ? "uploadArtifacts" : "downloadArtifacts"}`,
    { type: "artifact-repository", id: repo.id },
  );
  return repo;
};
export const repositoryRecord = (r: ArtifactRepository): JsonRecord => ({
  name: r.id,
  format: "DOCKER",
  mode: "STANDARD_REPOSITORY",
  description: r.description,
  location: r.location,
  dockerConfig: { immutableTags: r.immutableTags },
  createTime: r.created,
});
