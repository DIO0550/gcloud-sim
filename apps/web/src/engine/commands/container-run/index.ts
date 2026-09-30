import { CommandFailure } from "@/engine/cli/command-error";
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
import { alreadyExists, CommonFlags } from "@/engine/commands/shared";
import { DefaultMachineType, MachineType, Region, Zone } from "@/engine/domains/catalog";
import { ResourceName } from "@/engine/domains/compute";
import { GcloudConfig } from "@/engine/domains/gcloud-config";
import { CloudRunService, GkeCluster } from "@/engine/domains/managed-services";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const ContainerApi = "container.googleapis.com" as const;
const RunApi = "run.googleapis.com" as const;
const MasterVersion = "1.31.5-gke.1068000";

const ClusterColumns = [
  Column.of("NAME", "name"),
  Column.of("LOCATION", "location"),
  Column.of("MASTER_VERSION", "currentMasterVersion"),
  Column.of("MASTER_IP", "endpoint"),
  Column.of("MACHINE_TYPE", "nodeConfig.machineType"),
  Column.of("NODE_VERSION", "currentMasterVersion"),
  Column.of("NUM_NODES", "currentNodeCount"),
  Column.of("STATUS", "status"),
];

const resolveLocation = (
  ctx: ProjectContext,
  args: ParsedArgs,
): Result<Zone | Region, CommandFailure> => {
  const region = ParsedArgs.string(args, "region");
  if (Option.isSome(region)) {
    const parsed = Region.parse(region.value);
    return Option.isSome(parsed)
      ? Result.ok(parsed.value)
      : Result.err(
          CommandFailure.notFound(`projects/${ctx.project.projectId}/locations/${region.value}`),
        );
  }
  const zone = Option.or(
    ParsedArgs.string(args, "zone"),
    GcloudConfig.get(ctx.world.config, "compute/zone"),
  );
  if (!Option.isSome(zone)) return Result.err(CommandFailure.zoneRequired());
  const parsed = Zone.parse(zone.value);
  return Option.isSome(parsed)
    ? Result.ok(parsed.value)
    : Result.err(
        CommandFailure.notFound(`projects/${ctx.project.projectId}/locations/${zone.value}`),
      );
};

const createCluster = (
  ctx: ProjectContext,
  args: ParsedArgs,
  autopilot: boolean,
): CommandResult => {
  const rawName = Option.unwrapOr(ParsedArgs.positional(args, 0), "");
  const name = Result.mapErr(ResourceName.parse(rawName), (m) =>
    CommandFailure.invalidValue("NAME", m),
  );
  if (!Result.isOk(name)) return name;
  const location = resolveLocation(ctx, args);
  if (!Result.isOk(location)) return location;
  const machineTypeName = Option.unwrapOr(
    ParsedArgs.string(args, "machine-type"),
    DefaultMachineType,
  );
  const machineType = MachineType.parse(machineTypeName);
  if (!Option.isSome(machineType))
    return Result.err(
      CommandFailure.notFound(
        `projects/${ctx.project.projectId}/zones/${location.value}/machineTypes/${machineTypeName}`,
      ),
    );
  const cluster: GkeCluster = {
    projectId: ctx.project.projectId,
    name: name.value,
    location: location.value,
    nodeCount: autopilot ? 0 : Option.unwrapOr(ParsedArgs.integer(args, "num-nodes"), 3),
    autopilot,
    status: "RUNNING",
    machineType: machineType.value.name,
    currentMasterVersion: MasterVersion,
  };
  return Result.map(
    Result.mapErr(World.withCluster(ctx.world, cluster), alreadyExists),
    (world) => ({
      world: World.withConfig(
        world,
        GcloudConfig.set(world.config, "container/cluster", cluster.name),
      ),
      output: CommandOutput.table([GkeCluster.toRecord(cluster)], ClusterColumns, [
        OutputMessage.plain(`Creating cluster ${cluster.name} in ${cluster.location}... done.`),
        OutputMessage.plain(
          `Created [https://container.googleapis.com/v1/projects/${cluster.projectId}/zones/${cluster.location}/clusters/${cluster.name}].`,
        ),
        OutputMessage.plain(`kubeconfig entry generated for ${cluster.name}.`),
      ]),
    }),
  );
};

const clusterArg = (ctx: ProjectContext, args: ParsedArgs): Result<GkeCluster, CommandFailure> => {
  const name = Option.unwrapOr(ParsedArgs.positional(args, 0), "");
  const cluster = World.findCluster(ctx.world, ctx.project.projectId, name);
  return Option.isSome(cluster)
    ? Result.ok(cluster.value)
    : Result.err(
        CommandFailure.notFoundMessage(
          `ResponseError: code=404, message=Not found: projects/${ctx.project.projectId}/locations/${Option.unwrapOr(ParsedArgs.string(args, "zone"), "-")}/clusters/${name}.`,
        ),
      );
};

const ClusterCreateFlags = [
  CommonFlags.zone,
  CommonFlags.region,
  Flag.integer(
    "num-nodes",
    "The number of nodes to be created in each of the cluster's zones (default 3).",
  ),
  Flag.string("machine-type", "The type of machine to use for nodes (default e2-medium)."),
  Flag.string("cluster-version", "The Kubernetes version to use for the master and nodes."),
  Flag.enum("release-channel", "Release channel a cluster is subscribed to.", [
    "rapid",
    "regular",
    "stable",
    "None",
  ]),
  Flag.boolean("enable-autoscaling", "Enables autoscaling for a node pool."),
  Flag.integer("min-nodes", "Minimum number of nodes per zone in the node pool."),
  Flag.integer("max-nodes", "Maximum number of nodes per zone in the node pool."),
];

export const ContainerCommands: readonly CommandSpec[] = [
  {
    kind: "project",
    path: ["gcloud", "container", "clusters", "create"],
    summary: "Create a GKE Standard cluster.",
    positionals: [Positional.required("NAME", "The name of the cluster to create.")],
    flags: ClusterCreateFlags,
    destructive: false,
    requiredPermissions: ["container.clusters.create"],
    requiredApis: [ContainerApi],
    run: (ctx, args) => createCluster(ctx, args, false),
  },
  {
    kind: "project",
    path: ["gcloud", "container", "clusters", "create-auto"],
    summary: "Create a GKE Autopilot cluster.",
    positionals: [Positional.required("NAME", "The name of the cluster to create.")],
    flags: [
      CommonFlags.region,
      CommonFlags.zone,
      Flag.enum("release-channel", "Release channel a cluster is subscribed to.", [
        "rapid",
        "regular",
        "stable",
      ]),
    ],
    destructive: false,
    requiredPermissions: ["container.clusters.create"],
    requiredApis: [ContainerApi],
    run: (ctx, args) => createCluster(ctx, args, true),
  },
  {
    kind: "project",
    path: ["gcloud", "container", "clusters", "list"],
    summary: "List existing clusters for running containers.",
    positionals: [],
    flags: [CommonFlags.zone, CommonFlags.region],
    destructive: false,
    requiredPermissions: ["container.clusters.list"],
    requiredApis: [ContainerApi],
    run: (ctx) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.table(
          World.clustersOf(ctx.world, ctx.project.projectId).map(GkeCluster.toRecord),
          ClusterColumns,
        ),
      }),
  },
  {
    kind: "project",
    path: ["gcloud", "container", "clusters", "describe"],
    summary: "Describe an existing cluster for running containers.",
    positionals: [Positional.required("NAME", "The name of the cluster to describe.")],
    flags: [CommonFlags.zone, CommonFlags.region],
    destructive: false,
    requiredPermissions: ["container.clusters.get"],
    requiredApis: [ContainerApi],
    run: (ctx, args) =>
      Result.map(clusterArg(ctx, args), (cluster) => ({
        world: ctx.world,
        output: CommandOutput.yaml(GkeCluster.toRecord(cluster)),
      })),
  },
  {
    kind: "project",
    path: ["gcloud", "container", "clusters", "delete"],
    summary: "Delete an existing cluster for running containers.",
    positionals: [Positional.required("NAME", "The name of the cluster to delete.")],
    flags: [CommonFlags.zone, CommonFlags.region, CommonFlags.async],
    destructive: true,
    requiredPermissions: ["container.clusters.delete"],
    requiredApis: [ContainerApi],
    run: (ctx, args) =>
      Result.map(clusterArg(ctx, args), (cluster) => ({
        world: World.withoutCluster(ctx.world, cluster.projectId, cluster.name),
        output: CommandOutput.messages(
          OutputMessage.plain(`Deleting cluster ${cluster.name}...done.`),
          OutputMessage.plain(
            `Deleted [https://container.googleapis.com/v1/projects/${cluster.projectId}/zones/${cluster.location}/clusters/${cluster.name}].`,
          ),
        ),
      })),
  },
  {
    kind: "project",
    path: ["gcloud", "container", "clusters", "get-credentials"],
    summary: "Fetch credentials for a running cluster (updates kubeconfig, simulated).",
    positionals: [Positional.required("NAME", "The name of the cluster to get credentials for.")],
    flags: [
      CommonFlags.zone,
      CommonFlags.region,
      Flag.boolean(
        "internal-ip",
        "Whether to use the internal IP address of the cluster endpoint.",
      ),
    ],
    destructive: false,
    requiredPermissions: ["container.clusters.get", "container.clusters.getCredentials"],
    requiredApis: [ContainerApi],
    run: (ctx, args) =>
      Result.map(clusterArg(ctx, args), (cluster) => ({
        world: World.withConfig(
          ctx.world,
          GcloudConfig.set(ctx.world.config, "container/cluster", cluster.name),
        ),
        output: CommandOutput.messages(
          OutputMessage.plain("Fetching cluster endpoint and auth data."),
          OutputMessage.plain(`kubeconfig entry generated for ${cluster.name}.`),
          OutputMessage.hint(
            "gcloud-sim: kubectl は未対応です（TBD-007）。クラスタの作成・一覧・削除・認証情報の取得までを再現しています。",
          ),
        ),
      })),
  },
];

const RunColumns = [
  Column.of("SERVICE", "metadata.name"),
  Column.of("REGION", "region"),
  Column.of("URL", "status.url"),
  Column.of("LAST DEPLOYED BY", "lastDeployedBy"),
  Column.of("LAST DEPLOYED AT", "lastDeployedAt"),
];

const runRegion = (ctx: ProjectContext, args: ParsedArgs): Result<Region, CommandFailure> => {
  const raw = Option.or(
    ParsedArgs.string(args, "region"),
    GcloudConfig.get(ctx.world.config, "run/region"),
  );
  if (!Option.isSome(raw)) {
    return Result.err(
      CommandFailure.create(
        "E-004",
        "argument --region: Must be specified. gcloud-sim does not prompt for a region.",
        [
          "--region=REGION を付けるか、gcloud config set run/region REGION で既定のリージョンを設定してください。",
        ],
      ),
    );
  }
  const region = Region.parse(raw.value);
  return Option.isSome(region)
    ? Result.ok(region.value)
    : Result.err(
        CommandFailure.notFound(`projects/${ctx.project.projectId}/locations/${raw.value}`),
      );
};

const runServiceArg = (
  ctx: ProjectContext,
  args: ParsedArgs,
): Result<CloudRunService, CommandFailure> => {
  const name = Option.unwrapOr(ParsedArgs.positional(args, 0), "");
  const service = World.findRunService(ctx.world, ctx.project.projectId, name);
  return Option.isSome(service)
    ? Result.ok(service.value)
    : Result.err(CommandFailure.notFoundMessage(`Cannot find service [${name}]`));
};

export const RunCommands: readonly CommandSpec[] = [
  {
    kind: "project",
    path: ["gcloud", "run", "deploy"],
    summary: "Create or update a Cloud Run service.",
    positionals: [
      Positional.required(
        "SERVICE",
        "ID of the service or fully qualified identifier for the service.",
      ),
    ],
    flags: [
      Flag.string("image", "Name of the container image to deploy (e.g. gcr.io/cloudrun/hello).", {
        required: true,
      }),
      CommonFlags.region,
      Flag.enum("platform", "Target platform for running commands.", [
        "managed",
        "gke",
        "kubernetes",
      ]),
      Flag.boolean(
        "allow-unauthenticated",
        "Whether to enable allowing unauthenticated access to the service.",
      ),
      Flag.integer("port", "Container port to receive requests at."),
      Flag.string("memory", "Set a memory limit."),
      Flag.integer("max-instances", "The maximum number of container instances."),
      Flag.integer("min-instances", "The minimum number of container instances."),
      Flag.keyvalue("set-env-vars", "List of key-value pairs to set as environment variables."),
      Flag.string(
        "service-account",
        "Service account associated with the revision of the service.",
      ),
    ],
    destructive: false,
    requiredPermissions: ["run.services.create"],
    requiredApis: [RunApi],
    run: (ctx, args) => {
      const rawName = Option.unwrapOr(ParsedArgs.positional(args, 0), "");
      const name = Result.mapErr(ResourceName.parse(rawName), (m) =>
        CommandFailure.invalidValue("SERVICE", m),
      );
      if (!Result.isOk(name)) return name;
      const region = runRegion(ctx, args);
      if (!Result.isOk(region)) return region;
      const existing = World.findRunService(ctx.world, ctx.project.projectId, name.value);
      const service: CloudRunService = {
        projectId: ctx.project.projectId,
        name: name.value,
        region: region.value,
        image: Option.unwrapOr(ParsedArgs.string(args, "image"), ""),
        allowUnauthenticated: Option.unwrapOr(
          ParsedArgs.booleanChoice(args, "allow-unauthenticated"),
          Option.isSome(existing) ? existing.value.allowUnauthenticated : false,
        ),
        lastDeployedAt: ctx.now,
      };
      return Result.ok({
        world: World.withRunService(ctx.world, service),
        output: CommandOutput.messages(
          OutputMessage.plain(
            `Deploying container to Cloud Run service [${service.name}] in project [${service.projectId}] region [${service.region}]`,
          ),
          OutputMessage.plain("OK Deploying... Done."),
          OutputMessage.plain("  OK Creating Revision..."),
          OutputMessage.plain("  OK Routing traffic..."),
          ...(service.allowUnauthenticated
            ? [OutputMessage.plain("  OK Setting IAM Policy...")]
            : []),
          OutputMessage.plain("Done."),
          OutputMessage.plain(
            `Service [${service.name}] revision [${service.name}-00001-abc] has been deployed and is serving 100 percent of traffic.`,
          ),
          OutputMessage.plain(`Service URL: ${CloudRunService.url(service)}`),
        ),
      });
    },
  },
  {
    kind: "project",
    path: ["gcloud", "run", "services", "list"],
    summary: "List Cloud Run services.",
    positionals: [],
    flags: [
      CommonFlags.region,
      Flag.enum("platform", "Target platform for running commands.", [
        "managed",
        "gke",
        "kubernetes",
      ]),
    ],
    destructive: false,
    requiredPermissions: ["run.services.list"],
    requiredApis: [RunApi],
    run: (ctx) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.table(
          World.runServicesOf(ctx.world, ctx.project.projectId).map((s) => ({
            ...CloudRunService.toRecord(s),
            lastDeployedBy: ctx.world.session.principal,
          })),
          RunColumns,
        ),
      }),
  },
  {
    kind: "project",
    path: ["gcloud", "run", "services", "describe"],
    summary: "Obtain details about a given service.",
    positionals: [Positional.required("SERVICE", "ID of the service.")],
    flags: [
      CommonFlags.region,
      Flag.enum("platform", "Target platform for running commands.", [
        "managed",
        "gke",
        "kubernetes",
      ]),
    ],
    destructive: false,
    requiredPermissions: ["run.services.get"],
    requiredApis: [RunApi],
    run: (ctx, args) =>
      Result.map(runServiceArg(ctx, args), (service) => ({
        world: ctx.world,
        output: CommandOutput.yaml(CloudRunService.toRecord(service)),
      })),
  },
  {
    kind: "project",
    path: ["gcloud", "run", "services", "delete"],
    summary: "Delete a service.",
    positionals: [Positional.required("SERVICE", "ID of the service.")],
    flags: [
      CommonFlags.region,
      Flag.enum("platform", "Target platform for running commands.", [
        "managed",
        "gke",
        "kubernetes",
      ]),
    ],
    destructive: true,
    requiredPermissions: ["run.services.delete"],
    requiredApis: [RunApi],
    run: (ctx, args) =>
      Result.map(runServiceArg(ctx, args), (service) => ({
        world: World.withoutRunService(ctx.world, service.projectId, service.name),
        output: CommandOutput.messages(OutputMessage.plain(`Deleted service [${service.name}].`)),
      })),
  },
];
