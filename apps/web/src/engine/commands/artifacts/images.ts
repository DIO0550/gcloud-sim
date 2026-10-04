import {
  Column,
  type CommandContext,
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
  requireRepository,
  success,
} from "@/engine/commands/artifacts/shared";
import { plainCommand } from "@/engine/commands/shared";
import { ContainerLab, type RegistryRef } from "@/engine/domains/container-lab";
import type { World } from "@/engine/domains/world";
import { Result } from "@/utils/Result";

const prefix = ["gcloud", "artifacts", "docker"];
const qualified = (raw: string): boolean => /[:@]/.test(raw);
const explicitTag = (raw: string): RegistryRef => {
  const ref = ContainerLab.registryReference(raw);
  if (ref.digest || !raw.includes(":")) fail("Specify an explicit IMAGE:TAG.");
  return ref;
};
const version = (world: World, ref: RegistryRef) =>
  world.containerLab.registryImages.find(
    (i) =>
      i.repositoryId === ref.repositoryId &&
      i.name === ref.image &&
      (ref.digest ? i.digest === ref.digest : i.tags.includes(ref.tag)),
  ) ?? fail("Registry image not found.");
const permitted = (ctx: CommandContext, args: ParsedArgs, ref: RegistryRef, permission: string) => {
  const repo = requireRepository(ctx.world, ref.repositoryId);
  authorize(ctx.world, account(ctx.world, args), repo.projectId, permission, {
    type: "artifact-repository",
    id: repo.id,
  });
  return repo;
};
export const ArtifactImageCommands: readonly CommandSpec[] = [
  plainCommand({
    path: [...prefix, "tags", "list"],
    summary: "List remote tags in a repository or image path.",
    positionals: [
      Positional.required("IMAGE_OR_REPOSITORY", "Registry path without a tag or digest."),
    ],
    run: guarded((ctx, args) => {
      const raw = ParsedArgs.requiredPositional(args, 0);
      if (qualified(raw)) fail("Use a repository or image path without a tag or digest.");
      const wholeRepo = raw.split("/").length === 3;
      const ref = ContainerLab.registryReference(wholeRepo ? `${raw}/placeholder` : raw);
      permitted(ctx, args, ref, "artifactregistry.tags.list");
      const base = `${ref.host}/${ref.projectId}/${ref.repository}`;
      const rows = ctx.world.containerLab.registryImages
        .filter((i) => i.repositoryId === ref.repositoryId && (wholeRepo || i.name === ref.image))
        .flatMap((i) =>
          i.tags.map((tag) => ({
            tag: `${base}/${i.name}:${tag}`,
            version: `${base}/${i.name}@${i.digest}`,
          })),
        );
      return Result.ok({
        world: ctx.world,
        output: CommandOutput.table(rows, [
          Column.create("TAG", "tag"),
          Column.create("VERSION", "version"),
        ]),
      });
    }),
  }),
  plainCommand({
    path: [...prefix, "tags", "add"],
    summary: "Create or move a remote tag within the same image path.",
    positionals: [
      Positional.required("IMAGE", "Source IMAGE:TAG or IMAGE@DIGEST."),
      Positional.required("TAG", "Destination IMAGE:TAG."),
    ],
    run: guarded((ctx, args) => {
      const raw = ParsedArgs.requiredPositional(args, 0);
      if (!qualified(raw)) fail("Source requires an explicit tag or digest.");
      const ref = ContainerLab.registryReference(raw);
      const target = explicitTag(ParsedArgs.requiredPositional(args, 1));
      if (ref.name !== target.name)
        fail("Source and destination must use the same repository and image path.");
      const occupied = ctx.world.containerLab.registryImages.some(
        (i) =>
          i.repositoryId === target.repositoryId &&
          i.name === target.image &&
          i.tags.includes(target.tag),
      );
      permitted(
        ctx,
        args,
        ref,
        occupied ? "artifactregistry.tags.update" : "artifactregistry.tags.create",
      );
      const source = version(ctx.world, ref);
      return success(
        commit(
          ctx.world,
          ContainerLab.publish(ctx.world.containerLab, target, source.recipe, ctx.now),
        ),
        `Tagged ${target.canonical} at ${source.digest}.`,
      );
    }),
  }),
  plainCommand({
    path: [...prefix, "tags", "delete"],
    summary: "Remove a remote tag while retaining the image version.",
    positionals: [Positional.required("TAG", "Explicit IMAGE:TAG.")],
    destructive: true,
    run: guarded((ctx, args) => {
      const ref = explicitTag(ParsedArgs.requiredPositional(args, 0));
      const repo = permitted(ctx, args, ref, "artifactregistry.tags.delete");
      const source = version(ctx.world, ref);
      if (repo.immutableTags) fail("Cannot remove an immutable tag.");
      return success(
        commit(ctx.world, {
          ...ctx.world.containerLab,
          registryImages: ctx.world.containerLab.registryImages.map((i) =>
            i === source ? { ...i, tags: i.tags.filter((t) => t !== ref.tag) } : i,
          ),
        }),
        `Deleted tag ${ref.canonical}. Image version remains.`,
      );
    }),
  }),
  plainCommand({
    path: [...prefix, "images", "delete"],
    summary: "Delete a remote image path or a specific tag/digest version.",
    positionals: [Positional.required("IMAGE", "Image path, IMAGE:TAG or IMAGE@DIGEST.")],
    flags: [Flag.boolean("delete-tags", "Delete all tags attached to the selected versions.")],
    destructive: true,
    run: guarded((ctx, args) => {
      const raw = ParsedArgs.requiredPositional(args, 0);
      const ref = ContainerLab.registryReference(raw);
      const wholeImage = !qualified(raw);
      const repo = permitted(
        ctx,
        args,
        ref,
        wholeImage ? "artifactregistry.packages.delete" : "artifactregistry.versions.delete",
      );
      const selected = wholeImage
        ? ctx.world.containerLab.registryImages.filter(
            (i) => i.repositoryId === ref.repositoryId && i.name === ref.image,
          )
        : [version(ctx.world, ref)];
      if (!selected.length) fail("Registry image not found.");
      if (repo.immutableTags && selected.some((i) => i.tags.length))
        fail("Cannot delete an image with immutable tags.");
      const protectedTags = selected.some((i) =>
        i.tags.some((t) => wholeImage || ref.digest || t !== ref.tag),
      );
      if (protectedTags && !ParsedArgs.boolean(args, "delete-tags"))
        fail("Image has attached tags. Use --delete-tags to delete them too.");
      return success(
        commit(ctx.world, {
          ...ctx.world.containerLab,
          registryImages: ctx.world.containerLab.registryImages.filter(
            (i) => !selected.includes(i),
          ),
        }),
        `Deleted ${selected.length} image version(s). Local images, containers and build history remain.`,
      );
    }),
  }),
];
