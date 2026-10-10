import { CommandOutput, type CommandSpec, Flag, ParsedArgs } from "@/engine/cli/command-spec";
import { commit, fail, guarded, success } from "@/engine/commands/artifacts/shared";
import { plainCommand, projectCommand } from "@/engine/commands/shared";
import { ContainerLab } from "@/engine/domains/container-lab";
import {
  ContainerRelease,
  deployedReleaseReady,
  localReleaseReady,
  releaseCleanupComplete,
} from "@/engine/domains/container-lab/release";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

export const ContainerReleaseCommands: readonly CommandSpec[] = [
  plainCommand({
    path: ["sim", "container-release", "validate-local"],
    summary:
      "Validate the fixed release-local container at 8080 and retain lesson evidence; no HTTP is sent.",
    run: guarded((ctx) => {
      if (!localReleaseReady(ctx.world)) {
        fail(
          "Run release-local from release-local:v1 (hello-web) with -p 8080:8080 before validation.",
        );
      }

      const previous = ctx.world.containerLab.releases.find((r) => r.id === ContainerRelease.id);
      if (previous) {
        return success(ctx.world, "Local release was already validated. Evidence is retained.");
      }

      const target = ContainerLab.registryReference(ContainerRelease.image);
      if (
        ctx.world.containerLab.registryImages.some(
          (i) => i.repositoryId === target.repositoryId && i.name === target.image,
        )
      ) {
        fail(
          "Validate locally before publishing. Remove this lesson's remote image and retry local validation.",
        );
      }

      return success(
        commit(ctx.world, {
          ...ctx.world.containerLab,
          releases: [
            {
              id: ContainerRelease.id,
              stage: "LOCAL_VALIDATED",
              digest: ContainerLab.digest("hello-web"),
              localValidatedAt: ctx.now,
              deploymentValidatedAt: "",
            },
          ],
        }),
        "HTTP/1.1 200 OK (simulated)\nLocal release validated; no request was sent.",
      );
    }),
  }),
  projectCommand({
    path: ["sim", "container-release", "validate-deployment"],
    summary:
      "Validate this lesson's published image, node pull permission, two Ready replicas and Service; no network calls.",
    permissions: ["container.clusters.get", "container.deployments.get", "container.services.get"],
    requiredApis: ["container.googleapis.com", "artifactregistry.googleapis.com"],
    flags: [
      Flag.string("project", "Lesson project."),
      Flag.string("account", "Logged-in account to validate deployment access."),
      Flag.string("region", "Fixed lesson region us-central1.", {
        required: true,
        singleUse: true,
        candidates: () => [ContainerRelease.region],
      }),
    ],
    run: guarded((ctx, args) => {
      if (Option.unwrapOr(ctx.projectId, "") !== ContainerRelease.projectId) {
        fail("This fixed release lesson belongs to ace-dev-01.");
      }
      if (ParsedArgs.requiredString(args, "region") !== ContainerRelease.region) {
        fail("This fixed release lesson uses us-central1.");
      }

      const evidence = ctx.world.containerLab.releases.find((r) => r.id === ContainerRelease.id);
      if (!evidence) {
        fail("Validate the local release before publishing and deploying it.");
      }
      if (!deployedReleaseReady(ctx.world)) {
        fail(
          "Release is not ready: verify image, node Reader permission, two Ready replicas and LoadBalancer Service 80→8080.",
        );
      }

      return success(
        commit(ctx.world, {
          ...ctx.world.containerLab,
          releases: ctx.world.containerLab.releases.map((r) => ({
            ...r,
            stage: "DEPLOYMENT_VALIDATED",
            deploymentValidatedAt: ctx.now,
          })),
        }),
        "Published release and GKE readiness validated (simulated). Cleanup remains required.",
      );
    }),
  }),
  plainCommand({
    path: ["sim", "container-release", "status"],
    summary: "Inspect retained lesson validation evidence and current cleanup state.",
    run: (ctx) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.yaml({
          lesson: ContainerRelease.id,
          evidence: ctx.world.containerLab.releases.map((r) => ({ ...r })),
          cleanupComplete: releaseCleanupComplete(ctx.world),
          simulated: true,
        }),
      }),
  }),
];
