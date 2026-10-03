import {
  Column,
  CommandOutput,
  type CommandSpec,
  Flag,
  ParsedArgs,
  Positional,
} from "@/engine/cli/command-spec";
import {
  account,
  authorize,
  commit,
  fail,
  guarded,
  record,
  repositoryRecord,
  repositoryRef,
  requireRepository,
  success,
} from "@/engine/commands/artifacts/shared";
import { CommonFlags, parseBinding, plainCommand } from "@/engine/commands/shared";
import { ContainerLab } from "@/engine/domains/container-lab";
import { IamPolicy } from "@/engine/domains/iam-policy";
import type { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

export { DockerCommands } from "@/engine/commands/artifacts/docker";

const location = Flag.string("location", "Repository location.", {
  candidates: ContainerLab.locations,
});
const names = (w: World): readonly string[] => w.containerLab.repositories.map((r) => r.id);
const repoArg = Positional.required(
  "REPOSITORY",
  "Repository ID plus --location, or full resource name.",
  names,
);
const prefix = ["gcloud", "artifacts", "repositories"];
export const ArtifactCommands: readonly CommandSpec[] = [
  plainCommand({
    path: [...prefix, "create"],
    summary: "Create a standard Docker Artifact Registry repository.",
    positionals: [repoArg],
    flags: [
      location,
      Flag.enum("repository-format", "Only Docker format is supported.", ["docker"], {
        required: true,
      }),
      Flag.string("description", "Repository description."),
      Flag.boolean("immutable-tags", "Prevent a tag from moving to another digest."),
    ],
    run: guarded((ctx, args) => {
      const ref = repositoryRef(ctx, args);
      authorize(
        ctx.world,
        account(ctx.world, args),
        ref.projectId,
        "artifactregistry.repositories.create",
      );
      if (ctx.world.containerLab.repositories.some((r) => r.id === ref.id))
        fail(`Repository already exists: ${ref.id}`);
      const repo = {
        ...ref,
        description: Option.unwrapOr(ParsedArgs.string(args, "description"), ""),
        immutableTags: ParsedArgs.boolean(args, "immutable-tags"),
        iamPolicy: IamPolicy.Empty,
        created: ctx.now,
      };
      return record(
        commit(ctx.world, {
          ...ctx.world.containerLab,
          repositories: [...ctx.world.containerLab.repositories, repo],
        }),
        repositoryRecord(repo),
      );
    }),
  }),
  plainCommand({
    path: [...prefix, "list"],
    summary: "List repositories in the selected project, optionally filtered by location.",
    flags: [location],
    run: guarded((ctx, args) => {
      const projectId = Option.isSome(ctx.projectId)
        ? ctx.projectId.value
        : fail("Specify a project.");
      authorize(
        ctx.world,
        account(ctx.world, args),
        projectId,
        "artifactregistry.repositories.list",
      );
      const selected = ParsedArgs.string(args, "location");
      if (Option.isSome(selected)) ContainerLab.location(selected.value);
      return Result.ok({
        world: ctx.world,
        output: CommandOutput.table(
          ctx.world.containerLab.repositories
            .filter(
              (r) =>
                r.projectId === projectId &&
                (!Option.isSome(selected) || selected.value === r.location),
            )
            .map(repositoryRecord),
          [
            Column.create("NAME", "name"),
            Column.create("FORMAT", "format"),
            Column.create("LOCATION", "location"),
          ],
        ),
      });
    }),
  }),
  ...(
    [
      "describe",
      "delete",
      "get-iam-policy",
      "add-iam-policy-binding",
      "remove-iam-policy-binding",
    ] as const
  ).map((action) =>
    plainCommand({
      path: [...prefix, action],
      summary: `${action} for an Artifact Registry repository.`,
      positionals: [repoArg],
      flags: [
        location,
        ...(action.includes("-binding") ? [CommonFlags.member, CommonFlags.role] : []),
      ],
      destructive: action === "delete",
      run: guarded((ctx, args) => {
        const ref = repositoryRef(ctx, args);
        const repo = requireRepository(ctx.world, ref.id);
        const permission =
          action === "describe"
            ? "get"
            : action === "delete"
              ? "delete"
              : action === "get-iam-policy"
                ? "getIamPolicy"
                : "setIamPolicy";
        authorize(
          ctx.world,
          account(ctx.world, args),
          ref.projectId,
          `artifactregistry.repositories.${permission}`,
          { type: "artifact-repository", id: repo.id },
        );
        if (action === "describe") return record(ctx.world, repositoryRecord(repo));
        if (action === "get-iam-policy")
          return record(ctx.world, IamPolicy.toRecord(repo.iamPolicy));
        if (action === "delete")
          return success(
            commit(ctx.world, {
              ...ctx.world.containerLab,
              repositories: ctx.world.containerLab.repositories.filter((r) => r.id !== repo.id),
              registryImages: ctx.world.containerLab.registryImages.filter(
                (i) => i.repositoryId !== repo.id,
              ),
            }),
            `Deleted ${repo.id} and its stored images. Local images and containers remain.`,
          );
        const binding = parseBinding(ctx.world, args);
        if (!Result.isOk(binding)) return binding;
        const { role, member } = binding.value;
        const policy =
          action === "add-iam-policy-binding"
            ? Option.some(IamPolicy.addBinding(repo.iamPolicy, role, member))
            : IamPolicy.removeBinding(repo.iamPolicy, role, member);
        if (!Option.isSome(policy)) fail("IAM binding not found.");
        const next = Option.isSome(policy) ? policy.value : repo.iamPolicy;
        return record(
          commit(ctx.world, {
            ...ctx.world.containerLab,
            repositories: ctx.world.containerLab.repositories.map((r) =>
              r.id === repo.id ? { ...r, iamPolicy: next } : r,
            ),
          }),
          IamPolicy.toRecord(next),
        );
      }),
    }),
  ),
  plainCommand({
    path: ["gcloud", "artifacts", "docker", "images", "list"],
    summary: "List simulated image versions in a Docker repository, optionally including tags.",
    positionals: [Positional.required("REPOSITORY", "LOCATION-docker.pkg.dev/PROJECT/REPOSITORY")],
    flags: [Flag.boolean("include-tags", "Include image tags.")],
    run: guarded((ctx, args) => {
      const raw = ParsedArgs.requiredPositional(args, 0);
      if (raw.split("/").length !== 3) fail("Specify LOCATION-docker.pkg.dev/PROJECT/REPOSITORY.");
      const ref = ContainerLab.registryReference(`${raw}/placeholder`);
      const repo = requireRepository(ctx.world, ref.repositoryId);
      authorize(
        ctx.world,
        account(ctx.world, args),
        repo.projectId,
        "artifactregistry.dockerimages.list",
        { type: "artifact-repository", id: repo.id },
      );
      return Result.ok({
        world: ctx.world,
        output: CommandOutput.table(
          ctx.world.containerLab.registryImages
            .filter((i) => i.repositoryId === repo.id)
            .map((i) => ({
              image: `${raw}/${i.name}`,
              digest: i.digest,
              uploadTime: i.uploaded,
              ...(ParsedArgs.boolean(args, "include-tags") ? { tags: [...i.tags] } : {}),
            })),
          [
            Column.create("IMAGE", "image"),
            Column.create("DIGEST", "digest"),
            ...(ParsedArgs.boolean(args, "include-tags") ? [Column.create("TAGS", "tags")] : []),
          ],
        ),
      });
    }),
  }),
  plainCommand({
    path: ["gcloud", "artifacts", "docker", "images", "describe"],
    summary: "Describe a simulated registry image by tag or digest.",
    positionals: [Positional.required("IMAGE", "Artifact Registry image reference.")],
    run: guarded((ctx, args) => {
      const ref = ContainerLab.registryReference(ParsedArgs.requiredPositional(args, 0));
      const repo = requireRepository(ctx.world, ref.repositoryId);
      authorize(
        ctx.world,
        account(ctx.world, args),
        repo.projectId,
        "artifactregistry.dockerimages.get",
        { type: "artifact-repository", id: repo.id },
      );
      const image =
        ctx.world.containerLab.registryImages.find(
          (i) =>
            i.repositoryId === repo.id &&
            i.name === ref.image &&
            (ref.digest ? i.digest === ref.digest : i.tags.includes(ref.tag)),
        ) ?? fail("Registry image not found.");
      return record(ctx.world, {
        image: ref.name,
        digest: image.digest,
        tags: [...image.tags],
        uploadTime: image.uploaded,
      });
    }),
  }),
];
