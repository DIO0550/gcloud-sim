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
  record,
  success,
} from "@/engine/commands/artifacts/shared";
import { plainCommand } from "@/engine/commands/shared";
import { Region } from "@/engine/domains/catalog";
import { type CloudBuild, ContainerLab } from "@/engine/domains/container-lab";
import { EffectivePermissions } from "@/engine/domains/effective-permissions";
import { Principal } from "@/engine/domains/principal";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const regionFlag = Flag.string(
  "region",
  "Build location (global or a supported region; default global).",
  { candidates: () => ["global", ...Region.all()] },
);
const scope = (ctx: CommandContext, args: ParsedArgs, permission: string) => {
  const projectId = Option.isSome(ctx.projectId) ? ctx.projectId.value : fail("Specify --project.");
  if (!Option.isSome(World.findActiveProject(ctx.world, projectId)))
    fail("Project not found or inactive.");
  if (!World.hasApi(ctx.world, projectId, "cloudbuild.googleapis.com"))
    fail("cloudbuild.googleapis.com is disabled.");
  const principal = account(ctx.world, args);
  if (
    !EffectivePermissions.resolve(ctx.world, Principal.toMember(principal), {
      type: "project",
      id: projectId,
    }).permissions.has(permission)
  )
    fail(`Permission denied: ${permission}.`);
  const region = Option.unwrapOr(ParsedArgs.string(args, "region"), "global");
  if (region !== "global" && !Option.isSome(Region.parse(region)))
    fail("Unsupported Cloud Build region.");
  return { projectId, region, principal };
};
const buildArg = Positional.required("BUILD", "Simulated build ID.", (w) =>
  w.containerLab.builds.map((b) => b.id),
);
const find = (ctx: CommandContext, args: ParsedArgs, permission: string): CloudBuild => {
  const { projectId, region } = scope(ctx, args, permission);
  const id = ParsedArgs.requiredPositional(args, 0);
  return (
    ctx.world.containerLab.builds.find(
      (b) => b.id === id && b.projectId === projectId && b.region === region,
    ) ?? fail(`Build not found in ${projectId}/${region}: ${id}`)
  );
};
const replace = (world: World, build: CloudBuild): World =>
  commit(world, {
    ...world.containerLab,
    builds: world.containerLab.builds.map((b) => (b.id === build.id ? build : b)),
  });
const finish = (world: World, build: CloudBuild, now: string): World => {
  try {
    if (!World.hasApi(world, build.projectId, "cloudbuild.googleapis.com"))
      fail("Cloud Build API is disabled.");
    if (!world.serviceAccounts.some((s) => s.email === build.serviceAccount))
      fail("Build service account no longer exists.");
    const ref = ContainerLab.registryReference(build.tag);
    const principal = Result.unwrap(Principal.parse(build.serviceAccount));
    authorize(world, principal, ref.projectId, "artifactregistry.repositories.uploadArtifacts", {
      type: "artifact-repository",
      id: ref.repositoryId,
    });
    const published = commit(
      world,
      ContainerLab.publish(world.containerLab, ref, build.source, now),
    );
    return replace(published, {
      ...build,
      status: "SUCCESS",
      digest: ContainerLab.digest(build.source),
      logs: [...build.logs, `Built ${build.source}`, `Pushed ${build.tag}`, "SUCCESS"],
    });
  } catch (error) {
    return replace(world, {
      ...build,
      status: "FAILURE",
      logs: [...build.logs, `FAILURE: ${error instanceof Error ? error.message : "Build failed"}`],
    });
  }
};
const buildRecord = (b: CloudBuild) => ({
  ...b,
  name: `projects/${b.projectId}/locations/${b.region}/builds/${b.id}`,
});
export const BuildCommands: readonly CommandSpec[] = [
  plainCommand({
    path: ["gcloud", "builds", "submit"],
    summary: "Build a fixed lesson context remotely and push to Artifact Registry (simulated).",
    positionals: [
      Positional.optional("SOURCE", "Built-in context only: ., ./hello-web, ./hello-web-v2."),
    ],
    flags: [
      regionFlag,
      Flag.string("tag", "Artifact Registry target image.", {
        required: true,
        aliases: ["-t"],
        singleUse: true,
      }),
      Flag.string(
        "service-account",
        "Existing build service account: projects/PROJECT/serviceAccounts/EMAIL (required in this lesson).",
        { required: true },
      ),
      Flag.boolean("async", "Queue only; progress using sim builds advance."),
    ],
    run: guarded((ctx, args) => {
      const { projectId, region, principal } = scope(ctx, args, "cloudbuild.builds.create");
      const source = ContainerLab.recipe(args.positionals[0] ?? ".");
      const ref = ContainerLab.registryReference(ParsedArgs.requiredString(args, "tag"));
      if (ref.digest) fail("Build target must use a tag.");
      const full = /^projects\/([^/]+)\/serviceAccounts\/([^/]+)$/.exec(
        ParsedArgs.requiredString(args, "service-account"),
      );
      if (!full || full[1] !== projectId)
        fail(
          "Use projects/BUILD_PROJECT/serviceAccounts/EMAIL; cross-project build accounts are unsupported.",
        );
      const email = full?.[2] ?? fail("Invalid build service account.");
      const serviceAccount =
        ctx.world.serviceAccounts.find((s) => s.email === email && s.projectId === projectId) ??
        fail("Build service account not found.");
      if (
        !EffectivePermissions.resolve(ctx.world, Principal.toMember(principal), {
          type: "service-account",
          id: serviceAccount.email,
        }).permissions.has("iam.serviceAccounts.actAs")
      )
        fail("Permission denied: iam.serviceAccounts.actAs on build service account.");
      const numbered = World.nextNumber(ctx.world);
      const b: CloudBuild = {
        id: `build-${numbered.number}`,
        projectId,
        region,
        source,
        tag: ref.canonical,
        serviceAccount: serviceAccount.email,
        status: "QUEUED",
        created: ctx.now,
        digest: "",
        logs: ["QUEUED (simulated)"],
      };
      const queued = commit(numbered.world, {
        ...ctx.world.containerLab,
        builds: [...ctx.world.containerLab.builds, b],
      });
      if (ParsedArgs.boolean(args, "async")) return record(queued, buildRecord(b));
      const done = finish(
        queued,
        { ...b, status: "WORKING", logs: [...b.logs, "WORKING"] },
        ctx.now,
      );
      return record(
        done,
        buildRecord(done.containerLab.builds.find((i) => i.id === b.id) ?? fail("Missing build.")),
      );
    }),
  }),
  plainCommand({
    path: ["gcloud", "builds", "list"],
    summary: "List simulated builds in one project and location.",
    flags: [regionFlag],
    run: guarded((ctx, args) => {
      const { projectId, region } = scope(ctx, args, "cloudbuild.builds.list");
      return Result.ok({
        world: ctx.world,
        output: CommandOutput.table(
          ctx.world.containerLab.builds
            .filter((b) => b.projectId === projectId && b.region === region)
            .map(buildRecord),
          [
            Column.create("ID", "id"),
            Column.create("STATUS", "status"),
            Column.create("IMAGES", "tag"),
            Column.create("CREATE_TIME", "created"),
          ],
        ),
      });
    }),
  }),
  plainCommand({
    path: ["gcloud", "builds", "describe"],
    summary: "Describe a simulated build.",
    positionals: [buildArg],
    flags: [regionFlag],
    run: guarded((ctx, args) =>
      record(ctx.world, buildRecord(find(ctx, args, "cloudbuild.builds.get"))),
    ),
  }),
  plainCommand({
    path: ["gcloud", "builds", "log"],
    summary: "Read fixed simulated build logs; no streaming or external log storage.",
    positionals: [buildArg],
    flags: [regionFlag],
    run: guarded((ctx, args) =>
      success(ctx.world, find(ctx, args, "cloudbuild.builds.get").logs.join("\n")),
    ),
  }),
  plainCommand({
    path: ["gcloud", "builds", "cancel"],
    summary: "Cancel a queued or working simulated build.",
    positionals: [buildArg],
    flags: [regionFlag],
    run: guarded((ctx, args) => {
      const b = find(ctx, args, "cloudbuild.builds.update");
      if (!["QUEUED", "WORKING"].includes(b.status)) fail("Build is already terminal.");
      const next: CloudBuild = { ...b, status: "CANCELLED", logs: [...b.logs, "CANCELLED"] };
      return record(replace(ctx.world, next), buildRecord(next));
    }),
  }),
  plainCommand({
    path: ["sim", "builds", "advance"],
    summary: "Advance a build by one deterministic step (QUEUED → WORKING → result).",
    positionals: [buildArg],
    flags: [regionFlag],
    run: guarded((ctx, args) => {
      const b = find(ctx, args, "cloudbuild.builds.update");
      if (!["QUEUED", "WORKING"].includes(b.status)) fail("Build is already terminal.");
      const next =
        b.status === "QUEUED"
          ? replace(ctx.world, { ...b, status: "WORKING", logs: [...b.logs, "WORKING"] })
          : finish(ctx.world, b, ctx.now);
      return record(
        next,
        buildRecord(next.containerLab.builds.find((i) => i.id === b.id) ?? fail("Missing build.")),
      );
    }),
  }),
];
