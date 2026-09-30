import { CommandFailure } from "@/engine/cli/command-failure";
import {
  Column,
  CommandContext,
  CommandOutput,
  type CommandResult,
  type CommandSpec,
  Flag,
  OutputMessage,
  ParsedArgs,
  Positional,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import { alreadyExists, CommonFlags, projectCommand } from "@/engine/commands/shared";
import { DefaultMachineType, MachineType, type Region, type Zone } from "@/engine/domains/catalog";
import { GcloudConfig } from "@/engine/domains/gcloud-config";
import {
  CloudRunService,
  GkeCluster,
  type GkeClusterSeed,
  NodePool,
} from "@/engine/domains/managed-services";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const ContainerApi = "container.googleapis.com" as const;
const RunApi = "run.googleapis.com" as const;

const ClusterColumns = [
  Column.create("NAME", "name"),
  Column.create("LOCATION", "location"),
  Column.create("MASTER_VERSION", "currentMasterVersion"),
  Column.create("MASTER_IP", "endpoint"),
  Column.create("MACHINE_TYPE", "nodeConfig.machineType"),
  Column.create("NODE_VERSION", "currentMasterVersion"),
  Column.create("NUM_NODES", "currentNodeCount"),
  Column.create("STATUS", "status"),
];

/** `--region` があればリージョン クラスタ、無ければ `--zone` / `compute/zone` のゾーン クラスタ。 */
const resolveLocation = (
  ctx: ProjectContext,
  args: ParsedArgs,
): Result<Zone | Region, CommandFailure> => {
  const region = ParsedArgs.string(args, "region");
  return Option.isSome(region)
    ? CommandContext.resolveRegion(ctx, region)
    : CommandContext.resolveZone(ctx, ParsedArgs.string(args, "zone"));
};

const createCluster = (
  ctx: ProjectContext,
  args: ParsedArgs,
  nodes: GkeClusterSeed["nodes"],
): CommandResult => {
  const location = resolveLocation(ctx, args);
  if (!Result.isOk(location)) return location;
  const machineTypeName = Option.unwrapOr(
    ParsedArgs.string(args, "machine-type"),
    DefaultMachineType,
  );
  const machineType = Option.toResult(MachineType.parse(machineTypeName), () =>
    CommandFailure.notFound(
      `projects/${ctx.project.projectId}/zones/${location.value}/machineTypes/${machineTypeName}`,
    ),
  );
  if (!Result.isOk(machineType)) return machineType;
  const cluster = Result.mapErr(
    GkeCluster.create({
      projectId: ctx.project.projectId,
      name: ParsedArgs.requiredPositional(args, 0),
      location: location.value,
      machineType: machineType.value.name,
      nodes,
    }),
    (m) => CommandFailure.invalidValue("NAME", m),
  );
  if (!Result.isOk(cluster)) return cluster;
  const created = cluster.value;
  return Result.map(
    Result.mapErr(World.withCluster(ctx.world, created), alreadyExists),
    (world) => ({
      world: World.withConfig(
        world,
        GcloudConfig.set(world.config, "container/cluster", created.name),
      ),
      output: CommandOutput.table([GkeCluster.toRecord(created)], ClusterColumns, [
        OutputMessage.plain(`Creating cluster ${created.name} in ${created.location}... done.`),
        OutputMessage.plain(`Created [${GkeCluster.selfLink(created)}].`),
        OutputMessage.plain(`kubeconfig entry generated for ${created.name}.`),
      ]),
    }),
  );
};

/** 名前とロケーションでクラスタを引く。本物と同じく、ロケーションが違えば無いものとして扱う。 */
const clusterArg = (ctx: ProjectContext, args: ParsedArgs): Result<GkeCluster, CommandFailure> => {
  const name = ParsedArgs.requiredPositional(args, 0);
  const location = resolveLocation(ctx, args);
  if (!Result.isOk(location)) return location;
  const cluster = Option.filter(
    World.findCluster(ctx.world, ctx.project.projectId, name),
    (c) => c.location === location.value,
  );
  return Option.toResult(cluster, () =>
    CommandFailure.notFoundWith(
      `ResponseError: code=404, message=Not found: projects/${ctx.project.projectId}/locations/${location.value}/clusters/${name}.`,
    ),
  );
};

const LocationFlags = [CommonFlags.zone, CommonFlags.region];

const ReleaseChannelFlag = Flag.enum(
  "release-channel",
  "Release channel a cluster is subscribed to (accepted, not simulated).",
  ["rapid", "regular", "stable", "None"],
);

export const ContainerCommands: readonly CommandSpec[] = [
  projectCommand({
    path: ["gcloud", "container", "clusters", "create"],
    summary: "Create a GKE Standard cluster.",
    positionals: [Positional.required("NAME", "The name of the cluster to create.")],
    flags: [
      ...LocationFlags,
      Flag.integer(
        "num-nodes",
        "The number of nodes to be created in each of the cluster's zones (default 3).",
      ),
      Flag.string("machine-type", "The type of machine to use for nodes (default e2-medium)."),
      ReleaseChannelFlag,
    ],
    permission: "container.clusters.create",
    requiredApis: [ContainerApi],
    run: (ctx, args) =>
      createCluster(ctx, args, {
        kind: "standard",
        count: Option.unwrapOr(ParsedArgs.integer(args, "num-nodes"), 3),
      }),
  }),
  projectCommand({
    path: ["gcloud", "container", "clusters", "create-auto"],
    summary: "Create a GKE Autopilot cluster.",
    positionals: [Positional.required("NAME", "The name of the cluster to create.")],
    flags: [...LocationFlags, ReleaseChannelFlag],
    permission: "container.clusters.create",
    requiredApis: [ContainerApi],
    run: (ctx, args) => createCluster(ctx, args, { kind: "autopilot" }),
  }),
  projectCommand({
    path: ["gcloud", "container", "clusters", "list"],
    summary: "List existing clusters for running containers.",
    permission: "container.clusters.list",
    requiredApis: [ContainerApi],
    run: (ctx) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.table(
          World.clustersOf(ctx.world, ctx.project.projectId).map(GkeCluster.toRecord),
          ClusterColumns,
        ),
      }),
  }),
  projectCommand({
    path: ["gcloud", "container", "clusters", "describe"],
    summary: "Describe an existing cluster for running containers.",
    positionals: [Positional.required("NAME", "The name of the cluster to describe.")],
    flags: LocationFlags,
    permission: "container.clusters.get",
    requiredApis: [ContainerApi],
    run: (ctx, args) =>
      Result.map(clusterArg(ctx, args), (cluster) => ({
        world: ctx.world,
        output: CommandOutput.yaml(GkeCluster.toRecord(cluster)),
      })),
  }),
  projectCommand({
    path: ["gcloud", "container", "clusters", "delete"],
    summary: "Delete an existing cluster for running containers.",
    positionals: [Positional.required("NAME", "The name of the cluster to delete.")],
    flags: [...LocationFlags, CommonFlags.async],
    destructive: true,
    permission: "container.clusters.delete",
    requiredApis: [ContainerApi],
    run: (ctx, args) =>
      Result.map(clusterArg(ctx, args), (cluster) => ({
        world: World.withoutCluster(ctx.world, cluster),
        output: CommandOutput.messages(
          OutputMessage.plain(`Deleting cluster ${cluster.name}...done.`),
          OutputMessage.plain(`Deleted [${GkeCluster.selfLink(cluster)}].`),
        ),
      })),
  }),
  projectCommand({
    path: ["gcloud", "container", "clusters", "get-credentials"],
    summary: "Fetch credentials for a running cluster (updates kubeconfig, simulated).",
    positionals: [Positional.required("NAME", "The name of the cluster to get credentials for.")],
    flags: [
      ...LocationFlags,
      Flag.boolean(
        "internal-ip",
        "Whether to use the internal IP address of the cluster endpoint.",
      ),
    ],
    permissions: ["container.clusters.get", "container.clusters.getCredentials"],
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
            `gcloud-sim: kubectl のコンテキストを ${cluster.name} にしました（kubectl get pods / create deployment / expose / scale が使えます）。`,
          ),
        ),
      })),
  }),
  projectCommand({
    path: ["gcloud", "container", "clusters", "resize"],
    summary: "Resizes an existing cluster for running containers.",
    positionals: [Positional.required("NAME", "The name of the cluster to resize.")],
    flags: [
      ...LocationFlags,
      Flag.integer("num-nodes", "Target number of nodes in the cluster.", { required: true }),
      Flag.string(
        "node-pool",
        "The node pool to resize (accepted; the default pool is simulated).",
      ),
    ],
    destructive: true,
    permission: "container.clusters.update",
    requiredApis: [ContainerApi],
    run: (ctx, args) => {
      const cluster = clusterArg(ctx, args);
      if (!Result.isOk(cluster)) return cluster;
      const resized = Result.mapErr(
        GkeCluster.withNodeCount(
          cluster.value,
          Option.unwrapOr(ParsedArgs.integer(args, "num-nodes"), 0),
        ),
        CommandFailure.invalidState,
      );
      return Result.map(resized, (next) => ({
        world: World.replaceCluster(ctx.world, next),
        output: CommandOutput.messages(
          OutputMessage.plain(`Resizing ${next.name}...done.`),
          OutputMessage.plain(`Updated [${GkeCluster.selfLink(next)}].`),
        ),
      }));
    },
  }),
  projectCommand({
    path: ["gcloud", "container", "clusters", "upgrade"],
    summary: "Upgrade the Kubernetes version of an existing container cluster.",
    positionals: [Positional.required("NAME", "The name of the cluster to upgrade.")],
    flags: [
      ...LocationFlags,
      Flag.boolean("master", "Upgrade the cluster's master to the latest supported version."),
      Flag.string(
        "cluster-version",
        "The Kubernetes release version to upgrade to (accepted; the next version is used).",
      ),
    ],
    destructive: true,
    permission: "container.clusters.update",
    requiredApis: [ContainerApi],
    run: (ctx, args) => {
      const cluster = clusterArg(ctx, args);
      if (!Result.isOk(cluster)) return cluster;
      const upgraded = Result.mapErr(
        GkeCluster.upgraded(cluster.value),
        CommandFailure.invalidState,
      );
      return Result.map(upgraded, (next) => ({
        world: World.replaceCluster(ctx.world, next),
        output: CommandOutput.messages(
          OutputMessage.plain(`Upgrading ${next.name}...done.`),
          OutputMessage.plain(`Updated [${GkeCluster.selfLink(next)}].`),
          OutputMessage.plain(`Master version: ${next.currentMasterVersion}`),
        ),
      }));
    },
  }),
  projectCommand({
    path: ["gcloud", "container", "node-pools", "create"],
    summary: "Create a node pool in a running cluster.",
    positionals: [Positional.required("NAME", "The name of the node pool to create.")],
    flags: [
      ...LocationFlags,
      Flag.string("cluster", "The cluster to add the node pool to.", { required: true }),
      Flag.string("machine-type", "The type of machine to use for nodes (default e2-medium)."),
      Flag.integer(
        "num-nodes",
        "The number of nodes in the node pool in each of the cluster's zones (default 3).",
      ),
      Flag.integer("disk-size", "Size for node VM boot disks in GB (default 100)."),
    ],
    permission: "container.clusters.update",
    requiredApis: [ContainerApi],
    run: (ctx, args) => {
      const cluster = clusterArg(ctx, {
        ...args,
        positionals: [Option.unwrapOr(ParsedArgs.string(args, "cluster"), "")],
      });
      if (!Result.isOk(cluster)) return cluster;
      if (cluster.value.autopilot) {
        return Result.err(
          CommandFailure.invalidState(
            `Cluster ${cluster.value.name} is an Autopilot cluster; node pools are managed by GKE.`,
          ),
        );
      }
      const machineTypeName = Option.unwrapOr(
        ParsedArgs.string(args, "machine-type"),
        DefaultMachineType,
      );
      const machineType = Option.toResult(MachineType.parse(machineTypeName), () =>
        CommandFailure.notFound(
          `projects/${ctx.project.projectId}/zones/${cluster.value.location}/machineTypes/${machineTypeName}`,
        ),
      );
      if (!Result.isOk(machineType)) return machineType;
      const pool = Result.mapErr(
        NodePool.create({
          projectId: ctx.project.projectId,
          cluster: cluster.value.name,
          name: ParsedArgs.requiredPositional(args, 0),
          machineType: machineType.value.name,
          nodeCount: ParsedArgs.integer(args, "num-nodes"),
          diskSizeGb: ParsedArgs.integer(args, "disk-size"),
          version: cluster.value.currentMasterVersion,
        }),
        (m) => CommandFailure.invalidValue("NAME", m),
      );
      if (!Result.isOk(pool)) return pool;
      return Result.map(
        Result.mapErr(World.withNodePool(ctx.world, pool.value), alreadyExists),
        (world) => ({
          world,
          output: CommandOutput.table([NodePool.toRecord(pool.value)], NodePoolColumns, [
            OutputMessage.plain(`Creating node pool ${pool.value.name}...done.`),
            OutputMessage.plain(
              `Created [${GkeCluster.selfLink(cluster.value)}/nodePools/${pool.value.name}].`,
            ),
          ]),
        }),
      );
    },
  }),
  projectCommand({
    path: ["gcloud", "container", "node-pools", "list"],
    summary: "List node pools in a running cluster.",
    flags: [
      ...LocationFlags,
      Flag.string("cluster", "The cluster to list node pools for.", { required: true }),
    ],
    permission: "container.clusters.get",
    requiredApis: [ContainerApi],
    run: (ctx, args) => {
      const cluster = clusterArg(ctx, {
        ...args,
        positionals: [Option.unwrapOr(ParsedArgs.string(args, "cluster"), "")],
      });
      if (!Result.isOk(cluster)) return cluster;
      const pools = cluster.value.autopilot
        ? []
        : [NodePool.defaultPool(cluster.value), ...World.nodePoolsOf(ctx.world, cluster.value)];
      return Result.ok({
        world: ctx.world,
        output: CommandOutput.table(pools.map(NodePool.toRecord), NodePoolColumns),
      });
    },
  }),
];

const NodePoolColumns = [
  Column.create("NAME", "name"),
  Column.create("MACHINE_TYPE", "config.machineType"),
  Column.create("DISK_SIZE_GB", "config.diskSizeGb"),
  Column.create("NODE_VERSION", "version"),
];

const RunColumns = [
  Column.create("SERVICE", "metadata.name"),
  Column.create("REGION", "region"),
  Column.create("URL", "status.url"),
  Column.create("LAST DEPLOYED BY", "lastDeployedBy"),
  Column.create("LAST DEPLOYED AT", "lastDeployedAt"),
];

const RunRegionFlag = Flag.string(
  "region",
  "Region in which the resource can be found. Overrides the default run/region property.",
);

const PlatformFlag = Flag.enum(
  "platform",
  "Target platform for running commands (accepted, not simulated).",
  ["managed", "gke", "kubernetes"],
);

const runServiceArg = (
  ctx: ProjectContext,
  args: ParsedArgs,
): Result<CloudRunService, CommandFailure> => {
  const name = ParsedArgs.requiredPositional(args, 0);
  return Option.toResult(World.findRunService(ctx.world, ctx.project.projectId, name), () =>
    CommandFailure.notFoundWith(`Cannot find service [${name}]`),
  );
};

const deploy = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const region = CommandContext.resolveRegion(ctx, ParsedArgs.string(args, "region"), "run/region");
  if (!Result.isOk(region)) return region;
  const name = ParsedArgs.requiredPositional(args, 0);
  const existing = World.findRunService(ctx.world, ctx.project.projectId, name);
  const service = Result.mapErr(
    CloudRunService.create({
      projectId: ctx.project.projectId,
      name,
      region: region.value,
      image: Option.unwrapOr(ParsedArgs.string(args, "image"), ""),
      allowUnauthenticated: Option.unwrapOr(
        ParsedArgs.booleanChoice(args, "allow-unauthenticated"),
        Option.isSome(existing) ? existing.value.allowUnauthenticated : false,
      ),
      lastDeployedAt: ctx.now,
    }),
    (m) => CommandFailure.invalidValue("SERVICE", m),
  );
  if (!Result.isOk(service)) return service;
  const deployed = service.value;
  return Result.ok({
    world: World.withRunServiceReplaced(ctx.world, deployed),
    output: CommandOutput.messages(
      OutputMessage.plain(
        `Deploying container to Cloud Run service [${deployed.name}] in project [${deployed.projectId}] region [${deployed.region}]`,
      ),
      OutputMessage.plain("OK Deploying... Done."),
      OutputMessage.plain("  OK Creating Revision..."),
      OutputMessage.plain("  OK Routing traffic..."),
      ...(deployed.allowUnauthenticated ? [OutputMessage.plain("  OK Setting IAM Policy...")] : []),
      OutputMessage.plain("Done."),
      OutputMessage.plain(
        `Service [${deployed.name}] revision [${CloudRunService.revisionName(deployed)}] has been deployed and is serving 100 percent of traffic.`,
      ),
      OutputMessage.plain(`Service URL: ${CloudRunService.url(deployed)}`),
    ),
  });
};

export const RunCommands: readonly CommandSpec[] = [
  projectCommand({
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
      RunRegionFlag,
      PlatformFlag,
      Flag.boolean(
        "allow-unauthenticated",
        "Whether to enable allowing unauthenticated access to the service.",
      ),
    ],
    permission: "run.services.create",
    requiredApis: [RunApi],
    run: deploy,
  }),
  projectCommand({
    path: ["gcloud", "run", "services", "list"],
    summary: "List Cloud Run services.",
    flags: [RunRegionFlag, PlatformFlag],
    permission: "run.services.list",
    requiredApis: [RunApi],
    run: (ctx) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.table(
          World.runServicesOf(ctx.world, ctx.project.projectId).map((s) => ({
            ...CloudRunService.toRecord(s),
            lastDeployedBy: ctx.principal,
          })),
          RunColumns,
        ),
      }),
  }),
  projectCommand({
    path: ["gcloud", "run", "services", "describe"],
    summary: "Obtain details about a given service.",
    positionals: [Positional.required("SERVICE", "ID of the service.")],
    flags: [RunRegionFlag, PlatformFlag],
    permission: "run.services.get",
    requiredApis: [RunApi],
    run: (ctx, args) =>
      Result.map(runServiceArg(ctx, args), (service) => ({
        world: ctx.world,
        output: CommandOutput.yaml(CloudRunService.toRecord(service)),
      })),
  }),
  projectCommand({
    path: ["gcloud", "run", "services", "delete"],
    summary: "Delete a service.",
    positionals: [Positional.required("SERVICE", "ID of the service.")],
    flags: [RunRegionFlag, PlatformFlag],
    destructive: true,
    permission: "run.services.delete",
    requiredApis: [RunApi],
    run: (ctx, args) =>
      Result.map(runServiceArg(ctx, args), (service) => ({
        world: World.withoutRunService(ctx.world, service),
        output: CommandOutput.messages(OutputMessage.plain(`Deleted service [${service.name}].`)),
      })),
  }),
];
