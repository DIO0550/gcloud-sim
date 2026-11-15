import { CommandFailure } from "@/engine/cli/command-failure";
import {
  Column,
  CommandOutput,
  type CommandResult,
  type CommandSpec,
  Flag,
  OutputMessage,
  ParsedArgs,
  Positional,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import { Candidates, projectCommand } from "@/engine/commands/shared";
import { Region } from "@/engine/domains/catalog";
import { ExternalIp } from "@/engine/domains/compute";
import {
  InfraDeployment as Deployment,
  type InfraDeployment,
  MarketplaceSolution,
} from "@/engine/domains/infra-manager";
import { ServiceAccount } from "@/engine/domains/service-account";
import { TfResourceRuntime } from "@/engine/domains/terraform/resource-runtime";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

/**
 * Infrastructure Manager（`gcloud infra-manager`）。Cloud Marketplace の「デプロイ」はこの
 * `deployments apply` と同じ処理になる。ブループリントは Marketplace の製品カタログのものだけを受ける。
 */

const InfraManagerApi = "config.googleapis.com" as const;
const ComputeApi = "compute.googleapis.com" as const;

const DeploymentColumns = [
  Column.create("NAME", "name"),
  Column.create("STATE", "state"),
  Column.create("LATEST_REVISION", "latestRevision"),
  Column.create("CREATE_TIME", "createTime"),
];

const locationFlag = (required: boolean) =>
  Flag.string("location", "The location of the deployment, e.g. asia-northeast1.", { required });

/** 位置引数（完全な名前 or ID）と `--location` から、デプロイメントの置き場と名前を決める。 */
const resolveRef = (
  ctx: ProjectContext,
  args: ParsedArgs,
): Result<Readonly<{ location: Region; name: string }>, CommandFailure> => {
  const raw = ParsedArgs.requiredPositional(args, 0);
  const path = Deployment.parsePath(raw);
  if (Option.isSome(path) && path.value.projectId !== ctx.project.projectId) {
    return Result.err(
      CommandFailure.invalidValue(
        "DEPLOYMENT",
        `Project ${path.value.projectId} does not match the current project ${ctx.project.projectId}.`,
      ),
    );
  }
  const name = Option.isSome(path) ? path.value.name : raw;
  const rawLocation = Option.isSome(path)
    ? Option.some(path.value.location)
    : ParsedArgs.string(args, "location");
  if (!Option.isSome(rawLocation)) {
    return Result.err(
      CommandFailure.invalidArgumentWith(
        "Error parsing [deployment].\nThe [deployment] resource is not properly specified.\nFailed to find attribute [location]. The attribute can be set in the following ways:\n- provide the argument `deployment` on the command line with a fully specified name\n- provide the argument `--location` on the command line",
      ),
    );
  }
  const location = Region.parse(rawLocation.value);
  if (!Option.isSome(location)) {
    return Result.err(
      CommandFailure.notFound(`projects/${ctx.project.projectId}/locations/${rawLocation.value}`),
    );
  }
  return Result.ok({ location: location.value, name });
};

const findDeployment = (
  ctx: ProjectContext,
  args: ParsedArgs,
): Result<InfraDeployment, CommandFailure> =>
  Result.flatMap(resolveRef(ctx, args), (ref) =>
    Option.toResult(
      Option.fromNullable(
        World.namedOf(ctx.world, "infraDeployments", ctx.project.projectId).find(
          (d) => d.name === ref.name && d.location === ref.location,
        ),
      ),
      () => CommandFailure.notFound(Deployment.path(ctx.project.projectId, ref.location, ref.name)),
    ),
  );

/** Terraform の適用と同じ規則でリソースを作る・消す。失敗は投げるので、ここで受けて E-004 にする。 */
const mutate = (run: () => World): Result<World, CommandFailure> => {
  try {
    return Result.ok(run());
  } catch (error) {
    return Result.err(
      CommandFailure.invalidState(
        `Error: Terraform apply failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }
};

const apply = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const ref = resolveRef(ctx, args);
  if (!Result.isOk(ref)) return ref;
  const projectId = ctx.project.projectId;
  const { location, name } = ref.value;
  if (ParsedArgs.has(args, "git-source-repo") || ParsedArgs.has(args, "local-source")) {
    return Result.err(
      CommandFailure.unsupportedOperation(
        "gcloud-sim: ブループリントは Cloud Marketplace の製品のもの（--gcs-source）だけを受け付けます。",
      ),
    );
  }
  const source = ParsedArgs.string(args, "gcs-source");
  if (!Option.isSome(source)) {
    return Result.err(
      CommandFailure.mustBeSpecified(
        "Exactly one of (--gcs-source | --git-source-repo | --local-source)",
      ),
    );
  }
  const solution = MarketplaceSolution.findBySource(source.value);
  if (!Option.isSome(solution)) {
    return Result.err(
      CommandFailure.notFoundWith(
        `Blueprint not found: ${source.value}\ngcloud-sim: 使えるブループリントは Marketplace の製品のものだけです: ${MarketplaceSolution.sources().join(", ")}`,
      ),
    );
  }
  const rawAccount = ParsedArgs.requiredString(args, "service-account");
  const email = Deployment.serviceAccountEmail(rawAccount);
  if (!Option.isSome(email)) {
    return Result.err(
      CommandFailure.invalidValue(
        "--service-account",
        `Expected projects/{projectID}/serviceAccounts/{email}, got ${rawAccount}.`,
      ),
    );
  }
  const defaultCompute = ServiceAccount.defaultComputeEmail(ctx.project.projectNumber);
  if (
    email.value !== defaultCompute &&
    !Option.isSome(World.findServiceAccount(ctx.world, email.value))
  ) {
    return Result.err(
      CommandFailure.notFound(`projects/${projectId}/serviceAccounts/${email.value}`),
    );
  }
  const exists = World.namedOf(ctx.world, "infraDeployments", projectId).some(
    (d) => d.name === name,
  );
  if (exists) {
    return Result.err(
      CommandFailure.unsupportedOperation(
        `gcloud-sim: デプロイメント ${name} はもうあります。既存のデプロイメントの更新は再現していないので、delete してから apply し直してください。`,
      ),
    );
  }
  const inputs = ParsedArgs.keyvalue(args, "input-values");
  const plan = Deployment.plan({
    projectId,
    name,
    location,
    solution: solution.value,
    inputs,
    vmServiceAccount: defaultCompute,
  });
  if (!Result.isOk(plan)) {
    return Result.err(CommandFailure.invalidValue("--input-values", plan.error));
  }
  const applied = mutate(() =>
    [plan.value.instance, ...plan.value.firewalls].reduce(
      (world, resource) => TfResourceRuntime.mutate(world, resource, "create", false, ctx.now),
      ctx.world,
    ),
  );
  if (!Result.isOk(applied)) return applied;
  const deployment: InfraDeployment = {
    projectId,
    name,
    location,
    solution: solution.value.id,
    source: source.value,
    serviceAccount: rawAccount,
    inputs,
    resources: plan.value.resources,
    createTime: ctx.now,
  };
  const vm = Option.fromNullable(
    applied.value.instances.find(
      (i) =>
        i.projectId === projectId &&
        i.zone === plan.value.instance.zone &&
        i.name === plan.value.instance.name,
    ),
  );
  const address = Option.flatMap(vm, (i) => {
    const nic = i.networkInterfaces[0];
    return nic === undefined ? Option.none : ExternalIp.address(nic.externalIP);
  });
  return Result.ok({
    world: {
      ...applied.value,
      infraDeployments: [...applied.value.infraDeployments, deployment],
    },
    output: CommandOutput.withTrailing(
      CommandOutput.yaml(Deployment.toRecord(deployment), [
        OutputMessage.plain(
          `Creating the deployment [${Deployment.path(projectId, location, name)}]...done.`,
        ),
      ]),
      ...plan.value.resources.map((r) =>
        OutputMessage.hint(`gcloud-sim: ${r.type} ${r.name} を作りました。`),
      ),
      ...(Option.isSome(address)
        ? [OutputMessage.hint(`gcloud-sim: サイトのアドレス http://${address.value}/`)]
        : []),
    ),
  });
};

const remove = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const found = findDeployment(ctx, args);
  if (!Result.isOk(found)) return found;
  const d = found.value;
  const removed = mutate(() =>
    d.resources.reduce((world, r) => {
      if (r.type === "google_compute_firewall") {
        return {
          ...world,
          firewallRules: world.firewallRules.filter(
            (f) => !(f.projectId === d.projectId && f.name === r.name),
          ),
        };
      }
      return {
        ...world,
        instances: world.instances.filter(
          (i) =>
            !(
              i.projectId === d.projectId &&
              i.name === r.name &&
              Option.isSome(r.zone) &&
              i.zone === r.zone.value
            ),
        ),
      };
    }, ctx.world),
  );
  if (!Result.isOk(removed)) return removed;
  return Result.ok({
    world: {
      ...removed.value,
      infraDeployments: removed.value.infraDeployments.filter(
        (x) => !(x.projectId === d.projectId && x.name === d.name),
      ),
    },
    output: CommandOutput.messages(
      OutputMessage.plain(
        `Deleting the deployment [${Deployment.path(d.projectId, d.location, d.name)}]...done.`,
      ),
    ),
  });
};

const deploymentPositional = Positional.required(
  "DEPLOYMENT",
  "ID of the deployment or fully qualified identifier for the deployment.",
  Candidates.named("infraDeployments"),
);

export const InfraManagerCommands: readonly CommandSpec[] = [
  projectCommand({
    path: ["gcloud", "infra-manager", "deployments", "apply"],
    summary: "Create or update a deployment (Cloud Marketplace blueprints only).",
    positionals: [deploymentPositional],
    flags: [
      locationFlag(false),
      Flag.string(
        "service-account",
        "User-specified Service Account in the form projects/{projectID}/serviceAccounts/{serviceAccount}.",
        { required: true },
      ),
      Flag.string("gcs-source", "URI of an object in Google Cloud Storage holding the blueprint."),
      Flag.string("git-source-repo", "Repository URL of a Git blueprint (not simulated)."),
      Flag.string("local-source", "Local storage path of the blueprint (not simulated)."),
      Flag.keyvalue("input-values", "Input variable values for the Terraform blueprint."),
    ],
    permission: "config.deployments.create",
    requiredApis: [InfraManagerApi, ComputeApi],
    run: apply,
  }),
  projectCommand({
    path: ["gcloud", "infra-manager", "deployments", "list"],
    summary: "List deployments in a location.",
    flags: [locationFlag(true)],
    permission: "config.deployments.list",
    requiredApis: [InfraManagerApi],
    run: (ctx, args) => {
      const location = ParsedArgs.requiredString(args, "location");
      return Result.ok({
        world: ctx.world,
        output: CommandOutput.table(
          World.namedOf(ctx.world, "infraDeployments", ctx.project.projectId)
            .filter((d) => d.location === location)
            .map(Deployment.toRecord),
          DeploymentColumns,
        ),
      });
    },
  }),
  projectCommand({
    path: ["gcloud", "infra-manager", "deployments", "describe"],
    summary: "Describe a deployment.",
    positionals: [deploymentPositional],
    flags: [locationFlag(false)],
    permission: "config.deployments.get",
    requiredApis: [InfraManagerApi],
    run: (ctx, args) =>
      Result.map(findDeployment(ctx, args), (d) => ({
        world: ctx.world,
        output: CommandOutput.yaml({
          ...Deployment.toRecord(d),
          resources: d.resources.map((r) => ({
            type: r.type,
            name: r.name,
            ...(Option.isSome(r.zone) ? { zone: r.zone.value } : {}),
          })),
        }),
      })),
  }),
  projectCommand({
    path: ["gcloud", "infra-manager", "deployments", "delete"],
    summary: "Delete a deployment and the resources it created.",
    positionals: [deploymentPositional],
    flags: [locationFlag(false)],
    destructive: true,
    permission: "config.deployments.delete",
    requiredApis: [InfraManagerApi, ComputeApi],
    run: remove,
  }),
];
