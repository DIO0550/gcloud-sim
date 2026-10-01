import { CommandFailure } from "@/engine/cli/command-failure";
import {
  type AuthorizedContext,
  Column,
  type CommandContext,
  CommandOutput,
  type CommandSpec,
  Flag,
  OutputMessage,
  ParsedArgs,
  Positional,
} from "@/engine/cli/command-spec";
import {
  alreadyExists,
  Candidates,
  iamBindingCommands,
  plainCommand,
  targetCommand,
} from "@/engine/commands/shared";
import { EffectivePermissions } from "@/engine/domains/effective-permissions";
import { GcloudConfig } from "@/engine/domains/gcloud-config";
import { Principal } from "@/engine/domains/principal";
import {
  Folder,
  Organization,
  type ParentRef,
  PolicyTarget,
  Project,
  ProjectStates,
} from "@/engine/domains/resource-hierarchy";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const ProjectColumns = [
  Column.create("PROJECT_ID", "projectId"),
  Column.create("NAME", "name"),
  Column.create("PROJECT_NUMBER", "projectNumber"),
];

const visibleProjects = (ctx: AuthorizedContext) =>
  World.activeProjects(ctx.world).filter((project) => {
    const effective = EffectivePermissions.resolve(ctx.world, Principal.toMember(ctx.principal), {
      type: "project",
      id: project.projectId,
    });
    return EffectivePermissions.allows(effective, "resourcemanager.projects.get");
  });

const projectTarget = (
  _ctx: CommandContext,
  args: ParsedArgs,
): Result<PolicyTarget, CommandFailure> =>
  Result.ok({ type: "project", id: ParsedArgs.requiredPositional(args, 0) });

const requireProjectArg = (ctx: CommandContext, args: ParsedArgs, includeDeleted: boolean) => {
  const id = ParsedArgs.requiredPositional(args, 0);
  const project = includeDeleted
    ? World.findProject(ctx.world, id)
    : World.findActiveProject(ctx.world, id);
  return Option.toResult(project, () => CommandFailure.notFound(`projects/${id}`));
};

const parentFromFlags = (
  ctx: CommandContext,
  args: ParsedArgs,
): Result<ParentRef, CommandFailure> => {
  const organization = ParsedArgs.string(args, "organization");
  const folder = ParsedArgs.string(args, "folder");
  if (Option.isSome(organization) && Option.isSome(folder)) {
    return Result.err(
      CommandFailure.invalidValue(
        "--organization",
        "At most one of --organization | --folder can be specified.",
      ),
    );
  }
  const parent: ParentRef = Option.isSome(folder)
    ? { type: "folder", id: folder.value }
    : { type: "organization", id: Option.unwrapOr(organization, ctx.world.organization.id) };
  return World.hasParent(ctx.world, parent)
    ? Result.ok(parent)
    : Result.err(CommandFailure.notFound(PolicyTarget.toPath(parent)));
};

const ProjectApiBase = "https://cloudresourcemanager.googleapis.com/v1/projects";

export const ProjectCommands: readonly CommandSpec[] = [
  targetCommand({
    path: ["gcloud", "projects", "list"],
    summary: "List projects accessible by the active account.",
    permissions: [],
    resolveTarget: (ctx) => Result.ok({ type: "organization", id: ctx.world.organization.id }),
    run: (ctx) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.table(
          visibleProjects(ctx)
            .toSorted((a, b) => a.projectId.localeCompare(b.projectId))
            .map(Project.toRecord),
          ProjectColumns,
        ),
      }),
  }),
  targetCommand({
    path: ["gcloud", "projects", "describe"],
    summary: "Show metadata for a project.",
    positionals: [
      Positional.required(
        "PROJECT_ID",
        "ID for the project you want to describe.",
        Candidates.projects,
      ),
    ],
    permission: "resourcemanager.projects.get",
    resolveTarget: projectTarget,
    run: (ctx, args) =>
      Result.map(requireProjectArg(ctx, args, true), (project) => ({
        world: ctx.world,
        output: CommandOutput.yaml(Project.toRecord(project)),
      })),
  }),
  targetCommand({
    path: ["gcloud", "projects", "create"],
    summary: "Create a new project.",
    positionals: [Positional.required("PROJECT_ID", "ID for the project you want to create.")],
    flags: [
      Flag.string(
        "name",
        "Name for the project you want to create. If not specified, will use project id as name.",
      ),
      Flag.string("organization", "ID of the organization to use as a parent."),
      Flag.string("folder", "ID of the folder to use as a parent."),
      Flag.boolean("set-as-default", "Set newly created project as core/project property."),
      Flag.keyvalue("labels", "List of label KEY=VALUE pairs to add."),
    ],
    permission: "resourcemanager.projects.create",
    resolveTarget: parentFromFlags,
    run: (ctx, args) => {
      const parent = parentFromFlags(ctx, args);
      if (!Result.isOk(parent)) return parent;
      const numbered = World.nextNumber(ctx.world);
      const projectId = ParsedArgs.requiredPositional(args, 0);
      const created = Result.mapErr(
        Project.create({
          projectId,
          name: Option.unwrapOr(ParsedArgs.string(args, "name"), ""),
          parent: parent.value,
          sequence: numbered.number,
          creator: Principal.toMember(ctx.principal),
          createTime: ctx.now,
        }),
        (message) => CommandFailure.invalidValue("PROJECT_ID", message),
      );
      if (!Result.isOk(created)) return created;
      const labeled = Project.withLabels(created.value, ParsedArgs.keyvalue(args, "labels"));
      const added = Result.mapErr(World.withProject(numbered.world, labeled), alreadyExists);
      if (!Result.isOk(added)) return added;
      const setDefault = ParsedArgs.boolean(args, "set-as-default");
      const world = setDefault
        ? World.withConfig(
            added.value,
            GcloudConfig.set(added.value.config, "core/project", projectId),
          )
        : added.value;
      return Result.ok({
        world,
        output: CommandOutput.messages(
          OutputMessage.plain(`Create in progress for [${ProjectApiBase}/${projectId}].`),
          OutputMessage.plain(`Waiting for [operations/cp.${numbered.number}] to finish...done.`),
          OutputMessage.plain(
            `Enabling service [cloudapis.googleapis.com] on project [${projectId}]...`,
          ),
          OutputMessage.plain(
            `Operation "operations/acat.p2-${numbered.number}" finished successfully.`,
          ),
          ...(setDefault
            ? [OutputMessage.plain(`Updated property [core/project] to [${projectId}].`)]
            : []),
        ),
      });
    },
  }),
  targetCommand({
    path: ["gcloud", "projects", "delete"],
    summary: "Delete a project.",
    positionals: [
      Positional.required(
        "PROJECT_ID",
        "ID for the project you want to delete.",
        Candidates.projects,
      ),
    ],
    destructive: true,
    permission: "resourcemanager.projects.delete",
    resolveTarget: projectTarget,
    run: (ctx, args) =>
      Result.map(requireProjectArg(ctx, args, false), (project) => ({
        world: World.replaceProject(
          ctx.world,
          Project.withState(project, ProjectStates.DeleteRequested),
        ),
        output: CommandOutput.messages(
          OutputMessage.plain(`Deleted [${ProjectApiBase}/${project.projectId}].`),
          OutputMessage.plain(""),
          OutputMessage.plain(
            "You can undo this operation for a limited period by running the command below.",
          ),
          OutputMessage.plain(`    $ gcloud projects undelete ${project.projectId}`),
        ),
      })),
  }),
  targetCommand({
    path: ["gcloud", "projects", "undelete"],
    summary: "Undelete a project.",
    positionals: [Positional.required("PROJECT_ID", "ID for the project you want to undelete.")],
    permission: "resourcemanager.projects.undelete",
    resolveTarget: projectTarget,
    run: (ctx, args) => {
      const project = requireProjectArg(ctx, args, true);
      if (!Result.isOk(project)) return project;
      if (Project.isActive(project.value)) {
        return Result.err(
          CommandFailure.invalidState(
            `Project [${project.value.projectId}] is not in DELETE_REQUESTED state.`,
          ),
        );
      }
      return Result.ok({
        world: World.replaceProject(
          ctx.world,
          Project.withState(project.value, ProjectStates.Active),
        ),
        output: CommandOutput.messages(
          OutputMessage.plain(`Restored [${ProjectApiBase}/${project.value.projectId}].`),
        ),
      });
    },
  }),
  ...iamBindingCommands({
    group: ["gcloud", "projects"],
    positional: Positional.required("PROJECT_ID", "ID of the project.", Candidates.projects),
    label: (target) => `project [${target.id}]`,
    resolveTarget: (ctx, args) => {
      const id = ParsedArgs.requiredPositional(args, 0);
      return Option.isSome(World.findActiveProject(ctx.world, id))
        ? Result.ok({ type: "project", id })
        : Result.err(CommandFailure.notFound(`projects/${id}`));
    },
    permissions: {
      get: "resourcemanager.projects.getIamPolicy",
      set: "resourcemanager.projects.setIamPolicy",
    },
  }),
];

const organizationTarget = (
  ctx: CommandContext,
  args: ParsedArgs,
): Result<PolicyTarget, CommandFailure> => {
  const id = ParsedArgs.requiredPositional(args, 0);
  return id === ctx.world.organization.id
    ? Result.ok({ type: "organization", id })
    : Result.err(CommandFailure.notFound(`organizations/${id}`));
};

export const OrganizationCommands: readonly CommandSpec[] = [
  plainCommand({
    path: ["gcloud", "organizations", "list"],
    summary: "List organizations accessible by the active account.",
    run: (ctx) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.table(
          [{ ...Organization.toRecord(ctx.world.organization), ID: ctx.world.organization.id }],
          [
            Column.create("DISPLAY_NAME", "displayName"),
            Column.create("ID", "ID"),
            Column.create("DIRECTORY_CUSTOMER_ID", "directoryCustomerId"),
          ],
        ),
      }),
  }),
  targetCommand({
    path: ["gcloud", "organizations", "describe"],
    summary: "Show metadata for an organization.",
    positionals: [Positional.required("ORGANIZATION_ID", "ID of the organization.")],
    permission: "resourcemanager.organizations.get",
    resolveTarget: organizationTarget,
    run: (ctx) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.yaml(Organization.toRecord(ctx.world.organization)),
      }),
  }),
  ...iamBindingCommands({
    group: ["gcloud", "organizations"],
    positional: Positional.required("ORGANIZATION_ID", "ID of the organization."),
    label: (target) => `organization [${target.id}]`,
    resolveTarget: organizationTarget,
    permissions: {
      get: "resourcemanager.organizations.getIamPolicy",
      set: "resourcemanager.organizations.setIamPolicy",
    },
  }),
];

const folderTarget = (
  ctx: CommandContext,
  args: ParsedArgs,
): Result<PolicyTarget, CommandFailure> => {
  const id = ParsedArgs.requiredPositional(args, 0);
  return Option.isSome(World.findFolder(ctx.world, id))
    ? Result.ok({ type: "folder", id })
    : Result.err(CommandFailure.notFound(`folders/${id}`));
};

const FolderColumns = [
  Column.create("ID", "name", "basename"),
  Column.create("DISPLAY_NAME", "displayName"),
  Column.create("PARENT_NAME", "parent"),
];

export const FolderCommands: readonly CommandSpec[] = [
  plainCommand({
    path: ["gcloud", "resource-manager", "folders", "list"],
    summary: "List folders under a parent.",
    flags: [
      Flag.string("organization", "Organization ID to list folders under."),
      Flag.string("folder", "Folder ID to list folders under."),
    ],
    run: (ctx, args) => {
      const folder = ParsedArgs.string(args, "folder");
      const organization = ParsedArgs.string(args, "organization");
      const noParent = !Option.isSome(folder) && !Option.isSome(organization);
      if (noParent) {
        return Result.err(CommandFailure.mustBeSpecified("(--folder | --organization)"));
      }
      const parent: ParentRef = Option.isSome(folder)
        ? { type: "folder", id: folder.value }
        : { type: "organization", id: Option.unwrapOr(organization, "") };
      return Result.ok({
        world: ctx.world,
        output: CommandOutput.table(
          World.foldersUnder(ctx.world, parent).map(Folder.toRecord),
          FolderColumns,
        ),
      });
    },
  }),
  targetCommand({
    path: ["gcloud", "resource-manager", "folders", "create"],
    summary: "Create a new folder.",
    flags: [
      Flag.string("display-name", "Friendly display name to use for the new folder.", {
        required: true,
      }),
      Flag.string("organization", "Organization ID to use as the parent."),
      Flag.string("folder", "Folder ID to use as the parent."),
    ],
    permission: "resourcemanager.folders.create",
    resolveTarget: parentFromFlags,
    run: (ctx, args) => {
      const parent = parentFromFlags(ctx, args);
      if (!Result.isOk(parent)) return parent;
      const numbered = World.nextNumber(ctx.world);
      const folder = Result.mapErr(
        Folder.create({
          displayName: ParsedArgs.requiredString(args, "display-name"),
          parent: parent.value,
          sequence: numbered.number,
        }),
        (m) => CommandFailure.invalidValue("--display-name", m),
      );
      if (!Result.isOk(folder)) return folder;
      return Result.map(
        Result.mapErr(World.withFolder(numbered.world, folder.value), alreadyExists),
        (world) => ({
          world,
          output: CommandOutput.yaml(Folder.toRecord(folder.value), [
            OutputMessage.plain(`Waiting for [operations/fc.${numbered.number}] to finish...done.`),
          ]),
        }),
      );
    },
  }),
  targetCommand({
    path: ["gcloud", "resource-manager", "folders", "describe"],
    summary: "Show metadata for a folder.",
    positionals: [Positional.required("FOLDER_ID", "ID of the folder.")],
    permission: "resourcemanager.folders.get",
    resolveTarget: folderTarget,
    run: (ctx) =>
      Result.map(
        Option.toResult(World.findFolder(ctx.world, ctx.target.id), () =>
          CommandFailure.notFound(PolicyTarget.toPath(ctx.target)),
        ),
        (folder) => ({ world: ctx.world, output: CommandOutput.yaml(Folder.toRecord(folder)) }),
      ),
  }),
  ...iamBindingCommands({
    group: ["gcloud", "resource-manager", "folders"],
    positional: Positional.required("FOLDER_ID", "ID of the folder."),
    label: (target) => `folder [${target.id}]`,
    resolveTarget: folderTarget,
    permissions: {
      get: "resourcemanager.folders.getIamPolicy",
      set: "resourcemanager.folders.setIamPolicy",
    },
  }),
];
