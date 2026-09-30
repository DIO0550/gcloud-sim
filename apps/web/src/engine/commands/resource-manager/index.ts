import { CommandFailure } from "@/engine/cli/command-error";
import {
  Column,
  type CommandContext,
  CommandOutput,
  type CommandSpec,
  Flag,
  OutputMessage,
  ParsedArgs,
  Positional,
} from "@/engine/cli/command-spec";
import { alreadyExists, iamBindingCommands } from "@/engine/commands/shared";
import { EffectivePermissions } from "@/engine/domains/effective-permissions";
import { GcloudConfig } from "@/engine/domains/gcloud-config";
import { IamPolicy } from "@/engine/domains/iam-policy";
import { Principal } from "@/engine/domains/principal";
import {
  Folder,
  Organization,
  type ParentRef,
  type PolicyTarget,
  Project,
  ProjectStates,
} from "@/engine/domains/resource-hierarchy";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const ProjectColumns = [
  Column.of("PROJECT_ID", "projectId"),
  Column.of("NAME", "name"),
  Column.of("PROJECT_NUMBER", "projectNumber"),
];

const visibleProjects = (ctx: CommandContext) =>
  World.activeProjects(ctx.world).filter((project) => {
    const effective = EffectivePermissions.resolve(ctx.world, Principal.toMember(ctx.principal), {
      type: "project",
      id: project.projectId,
    });
    return EffectivePermissions.has(effective, "resourcemanager.projects.get");
  });

const projectTarget = (
  _ctx: CommandContext,
  args: ParsedArgs,
): Result<PolicyTarget, CommandFailure> =>
  Result.ok({ type: "project", id: Option.unwrapOr(ParsedArgs.positional(args, 0), "") });

const requireProjectArg = (ctx: CommandContext, args: ParsedArgs, includeDeleted: boolean) => {
  const id = Option.unwrapOr(ParsedArgs.positional(args, 0), "");
  const project = includeDeleted
    ? World.findProject(ctx.world, id)
    : World.findActiveProject(ctx.world, id);
  return Option.isSome(project)
    ? Result.ok(project.value)
    : Result.err(CommandFailure.notFound(`projects/${id}`));
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
    : Result.err(
        CommandFailure.notFound(
          parent.type === "folder" ? `folders/${parent.id}` : `organizations/${parent.id}`,
        ),
      );
};

const projectNumber = (sequence: number): string => String(100000000000 + sequence * 7919);

export const ProjectCommands: readonly CommandSpec[] = [
  {
    kind: "plain",
    path: ["gcloud", "projects", "list"],
    summary: "List projects accessible by the active account.",
    positionals: [],
    flags: [],
    destructive: false,
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
  },
  {
    kind: "target",
    path: ["gcloud", "projects", "describe"],
    summary: "Show metadata for a project.",
    positionals: [Positional.required("PROJECT_ID", "ID for the project you want to describe.")],
    flags: [],
    destructive: false,
    requiredPermissions: ["resourcemanager.projects.get"],
    resolveTarget: projectTarget,
    run: (ctx, args) =>
      Result.map(requireProjectArg(ctx, args, true), (project) => ({
        world: ctx.world,
        output: CommandOutput.yaml(Project.toRecord(project)),
      })),
  },
  {
    kind: "target",
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
    destructive: false,
    requiredPermissions: ["resourcemanager.projects.create"],
    resolveTarget: parentFromFlags,
    run: (ctx, args) => {
      const parent = parentFromFlags(ctx, args);
      if (!Result.isOk(parent)) return parent;
      const numbered = World.nextNumber(ctx.world);
      const projectId = Option.unwrapOr(ParsedArgs.positional(args, 0), "");
      const created = Result.mapErr(
        Project.create({
          projectId,
          name: Option.unwrapOr(ParsedArgs.string(args, "name"), ""),
          parent: parent.value,
          projectNumber: projectNumber(numbered.number),
          createTime: ctx.now,
        }),
        (message) => CommandFailure.invalidValue("PROJECT_ID", message),
      );
      if (!Result.isOk(created)) return created;
      const owned = Project.withPolicy(
        { ...created.value, labels: ParsedArgs.keyvalue(args, "labels") },
        IamPolicy.addBinding(IamPolicy.Empty, "roles/owner", Principal.toMember(ctx.principal)),
      );
      const added = Result.mapErr(World.withProject(numbered.world, owned), alreadyExists);
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
          OutputMessage.plain(
            `Create in progress for [https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}].`,
          ),
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
  },
  {
    kind: "target",
    path: ["gcloud", "projects", "delete"],
    summary: "Delete a project.",
    positionals: [Positional.required("PROJECT_ID", "ID for the project you want to delete.")],
    flags: [],
    destructive: true,
    requiredPermissions: ["resourcemanager.projects.delete"],
    resolveTarget: projectTarget,
    run: (ctx, args) =>
      Result.map(requireProjectArg(ctx, args, false), (project) => ({
        world: World.replaceProject(
          ctx.world,
          Project.withState(project, ProjectStates.DeleteRequested),
        ),
        output: CommandOutput.messages(
          OutputMessage.plain(
            `Deleted [https://cloudresourcemanager.googleapis.com/v1/projects/${project.projectId}].`,
          ),
          OutputMessage.plain(""),
          OutputMessage.plain(
            "You can undo this operation for a limited period by running the command below.",
          ),
          OutputMessage.plain(`    $ gcloud projects undelete ${project.projectId}`),
        ),
      })),
  },
  {
    kind: "target",
    path: ["gcloud", "projects", "undelete"],
    summary: "Undelete a project.",
    positionals: [Positional.required("PROJECT_ID", "ID for the project you want to undelete.")],
    flags: [],
    destructive: false,
    requiredPermissions: ["resourcemanager.projects.undelete"],
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
          OutputMessage.plain(
            `Restored [https://cloudresourcemanager.googleapis.com/v1/projects/${project.value.projectId}].`,
          ),
        ),
      });
    },
  },
  ...iamBindingCommands({
    group: ["gcloud", "projects"],
    positional: Positional.required("PROJECT_ID", "ID of the project."),
    label: (target) => `project [${target.id}]`,
    resolveTarget: (ctx, args) => {
      const id = Option.unwrapOr(ParsedArgs.positional(args, 0), "");
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
  const id = Option.unwrapOr(ParsedArgs.positional(args, 0), "");
  return id === ctx.world.organization.id
    ? Result.ok({ type: "organization", id })
    : Result.err(CommandFailure.notFound(`organizations/${id}`));
};

export const OrganizationCommands: readonly CommandSpec[] = [
  {
    kind: "plain",
    path: ["gcloud", "organizations", "list"],
    summary: "List organizations accessible by the active account.",
    positionals: [],
    flags: [],
    destructive: false,
    run: (ctx) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.table(
          [{ ...Organization.toRecord(ctx.world.organization), ID: ctx.world.organization.id }],
          [
            Column.of("DISPLAY_NAME", "displayName"),
            Column.of("ID", "ID"),
            Column.of("DIRECTORY_CUSTOMER_ID", "directoryCustomerId"),
          ],
        ),
      }),
  },
  {
    kind: "target",
    path: ["gcloud", "organizations", "describe"],
    summary: "Show metadata for an organization.",
    positionals: [Positional.required("ORGANIZATION_ID", "ID of the organization.")],
    flags: [],
    destructive: false,
    requiredPermissions: ["resourcemanager.organizations.get"],
    resolveTarget: organizationTarget,
    run: (ctx) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.yaml(Organization.toRecord(ctx.world.organization)),
      }),
  },
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
  const id = Option.unwrapOr(ParsedArgs.positional(args, 0), "");
  return Option.isSome(World.findFolder(ctx.world, id))
    ? Result.ok({ type: "folder", id })
    : Result.err(CommandFailure.notFound(`folders/${id}`));
};

const FolderColumns = [
  Column.of("ID", "name", "basename"),
  Column.of("DISPLAY_NAME", "displayName"),
  Column.of("PARENT_NAME", "parent"),
];

export const FolderCommands: readonly CommandSpec[] = [
  {
    kind: "plain",
    path: ["gcloud", "resource-manager", "folders", "list"],
    summary: "List folders under a parent.",
    positionals: [],
    flags: [
      Flag.string("organization", "Organization ID to list folders under."),
      Flag.string("folder", "Folder ID to list folders under."),
    ],
    destructive: false,
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
      const folders = ctx.world.folders.filter(
        (f) => f.parent.type === parent.type && f.parent.id === parent.id,
      );
      return Result.ok({
        world: ctx.world,
        output: CommandOutput.table(folders.map(Folder.toRecord), FolderColumns),
      });
    },
  },
  {
    kind: "target",
    path: ["gcloud", "resource-manager", "folders", "create"],
    summary: "Create a new folder.",
    positionals: [],
    flags: [
      Flag.string("display-name", "Friendly display name to use for the new folder.", {
        required: true,
      }),
      Flag.string("organization", "Organization ID to use as the parent."),
      Flag.string("folder", "Folder ID to use as the parent."),
    ],
    destructive: false,
    requiredPermissions: ["resourcemanager.folders.create"],
    resolveTarget: parentFromFlags,
    run: (ctx, args) => {
      const parent = parentFromFlags(ctx, args);
      if (!Result.isOk(parent)) return parent;
      const numbered = World.nextNumber(ctx.world);
      const folder: Folder = {
        id: String(284100000000 + numbered.number),
        displayName: Option.unwrapOr(ParsedArgs.string(args, "display-name"), ""),
        parent: parent.value,
        iamPolicy: IamPolicy.Empty,
      };
      return Result.map(
        Result.mapErr(World.withFolder(numbered.world, folder), alreadyExists),
        (world) => ({
          world,
          output: CommandOutput.yaml(Folder.toRecord(folder), [
            OutputMessage.plain(`Waiting for [operations/fc.${numbered.number}] to finish...done.`),
          ]),
        }),
      );
    },
  },
  {
    kind: "target",
    path: ["gcloud", "resource-manager", "folders", "describe"],
    summary: "Show metadata for a folder.",
    positionals: [Positional.required("FOLDER_ID", "ID of the folder.")],
    flags: [],
    destructive: false,
    requiredPermissions: ["resourcemanager.folders.get"],
    resolveTarget: folderTarget,
    run: (ctx, args) => {
      const id = Option.unwrapOr(ParsedArgs.positional(args, 0), "");
      const folder = World.findFolder(ctx.world, id);
      return Option.isSome(folder)
        ? Result.ok({ world: ctx.world, output: CommandOutput.yaml(Folder.toRecord(folder.value)) })
        : Result.err(CommandFailure.notFound(`folders/${id}`));
    },
  },
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
