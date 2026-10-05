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
import { alreadyExists, Candidates, CommonFlags, projectCommand } from "@/engine/commands/shared";
import { DefaultMachineType, MachineType, type Region, type Zone } from "@/engine/domains/catalog";
import { EffectivePermissions } from "@/engine/domains/effective-permissions";
import { GcloudConfig } from "@/engine/domains/gcloud-config";
import { GkeControlPlane, Ipv4 } from "@/engine/domains/gke-control-plane";
import { KubeContext } from "@/engine/domains/kube-context";
import {
  CloudRunService,
  GkeCluster,
  type GkeClusterSeed,
  NextMasterVersion,
  NodePool,
} from "@/engine/domains/managed-services";
import { Principal } from "@/engine/domains/principal";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
import {
  ControlPlaneFlags,
  controlPlaneArgs,
  createControlPlane,
  PrivateNetworkFlags,
} from "./control-plane";
import { autoscalingArgs, updatePool } from "./nodepools";

const ContainerApi = "container.googleapis.com" as const;
const RunApi = "run.googleapis.com" as const;

const clusterRecord = (world: World, cluster: GkeCluster) => ({
  ...GkeCluster.toRecord(cluster),
  nodeVersion:
    World.nodePoolsOf(world, cluster)
      .map((p) => p.version)
      .filter((v, i, all) => all.indexOf(v) === i)
      .join(",") || "-",
});

const ClusterColumns = [
  Column.create("NAME", "name"),
  Column.create("LOCATION", "location"),
  Column.create("MASTER_VERSION", "currentMasterVersion"),
  Column.create("MASTER_IP", "endpoint"),
  Column.create("MACHINE_TYPE", "nodeConfig.machineType"),
  Column.create("NODE_VERSION", "nodeVersion"),
  Column.create("NUM_NODES", "currentNodeCount"),
  Column.create("STATUS", "status"),
];

/** `--region` があればリージョン クラスタ、無ければ `--zone` / `compute/zone` のゾーン クラスタ。 */
const resolveLocation = (
  ctx: ProjectContext,
  args: ParsedArgs,
): Result<Zone | Region, CommandFailure> => {
  if (
    Option.isSome(ParsedArgs.string(args, "region")) &&
    Option.isSome(ParsedArgs.string(args, "zone"))
  )
    return Result.err(CommandFailure.invalidState("Specify either --zone or --region."));
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
  const nodeServiceAccount = Option.unwrapOr(ParsedArgs.string(args, "service-account"), "");
  if (nodeServiceAccount) {
    const sa = World.findServiceAccount(ctx.world, nodeServiceAccount);
    if (!Option.isSome(sa) || sa.value.projectId !== ctx.project.projectId)
      return Result.err(
        CommandFailure.invalidState("Node service account must exist in the cluster project."),
      );
    if (
      !EffectivePermissions.resolve(ctx.world, Principal.toMember(ctx.principal), {
        type: "service-account",
        id: nodeServiceAccount,
      }).permissions.has("iam.serviceAccounts.actAs")
    )
      return Result.err(
        CommandFailure.invalidState(
          "Permission denied: iam.serviceAccounts.actAs on node service account.",
        ),
      );
  }
  const controlPlane = createControlPlane(args, nodes.kind === "autopilot");
  if (!Result.isOk(controlPlane)) return controlPlane;
  const cluster = Result.mapErr(
    GkeCluster.create({
      projectId: ctx.project.projectId,
      name: ParsedArgs.requiredPositional(args, 0),
      location: location.value,
      machineType: machineType.value.name,
      nodeServiceAccount,
      networkPolicyEnabled: ParsedArgs.boolean(args, "enable-network-policy"),
      controlPlane: controlPlane.value,
      nodes,
    }),
    (m) => CommandFailure.invalidValue("NAME", m),
  );
  if (!Result.isOk(cluster)) return cluster;
  const references = GkeControlPlane.validate(ctx.world, cluster.value);
  if (!Result.isOk(references)) return Result.err(CommandFailure.invalidState(references.error));
  const created = cluster.value;
  return Result.map(
    Result.mapErr(World.withCluster(ctx.world, created), alreadyExists),
    (world) => ({
      world: World.withConfig(
        KubeContext.setEndpoint(
          world,
          created,
          created.controlPlane.privateEndpoint ? "private" : "public",
        ),
        GcloudConfig.set(world.config, "container/cluster", created.name),
      ),
      output: CommandOutput.table([clusterRecord(world, created)], ClusterColumns, [
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

const PoolAutoscalingFlags = [
  Flag.boolean("enable-autoscaling", "Save simulated node pool autoscaling settings."),
  Flag.integer("min-nodes", "Minimum nodes per zone (0..1000; requires --enable-autoscaling)."),
  Flag.integer("max-nodes", "Maximum nodes per zone (1..1000; requires --enable-autoscaling)."),
];
const PoolManagementFlags = [
  Flag.boolean(
    "enable-autorepair",
    "Save node auto-repair setting (no periodic repair is simulated).",
  ),
  Flag.boolean("enable-autoupgrade", "Save node auto-upgrade setting (use upgrade explicitly)."),
];
const PoolClusterFlags = [
  ...LocationFlags,
  Flag.string("cluster", "The cluster the node pool belongs to.", {
    required: true,
    candidates: Candidates.clusters,
  }),
];
const poolClusterArg = (
  ctx: ProjectContext,
  args: ParsedArgs,
): Result<GkeCluster, CommandFailure> =>
  Result.flatMap(
    clusterArg(ctx, { ...args, positionals: [ParsedArgs.requiredString(args, "cluster")] }),
    (cluster) =>
      cluster.autopilot
        ? Result.err(
            CommandFailure.invalidState(
              `Cluster ${cluster.name} is an Autopilot cluster; node pools are managed by GKE.`,
            ),
          )
        : Result.ok(cluster),
  );
const poolArg = (
  ctx: ProjectContext,
  cluster: GkeCluster,
  name: string,
): Result<NodePool, CommandFailure> =>
  Option.toResult(
    Option.fromNullable(World.nodePoolsOf(ctx.world, cluster).find((p) => p.name === name)),
    () =>
      CommandFailure.notFoundWith(
        `ResponseError: code=404, message=Not found: projects/${ctx.project.projectId}/locations/${cluster.location}/clusters/${cluster.name}/nodePools/${name}.`,
      ),
  );

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
      ...PrivateNetworkFlags,
      Flag.boolean(
        "enable-ip-alias",
        "Required for private Standard cluster creation here; secondary range allocation is not simulated.",
      ),
      Flag.integer(
        "num-nodes",
        "The number of nodes to be created in each of the cluster's zones (default 3).",
      ),
      Flag.string("machine-type", "The type of machine to use for nodes (default e2-medium)."),
      Flag.boolean(
        "enable-network-policy",
        "Enable simulated NetworkPolicy enforcement on the new Standard cluster.",
      ),
      ReleaseChannelFlag,
      Flag.string(
        "service-account",
        "Existing node service account email for Artifact Registry pulls.",
      ),
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
    flags: [
      ...LocationFlags,
      ...PrivateNetworkFlags,
      ReleaseChannelFlag,
      Flag.string(
        "service-account",
        "Existing node service account email for Artifact Registry pulls.",
      ),
    ],
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
          World.clustersOf(ctx.world, ctx.project.projectId).map((c) =>
            clusterRecord(ctx.world, c),
          ),
          ClusterColumns,
        ),
      }),
  }),
  projectCommand({
    path: ["gcloud", "container", "clusters", "describe"],
    summary: "Describe an existing cluster for running containers.",
    positionals: [
      Positional.required("NAME", "The name of the cluster to describe.", Candidates.clusters),
    ],
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
    positionals: [
      Positional.required("NAME", "The name of the cluster to delete.", Candidates.clusters),
    ],
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
    positionals: [
      Positional.required(
        "NAME",
        "The name of the cluster to get credentials for.",
        Candidates.clusters,
      ),
    ],
    flags: [
      ...LocationFlags,
      Flag.boolean(
        "internal-ip",
        "Whether to use the internal IP address of the cluster endpoint.",
      ),
    ],
    permissions: ["container.clusters.get", "container.clusters.getCredentials"],
    requiredApis: [ContainerApi],
    run: (ctx, args) => {
      const found = clusterArg(ctx, args);
      if (!Result.isOk(found)) return found;
      const cluster = found.value;
      const internal = Option.unwrapOr(
        ParsedArgs.booleanChoice(args, "internal-ip"),
        cluster.controlPlane.privateEndpoint,
      );
      const endpoint = internal ? "private" : "public";
      const address = GkeControlPlane.endpoint(cluster.controlPlane, endpoint);
      if (!Option.isSome(address))
        return Result.err(
          CommandFailure.invalidState(
            `The ${endpoint} endpoint is unavailable on this simulated cluster.`,
          ),
        );
      return Result.ok({
        world: World.withConfig(
          KubeContext.setEndpoint(ctx.world, cluster, endpoint),
          GcloudConfig.set(ctx.world.config, "container/cluster", cluster.name),
        ),
        output: CommandOutput.messages(
          OutputMessage.plain("Fetching cluster endpoint and auth data."),
          OutputMessage.plain(`kubeconfig entry generated for ${cluster.name}.`),
          OutputMessage.plain(`Endpoint: ${endpoint} (https://${address.value}).`),
          OutputMessage.hint(
            "gcloud-sim: 認証情報の取得はネットワーク到達を保証しません。sim gke check-control-planeで送信元を明示して確認してください。kubectlはネットワークを再現しない操作モデルです。",
          ),
        ),
      });
    },
  }),
  projectCommand({
    path: ["gcloud", "container", "clusters", "update"],
    summary: "Update simulated private endpoint and authorized network settings.",
    positionals: [Positional.required("NAME", "Cluster name.", Candidates.clusters)],
    flags: [...LocationFlags, ...ControlPlaneFlags],
    permission: "container.clusters.update",
    requiredApis: [ContainerApi],
    run: (ctx, args) => {
      const found = clusterArg(ctx, args);
      if (!Result.isOk(found)) return found;
      if (!ControlPlaneFlags.some((f) => ParsedArgs.has(args, f.name)))
        return Result.err(
          CommandFailure.invalidState("Specify a control plane setting to update."),
        );
      return Result.map(controlPlaneArgs(args, found.value.controlPlane), (controlPlane) => ({
        world: World.replaceCluster(ctx.world, { ...found.value, controlPlane }),
        output: CommandOutput.messages(
          OutputMessage.plain(
            `Updated control plane settings for ${found.value.name}. Previous check cleared; evaluate access again.`,
          ),
        ),
      }));
    },
  }),
  projectCommand({
    path: ["sim", "gke", "check-control-plane"],
    summary: "Evaluate one declared source against simulated GKE endpoint/VPC/CIDR settings.",
    positionals: [Positional.required("NAME", "Cluster name.", Candidates.clusters)],
    flags: [
      ...LocationFlags,
      Flag.enum(
        "endpoint",
        "Endpoint to evaluate (independent of credentials).",
        ["public", "private"],
        { required: true },
      ),
      Flag.string("source-ip", "Canonical source IPv4 address.", { required: true }),
      Flag.string(
        "source-network",
        "Source VPC in the cluster project; private access needs a same-region subnet IP.",
        { candidates: Candidates.networks },
      ),
    ],
    permission: "container.clusters.get",
    requiredApis: [ContainerApi],
    run: (ctx, args) => {
      const found = clusterArg(ctx, args);
      if (!Result.isOk(found)) return found;
      const sourceIp = ParsedArgs.requiredString(args, "source-ip");
      if (!Option.isSome(Ipv4.address(sourceIp)))
        return Result.err(
          CommandFailure.invalidState("source-ip must be a canonical IPv4 address."),
        );
      const sourceNetwork = Option.unwrapOr(ParsedArgs.string(args, "source-network"), "");
      if (
        sourceNetwork &&
        !ctx.world.networks.some(
          (n) => n.projectId === ctx.project.projectId && n.name === sourceNetwork,
        )
      )
        return Result.err(CommandFailure.notFound(`networks/${sourceNetwork}`));
      const check = GkeControlPlane.evaluate(ctx.world, found.value, {
        endpoint: ParsedArgs.requiredString(args, "endpoint") as "public" | "private",
        sourceIp,
        sourceNetwork,
      });
      const next = {
        ...found.value,
        controlPlane: { ...found.value.controlPlane, lastCheck: Option.some(check) },
      };
      return Result.ok({
        world: World.replaceCluster(ctx.world, next),
        output: CommandOutput.table(
          [{ ...check, result: check.allowed ? "ALLOW" : "DENY" }],
          [
            Column.create("ENDPOINT", "endpoint"),
            Column.create("SOURCE_IP", "sourceIp"),
            Column.create("SOURCE_VPC", "sourceNetwork"),
            Column.create("RESULT", "result"),
            Column.create("REASON", "reason"),
          ],
          [
            OutputMessage.hint(
              "gcloud-sim: 明示した送信元の教材評価です。認証/RBAC・実通信・経路/NAT/VPN/peeringは再現しません。kubectlの疎通結果ではありません。",
            ),
          ],
        ),
      });
    },
  }),
  projectCommand({
    path: ["gcloud", "container", "clusters", "resize"],
    summary: "Resizes an existing cluster for running containers.",
    positionals: [
      Positional.required("NAME", "The name of the cluster to resize.", Candidates.clusters),
    ],
    flags: [
      ...LocationFlags,
      Flag.integer("num-nodes", "Target number of nodes in the cluster.", { required: true }),
      Flag.string("node-pool", "The node pool to resize (default default-pool).", {
        candidates: Candidates.nodePools,
      }),
    ],
    destructive: true,
    permission: "container.clusters.update",
    requiredApis: [ContainerApi],
    run: (ctx, args) => {
      const cluster = clusterArg(ctx, args);
      if (!Result.isOk(cluster)) return cluster;
      if (cluster.value.autopilot)
        return Result.err(
          CommandFailure.invalidState(
            `Cluster ${cluster.value.name} is an Autopilot cluster; node count is managed by GKE and cannot be resized.`,
          ),
        );
      const pool = poolArg(
        ctx,
        cluster.value,
        Option.unwrapOr(ParsedArgs.string(args, "node-pool"), "default-pool"),
      );
      if (!Result.isOk(pool)) return pool;
      return Result.map(
        Result.mapErr(
          NodePool.resize(pool.value, Option.unwrapOr(ParsedArgs.integer(args, "num-nodes"), 0)),
          CommandFailure.invalidState,
        ),
        (next) => ({
          world: World.replaceNodePool(ctx.world, next),
          output: CommandOutput.messages(
            OutputMessage.plain(`Resizing node pool ${next.name}...done.`),
            OutputMessage.plain(`Node count: ${next.nodeCount} (per zone; simulated).`),
          ),
        }),
      );
    },
  }),
  projectCommand({
    path: ["gcloud", "container", "clusters", "upgrade"],
    summary: "Upgrade the Kubernetes version of an existing container cluster.",
    positionals: [
      Positional.required("NAME", "The name of the cluster to upgrade.", Candidates.clusters),
    ],
    flags: [
      ...LocationFlags,
      Flag.boolean("master", "Upgrade the cluster's master to the latest supported version."),
      Flag.string("node-pool", "Upgrade only this Standard node pool.", {
        candidates: Candidates.nodePools,
      }),
      Flag.string("cluster-version", "The supported Kubernetes release version to upgrade to."),
    ],
    destructive: true,
    permission: "container.clusters.update",
    requiredApis: [ContainerApi],
    run: (ctx, args) => {
      const cluster = clusterArg(ctx, args);
      if (!Result.isOk(cluster)) return cluster;
      const master = ParsedArgs.boolean(args, "master");
      const poolName = ParsedArgs.string(args, "node-pool");
      const target = ParsedArgs.string(args, "cluster-version");
      if (master && Option.isSome(poolName))
        return Result.err(
          CommandFailure.invalidState("--master and --node-pool cannot be combined."),
        );
      if (master) {
        if (Option.isSome(target) && target.value !== NextMasterVersion)
          return Result.err(
            CommandFailure.invalidState(`Supported master upgrade version: ${NextMasterVersion}.`),
          );
        return Result.map(
          Result.mapErr(GkeCluster.upgraded(cluster.value), CommandFailure.invalidState),
          (next) => ({
            world: World.replaceCluster(ctx.world, next),
            output: CommandOutput.messages(
              OutputMessage.plain(`Upgrading ${next.name} control plane...done.`),
              OutputMessage.plain(`Master version: ${next.currentMasterVersion}`),
            ),
          }),
        );
      }
      if (!Option.isSome(poolName))
        return Result.err(
          CommandFailure.invalidState("Specify --master or an explicit --node-pool on gcloud-sim."),
        );
      if (cluster.value.autopilot)
        return Result.err(CommandFailure.invalidState("Autopilot node pools are managed by GKE."));
      const pool = poolArg(ctx, cluster.value, poolName.value);
      if (!Result.isOk(pool)) return pool;
      return Result.map(
        Result.mapErr(
          NodePool.upgrade(
            pool.value,
            cluster.value.currentMasterVersion,
            Option.unwrapOr(target, cluster.value.currentMasterVersion),
          ),
          CommandFailure.invalidState,
        ),
        (next) => ({
          world: World.replaceNodePool(ctx.world, next),
          output: CommandOutput.messages(
            OutputMessage.plain(`Upgrading node pool ${next.name}...done.`),
            OutputMessage.plain(`Node version: ${next.version}`),
          ),
        }),
      );
    },
  }),
  projectCommand({
    path: ["gcloud", "container", "node-pools", "create"],
    summary: "Create a node pool in a running cluster.",
    positionals: [Positional.required("NAME", "The name of the node pool to create.")],
    flags: [
      ...LocationFlags,
      Flag.string("cluster", "The cluster to add the node pool to.", {
        required: true,
        candidates: Candidates.clusters,
      }),
      Flag.string("machine-type", "The type of machine to use for nodes (default e2-medium)."),
      ...PoolAutoscalingFlags,
      ...PoolManagementFlags,
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
        positionals: [ParsedArgs.requiredString(args, "cluster")],
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
      const autoscaling = autoscalingArgs(args, Option.none);
      if (!Result.isOk(autoscaling)) return autoscaling;
      const pool = Result.mapErr(
        NodePool.create({
          projectId: ctx.project.projectId,
          cluster: cluster.value.name,
          name: ParsedArgs.requiredPositional(args, 0),
          machineType: machineType.value.name,
          nodeCount: ParsedArgs.integer(args, "num-nodes"),
          diskSizeGb: ParsedArgs.integer(args, "disk-size"),
          version: cluster.value.currentMasterVersion,
          autoscaling: autoscaling.value,
          autoRepair: Option.unwrapOr(ParsedArgs.booleanChoice(args, "enable-autorepair"), true),
          autoUpgrade: Option.unwrapOr(ParsedArgs.booleanChoice(args, "enable-autoupgrade"), true),
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
      Flag.string("cluster", "The cluster to list node pools for.", {
        required: true,
        candidates: Candidates.clusters,
      }),
    ],
    permission: "container.clusters.get",
    requiredApis: [ContainerApi],
    run: (ctx, args) => {
      const cluster = clusterArg(ctx, {
        ...args,
        positionals: [ParsedArgs.requiredString(args, "cluster")],
      });
      if (!Result.isOk(cluster)) return cluster;
      return Result.ok({
        world: ctx.world,
        output: CommandOutput.table(
          World.nodePoolsOf(ctx.world, cluster.value).map(NodePool.toRecord),
          NodePoolColumns,
        ),
      });
    },
  }),
  projectCommand({
    path: ["gcloud", "container", "node-pools", "describe"],
    summary: "Describe an existing node pool for a cluster.",
    positionals: [Positional.required("NAME", "The name of the node pool.", Candidates.nodePools)],
    flags: [
      ...LocationFlags,
      Flag.string("cluster", "The cluster the node pool belongs to.", {
        required: true,
        candidates: Candidates.clusters,
      }),
    ],
    permission: "container.clusters.get",
    requiredApis: [ContainerApi],
    run: (ctx, args) => {
      const cluster = clusterArg(ctx, {
        ...args,
        positionals: [ParsedArgs.requiredString(args, "cluster")],
      });
      if (!Result.isOk(cluster)) return cluster;
      const name = ParsedArgs.requiredPositional(args, 0);
      const pool = Option.toResult(
        Option.fromNullable(
          World.nodePoolsOf(ctx.world, cluster.value).find((p) => p.name === name),
        ),
        () =>
          CommandFailure.notFoundWith(
            `ResponseError: code=404, message=Not found: projects/${ctx.project.projectId}/locations/${cluster.value.location}/clusters/${cluster.value.name}/nodePools/${name}.`,
          ),
      );
      return Result.map(pool, (p) => ({
        world: ctx.world,
        output: CommandOutput.yaml(NodePool.toRecord(p)),
      }));
    },
  }),
  projectCommand({
    path: ["gcloud", "container", "node-pools", "update"],
    summary: "Update simulated autoscaling or node management settings.",
    positionals: [Positional.required("NAME", "The node pool to update.", Candidates.nodePools)],
    flags: [...PoolClusterFlags, ...PoolAutoscalingFlags, ...PoolManagementFlags],
    permission: "container.clusters.update",
    requiredApis: [ContainerApi],
    run: (ctx, args) =>
      Result.flatMap(poolClusterArg(ctx, args), (cluster) =>
        Result.flatMap(poolArg(ctx, cluster, ParsedArgs.requiredPositional(args, 0)), (pool) =>
          Result.map(updatePool(pool, args), (next) => ({
            world: World.replaceNodePool(ctx.world, next),
            output: CommandOutput.yaml(NodePool.toRecord(next)),
          })),
        ),
      ),
  }),
  projectCommand({
    path: ["gcloud", "container", "node-pools", "delete"],
    summary: "Delete a Standard node pool (no Pod scheduling is simulated).",
    positionals: [Positional.required("NAME", "The node pool to delete.", Candidates.nodePools)],
    flags: PoolClusterFlags,
    permission: "container.clusters.update",
    requiredApis: [ContainerApi],
    destructive: true,
    run: (ctx, args) =>
      Result.flatMap(poolClusterArg(ctx, args), (cluster) =>
        Result.map(poolArg(ctx, cluster, ParsedArgs.requiredPositional(args, 0)), (pool) => ({
          world: World.withoutNodePool(ctx.world, pool),
          output: CommandOutput.messages(
            OutputMessage.plain(`Deleted node pool ${pool.name}. No Pod scheduling is simulated.`),
          ),
        })),
      ),
  }),
  projectCommand({
    path: ["sim", "gke", "autoscale-nodes"],
    summary: "Evaluate one node pool's bounds using explicit simulated required nodes.",
    positionals: [Positional.required("NAME", "The node pool to evaluate.", Candidates.nodePools)],
    flags: [
      ...PoolClusterFlags,
      Flag.integer(
        "required-nodes",
        "Explicit nodes needed per zone; not derived from CPU usage or Pod placement.",
        { required: true },
      ),
    ],
    permission: "container.clusters.update",
    requiredApis: [ContainerApi],
    run: (ctx, args) =>
      Result.flatMap(poolClusterArg(ctx, args), (cluster) =>
        Result.flatMap(poolArg(ctx, cluster, ParsedArgs.requiredPositional(args, 0)), (pool) =>
          Result.map(
            Result.mapErr(
              NodePool.scale(pool, Option.unwrapOr(ParsedArgs.integer(args, "required-nodes"), 0)),
              CommandFailure.invalidState,
            ),
            (next) => ({
              world: World.replaceNodePool(ctx.world, next),
              output: CommandOutput.messages(
                OutputMessage.plain(`Node pool: ${next.name}`),
                OutputMessage.plain(
                  `Required nodes: ${Option.unwrapOr(ParsedArgs.integer(args, "required-nodes"), 0)} → ${pool.nodeCount} → ${next.nodeCount} (per zone; bounded).`,
                ),
                OutputMessage.hint(
                  "Explicit simulated demand only. No Pod scheduling, CPU measurement, periodic autoscaling or real nodes.",
                ),
              ),
            }),
          ),
        ),
      ),
  }),
];

const NodePoolColumns = [
  Column.create("NAME", "name"),
  Column.create("MACHINE_TYPE", "config.machineType"),
  Column.create("DISK_SIZE_GB", "config.diskSizeGb"),
  Column.create("NODE_VERSION", "version"),
  Column.create("NUM_NODES", "initialNodeCount"),
  Column.create("AUTOSCALING", "autoscaling.enabled"),
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
  { candidates: Candidates.regions },
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
      image: ParsedArgs.requiredString(args, "image"),
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
    positionals: [Positional.required("SERVICE", "ID of the service.", Candidates.runServices)],
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
    positionals: [Positional.required("SERVICE", "ID of the service.", Candidates.runServices)],
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
