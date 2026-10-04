import { CommandFailure } from "@/engine/cli/command-failure";
import {
  Column,
  CommandOutput,
  type CommandResult,
  type CommandSpec,
  Flag,
  type FlagSpec,
  type JsonRecord,
  OutputMessage,
  ParsedArgs,
  Positional,
  type PositionalSpec,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import { Candidates, projectCommand } from "@/engine/commands/shared";
import { GcloudConfig } from "@/engine/domains/gcloud-config";
import { ImagePull } from "@/engine/domains/image-pull";
import { KubeConfig, KubeEnv, KubeRuntime } from "@/engine/domains/kube-config";
import {
  KubeDeployment,
  KubePod,
  KubeService,
  KubeServiceType,
  KubeServiceTypes,
} from "@/engine/domains/kubernetes";
import type { GkeCluster } from "@/engine/domains/managed-services";
import { SampleFile } from "@/engine/domains/sample-files";
import { type AlreadyExists, World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
import { createConfig, kubePermission, setEnv } from "./configuration";

/**
 * `kubectl`（TBD-007）。コンテキストは `get-credentials` が書いた `container/cluster` で、
 * そのクラスタの Deployment / Service を World に持ち、Pod は Deployment から導出する。
 * 失敗の綴りは kubectl のもの（`error:` / `Error from server`）で、shell は接頭辞を付けない。
 */

const ContainerApi = "container.googleapis.com" as const;

const refused = (): CommandFailure =>
  CommandFailure.notFoundWith(
    "The connection to the server localhost:8080 was refused - did you specify the right host or port?\ngcloud-sim: 先に gcloud container clusters get-credentials CLUSTER でコンテキストを作ってください。",
  );

/** 現在のコンテキストのクラスタ（`container/cluster` が指すもの）。 */
const currentClusterOf = (ctx: ProjectContext): Option<GkeCluster> =>
  Option.flatMap(GcloudConfig.get(ctx.world.config, "container/cluster"), (n) =>
    World.findCluster(ctx.world, ctx.project.projectId, n),
  );

/** 現在のコンテキストのクラスタ。`container/cluster` が無い・指す先が無ければ refused。 */
const currentCluster = (ctx: ProjectContext): Result<GkeCluster, CommandFailure> =>
  Option.toResult(currentClusterOf(ctx), refused);

const contextName = (cluster: GkeCluster): string =>
  `gke_${cluster.projectId}_${cluster.location}_${cluster.name}`;

/** E-008 を kubectl の綴り（`Error from server (AlreadyExists): deployments.apps "web" already exists`）で。 */
const kubeAlreadyExists = (failure: AlreadyExists): CommandFailure =>
  CommandFailure.alreadyExistsWith(
    `Error from server (AlreadyExists): ${failure.resource} already exists`,
  );

const notFound = (kind: string, name: string): CommandFailure =>
  CommandFailure.notFoundWith(`Error from server (NotFound): ${kind} "${name}" not found`);

/** kubectl の使い方の誤り（`error: ...` は Shell が頭に付ける）。 */
const usage = (message: string): CommandFailure => CommandFailure.invalidArgumentWith(message);

/** `deployment`, `deploy`, `deployments`, `deployment/web` の綴りを種別と名前に分ける。 */
type ResourceRef = Readonly<{
  kind: "deployment" | "service" | "pod" | "node" | "replicaset" | "configmap" | "secret" | "all";
  name: Option<string>;
}>;

const ResourceAliases: Readonly<Record<string, ResourceRef["kind"]>> = {
  configmap: "configmap",
  configmaps: "configmap",
  cm: "configmap",
  secret: "secret",
  secrets: "secret",
  rs: "replicaset",
  replicaset: "replicaset",
  replicasets: "replicaset",
  "replicasets.apps": "replicaset",
  deployment: "deployment",
  deployments: "deployment",
  deploy: "deployment",
  "deployment.apps": "deployment",
  "deployments.apps": "deployment",
  service: "service",
  services: "service",
  svc: "service",
  pod: "pod",
  pods: "pod",
  po: "pod",
  node: "node",
  nodes: "node",
  all: "all",
};

const parseResource = (type: string, name: Option<string>): Result<ResourceRef, CommandFailure> => {
  const slash = type.indexOf("/");
  const kindText = slash === -1 ? type : type.slice(0, slash);
  const inline = slash === -1 ? Option.none : Option.some(type.slice(slash + 1));
  const kind = ResourceAliases[kindText.toLowerCase()];
  if (kind === undefined) {
    return Result.err(
      CommandFailure.invalidValue(
        "",
        `error: the server doesn't have a resource type "${kindText}"\ngcloud-sim: 対応しているのは deployments / services / pods / nodes / replicasets / configmaps / secrets です。`,
      ),
    );
  }
  return Result.ok({ kind, name: Option.or(inline, name) });
};

/** クラスタ内の IP の採番。ClusterIP は 10.20、外部 IP は 34.85 系。 */
const clusterIp = (sequence: number): string => `10.20.${(sequence >> 8) % 256}.${sequence % 256}`;
const loadBalancerIp = (sequence: number): string =>
  `34.85.${(sequence >> 8) % 256}.${sequence % 256}`;

const DeploymentColumns = [
  Column.create("NAME", "name"),
  Column.create("READY", "ready"),
  Column.create("UP-TO-DATE", "upToDate"),
  Column.create("AVAILABLE", "available"),
  Column.create("AGE", "age"),
];
const PodColumns = [
  Column.create("NAME", "name"),
  Column.create("READY", "ready"),
  Column.create("STATUS", "status"),
  Column.create("RESTARTS", "restarts"),
  Column.create("AGE", "age"),
];
const ServiceColumns = [
  Column.create("NAME", "name"),
  Column.create("TYPE", "type"),
  Column.create("CLUSTER-IP", "clusterIp"),
  Column.create("EXTERNAL-IP", "externalIp"),
  Column.create("PORT(S)", "ports"),
  Column.create("AGE", "age"),
];
const NodeColumns = [
  Column.create("NAME", "name"),
  Column.create("STATUS", "status"),
  Column.create("ROLES", "roles"),
  Column.create("AGE", "age"),
  Column.create("VERSION", "version"),
];

/** 経過時間の綴り（`kubectl get` の AGE）。 */
const age = (createdAt: string, now: string): string => {
  const seconds = Math.max(0, Math.floor((Date.parse(now) - Date.parse(createdAt)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
};

const deploymentRow = (
  d: KubeDeployment,
  now: string,
  error: string,
  ready = error ? 0 : d.replicas,
): JsonRecord => ({
  ...KubeDeployment.toRecord(d),
  status: {
    replicas: d.replicas,
    readyReplicas: ready,
    availableReplicas: ready,
    updatedReplicas: d.replicas,
    observedGeneration: d.generation,
  },
  name: d.name,
  ready: `${ready}/${d.replicas}`,
  imagePullError: error.startsWith("ImagePull") ? error : "",
  containerError: error,
  upToDate: d.replicas,
  available: ready,
  age: age(d.createdAt, now),
});

const podRow = (
  pod: KubePod,
  deployment: KubeDeployment,
  now: string,
  error: string,
): JsonRecord => ({
  ...KubePod.toRecord(pod),
  spec: {
    containers: [
      { name: deployment.name, image: pod.image, env: deployment.env.map(KubeEnv.toRecord) },
    ],
  },
  name: pod.name,
  ready: error ? "0/1" : "1/1",
  status: error ? (error.split(":")[0] ?? "Pending") : pod.status,
  imagePullError: error.startsWith("ImagePull") ? error : "",
  containerError: error,
  restarts: pod.restarts,
  age: age(deployment.createdAt, now),
});

const podError = (world: World, cluster: GkeCluster, d: KubeDeployment, name: string): string =>
  ImagePull.error(world, cluster, d.image) || KubeRuntime.error(world.kubeConfigs, d, name);
const deploymentErrors = (
  world: World,
  cluster: GkeCluster,
  d: KubeDeployment,
): readonly string[] => KubePod.fromDeployment(d).map((p) => podError(world, cluster, d, p.name));
const deploymentListing = (
  ctx: ProjectContext,
  cluster: GkeCluster,
  d: KubeDeployment,
): JsonRecord => {
  const errors = deploymentErrors(ctx.world, cluster, d);
  return deploymentRow(d, ctx.now, errors.find(Boolean) ?? "", errors.filter((e) => !e).length);
};

const serviceRow = (s: KubeService, now: string): JsonRecord => ({
  ...KubeService.toRecord(s),
  name: s.name,
  type: s.type,
  clusterIp: s.clusterIp,
  externalIp: Option.unwrapOr(
    s.externalIp,
    s.type === KubeServiceTypes.LoadBalancer ? "<pending>" : "<none>",
  ),
  ports: KubeService.portsText(s),
  age: age(s.createdAt, now),
});

const nodeRows = (cluster: GkeCluster, now: string): readonly JsonRecord[] =>
  Array.from({ length: cluster.autopilot ? 1 : cluster.nodeCount }, (_, i) => ({
    name: `gke-${cluster.name}-default-pool-${(0x3a1f + i).toString(16)}-${["k2xq", "m8pd", "v4rt"][i % 3]}`,
    status: "Ready",
    roles: "<none>",
    age: age(now, now),
    version: `v${cluster.currentMasterVersion.replace(/-gke\.\d+$/, "")}`,
  }));

type Listing = Readonly<{ rows: readonly JsonRecord[]; columns: readonly Column[] }>;

/**
 * 名前があればその 1 件（無ければ NotFound）、無ければ全件。
 *
 * @param items 候補
 * @param kind NotFound に出す種別
 * @param name `get TYPE NAME` の NAME
 * @returns 絞った並び
 */
const pick = <T extends { name: string }>(
  items: readonly T[],
  kind: string,
  name: Option<string>,
): Result<readonly T[], CommandFailure> => {
  if (!Option.isSome(name)) return Result.ok(items);
  const found = items.find((i) => i.name === name.value);
  return found === undefined ? Result.err(notFound(kind, name.value)) : Result.ok([found]);
};

/** `get` / `describe` の対象を集める。 */
const collect = (
  ctx: ProjectContext,
  cluster: GkeCluster,
  ref: ResourceRef,
  describe = false,
): Result<Listing, CommandFailure> => {
  const deployments = World.kubeDeploymentsOf(ctx.world, cluster);
  const pods = deployments.flatMap((d) =>
    KubePod.fromDeployment(d).map((pod) => ({
      name: pod.name,
      row: podRow(pod, d, ctx.now, podError(ctx.world, cluster, d, pod.name)),
    })),
  );
  const services = World.kubeServicesOf(ctx.world, cluster);
  switch (ref.kind) {
    case "configmap":
    case "secret": {
      const configs = ctx.world.kubeConfigs.filter(
        (c) =>
          c.projectId === cluster.projectId && c.cluster === cluster.name && c.kind === ref.kind,
      );
      return Result.map(pick(configs, ref.kind, ref.name), (entries) => ({
        rows: entries.map((c) => ({
          ...KubeConfig.toRecord(c, describe),
          name: c.name,
          count: c.data.length,
          age: age(c.createdAt, ctx.now),
        })),
        columns: [
          Column.create("NAME", "name"),
          ...(ref.kind === "secret" ? [Column.create("TYPE", "type")] : []),
          Column.create("DATA", "count"),
          Column.create("AGE", "age"),
        ],
      }));
    }
    case "replicaset": {
      const rows = deployments.flatMap((d) =>
        d.revisions.map((r) => {
          const replicas = r.revision === d.revision ? d.replicas : 0;
          const ready = replicas
            ? deploymentErrors(ctx.world, cluster, d).filter((e) => !e).length
            : 0;
          const name = `${d.name}-${KubeDeployment.replicaSetHash(d, r.templateId)}`;
          return {
            apiVersion: "apps/v1",
            kind: "ReplicaSet",
            name,
            desired: replicas,
            current: replicas,
            ready,
            metadata: {
              name,
              namespace: "default",
              annotations: { "deployment.kubernetes.io/revision": String(r.revision) },
              ownerReferences: [{ kind: "Deployment", name: d.name }],
            },
            spec: {
              replicas,
              template: {
                spec: {
                  containers: [{ name: d.name, image: r.image, env: r.env.map(KubeEnv.toRecord) }],
                },
              },
            },
            status: { replicas, readyReplicas: ready },
          };
        }),
      );
      return Result.map(pick(rows, "replicasets.apps", ref.name), (rows) => ({
        rows,
        columns: [
          Column.create("NAME", "name"),
          Column.create("DESIRED", "desired"),
          Column.create("CURRENT", "current"),
          Column.create("READY", "ready"),
        ],
      }));
    }
    case "deployment":
      return Result.map(pick(deployments, "deployments.apps", ref.name), (rows) => ({
        rows: rows.map((d) => deploymentListing(ctx, cluster, d)),
        columns: DeploymentColumns,
      }));
    case "service":
      return Result.map(pick(services, "services", ref.name), (rows) => ({
        rows: rows.map((s) => serviceRow(s, ctx.now)),
        columns: ServiceColumns,
      }));
    case "pod":
      return Result.map(pick(pods, "pods", ref.name), (rows) => ({
        rows: rows.map((p) => p.row),
        columns: PodColumns,
      }));
    case "node": {
      const nodes = nodeRows(cluster, ctx.now).map((n) => ({ ...n, name: String(n.name) }));
      return Result.map(pick(nodes, "nodes", ref.name), (rows) => ({ rows, columns: NodeColumns }));
    }
    case "all":
      return Result.ok({
        rows: [
          ...pods.map((p) => ({ ...p.row, name: `pod/${p.name}` })),
          ...services.map((s) => ({ ...serviceRow(s, ctx.now), name: `service/${s.name}` })),
          ...deployments.map((d) => ({
            ...deploymentListing(ctx, cluster, d),
            name: `deployment.apps/${d.name}`,
          })),
        ],
        columns: [
          Column.create("NAME", "name"),
          Column.create("READY", "ready"),
          Column.create("STATUS", "status"),
          Column.create("AGE", "age"),
        ],
      });
  }
};

const get = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const cluster = currentCluster(ctx);
  if (!Result.isOk(cluster)) return cluster;
  const ref = parseResource(ParsedArgs.requiredPositional(args, 0), ParsedArgs.positional(args, 1));
  if (!Result.isOk(ref)) return ref;
  const collected = collect(ctx, cluster.value, ref.value);
  if (!Result.isOk(collected)) return collected;
  const { rows, columns } = collected.value;
  const output = ParsedArgs.string(args, "output");
  if (Option.isSome(output) && output.value === "json") {
    const data =
      Option.isSome(ref.value.name) && rows.length === 1
        ? rows[0]
        : { apiVersion: "v1", kind: "List", items: rows };
    return Result.ok({
      world: ctx.world,
      output: { ...CommandOutput.yaml(data ?? {}), defaultFormat: "json" },
    });
  }
  if (Option.isSome(output) && output.value === "yaml") {
    return Result.ok({ world: ctx.world, output: CommandOutput.yamlList(rows) });
  }
  if (rows.length === 0) {
    return Result.ok({
      world: ctx.world,
      output: CommandOutput.messages(
        OutputMessage.plain("No resources found in default namespace."),
      ),
    });
  }
  return Result.ok({ world: ctx.world, output: CommandOutput.table(rows, columns) });
};

const createDeployment = (
  ctx: ProjectContext,
  cluster: GkeCluster,
  seed: Readonly<{ name: string; image: string; replicas: Option<number> }>,
): CommandResult => {
  const deployment = Result.mapErr(
    KubeDeployment.create({
      projectId: ctx.project.projectId,
      cluster: cluster.name,
      name: seed.name,
      image: seed.image,
      replicas: seed.replicas,
      createdAt: ctx.now,
    }),
    usage,
  );
  if (!Result.isOk(deployment)) return deployment;
  return Result.map(
    Result.mapErr(World.withKubeDeployment(ctx.world, deployment.value), kubeAlreadyExists),
    (world) => ({
      world,
      output: CommandOutput.messages(
        OutputMessage.plain(`deployment.apps/${deployment.value.name} created`),
      ),
    }),
  );
};

const createService = (
  ctx: ProjectContext,
  cluster: GkeCluster,
  seed: Readonly<{
    name: string;
    type: string;
    targetDeployment: string;
    port: number;
    targetPort: Option<number>;
  }>,
): CommandResult => {
  if (!Option.isSome(World.findKubeDeployment(ctx.world, cluster, seed.targetDeployment))) {
    return Result.err(notFound("deployments.apps", seed.targetDeployment));
  }
  const type = Option.toResult(KubeServiceType.parse(seed.type), () =>
    usage(
      `unknown service type "${seed.type}". Valid types are ClusterIP, NodePort, LoadBalancer.`,
    ),
  );
  if (!Result.isOk(type)) return type;
  const numbered = World.nextNumber(ctx.world);
  const service = Result.mapErr(
    KubeService.create({
      projectId: ctx.project.projectId,
      cluster: cluster.name,
      name: seed.name,
      type: type.value,
      targetDeployment: seed.targetDeployment,
      port: seed.port,
      targetPort: seed.targetPort,
      clusterIp: clusterIp(numbered.number),
      externalIp: loadBalancerIp(numbered.number),
      createdAt: ctx.now,
    }),
    usage,
  );
  if (!Result.isOk(service)) return service;
  return Result.map(
    Result.mapErr(World.withKubeService(numbered.world, service.value), kubeAlreadyExists),
    (world) => ({
      world,
      output: CommandOutput.messages(OutputMessage.plain(`service/${service.value.name} exposed`)),
    }),
  );
};

/** `-f FILE` のファイル。サンプル以外は本物と同じ no such file。 */
const sampleFile = (path: string) =>
  Option.toResult(SampleFile.find(path), () =>
    CommandFailure.notFoundWith(
      `error: the path "${path}" does not exist\ngcloud-sim: 使えるサンプルは ${SampleFile.names().join(" / ")} です（中身は docs/COMMANDS.md）。`,
    ),
  );

/** `-f` が無いときの本物の文言。 */
const fileRequired = (): CommandFailure => usage("must specify one of -f and -k");

const apply = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const cluster = currentCluster(ctx);
  if (!Result.isOk(cluster)) return cluster;
  const file = Result.flatMap(
    Option.toResult(ParsedArgs.string(args, "filename"), fileRequired),
    sampleFile,
  );
  if (!Result.isOk(file)) return file;
  const sample = file.value;
  switch (sample.kind) {
    case "kube-deployment": {
      const existing = World.findKubeDeployment(ctx.world, cluster.value, sample.deployment);
      if (Option.isSome(existing)) {
        const next = KubeDeployment.withSpec(existing.value, sample.image, sample.replicas);
        const unchanged =
          existing.value.image === sample.image && existing.value.replicas === sample.replicas;
        return Result.ok({
          world: unchanged ? ctx.world : World.replaceKubeDeployment(ctx.world, next),
          output: CommandOutput.messages(
            OutputMessage.plain(
              `deployment.apps/${sample.deployment} ${unchanged ? "unchanged" : "configured"}`,
            ),
          ),
        });
      }
      return createDeployment(ctx, cluster.value, {
        name: sample.deployment,
        image: sample.image,
        replicas: Option.some(sample.replicas),
      });
    }
    case "kube-service": {
      if (Option.isSome(World.findKubeService(ctx.world, cluster.value, sample.service))) {
        return Result.ok({
          world: ctx.world,
          output: CommandOutput.messages(
            OutputMessage.plain(`service/${sample.service} unchanged`),
          ),
        });
      }
      return Result.map(
        createService(ctx, cluster.value, {
          name: sample.service,
          type: sample.type,
          targetDeployment: sample.targetDeployment,
          port: sample.port,
          targetPort: Option.some(sample.targetPort),
        }),
        (outcome) => ({
          ...outcome,
          output: CommandOutput.messages(OutputMessage.plain(`service/${sample.service} created`)),
        }),
      );
    }
    case "monitoring-dashboard":
    case "app-yaml":
    case "dm-config":
    case "lifecycle":
    case "sa-key":
      return Result.err(
        usage(
          `error: unable to recognize "${sample.name}": no matches for kind (not a Kubernetes manifest)`,
        ),
      );
  }
};

const create = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const cluster = currentCluster(ctx);
  if (!Result.isOk(cluster)) return cluster;
  if (ParsedArgs.has(args, "filename")) return apply(ctx, args);
  const type = ParsedArgs.positional(args, 0);
  const name = ParsedArgs.positional(args, 1);
  if (!Option.isSome(type)) return Result.err(fileRequired());
  if (ResourceAliases[type.value.toLowerCase()] !== "deployment") {
    return Result.err(
      usage(
        `unknown command "${type.value}". gcloud-sim supports "kubectl create deployment NAME --image=IMAGE".`,
      ),
    );
  }
  if (!Option.isSome(name)) return Result.err(usage("NAME is required"));
  const image = ParsedArgs.string(args, "image");
  if (!Option.isSome(image)) return Result.err(usage('required flag(s) "image" not set'));
  return createDeployment(ctx, cluster.value, {
    name: name.value,
    image: image.value,
    replicas: ParsedArgs.integer(args, "replicas"),
  });
};

const remove = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const cluster = currentCluster(ctx);
  if (!Result.isOk(cluster)) return cluster;
  const file = ParsedArgs.string(args, "filename");
  const type = ParsedArgs.positional(args, 0);
  if (!Option.isSome(file) && !Option.isSome(type)) {
    return Result.err(usage("You must provide one or more resources by argument or filename."));
  }
  const ref = Option.isSome(file)
    ? Result.flatMap(sampleFile(file.value), (sample) =>
        sample.kind === "kube-deployment"
          ? Result.ok<ResourceRef>({ kind: "deployment", name: Option.some(sample.deployment) })
          : sample.kind === "kube-service"
            ? Result.ok<ResourceRef>({ kind: "service", name: Option.some(sample.service) })
            : Result.err(usage(`unable to recognize "${sample.name}": not a Kubernetes manifest`)),
      )
    : parseResource(Option.unwrapOr(type, ""), ParsedArgs.positional(args, 1));
  if (!Result.isOk(ref)) return ref;
  const name = ref.value.name;
  if (!Option.isSome(name))
    return Result.err(usage("resource(s) were provided, but no name was specified"));
  switch (ref.value.kind) {
    case "configmap":
    case "secret": {
      const config = ctx.world.kubeConfigs.find(
        (c) =>
          c.projectId === cluster.value.projectId &&
          c.cluster === cluster.value.name &&
          c.kind === ref.value.kind &&
          c.name === name.value,
      );
      if (!config) return Result.err(notFound(ref.value.kind, name.value));
      return Result.ok({
        world: World.withKubeConfigs(
          ctx.world,
          ctx.world.kubeConfigs.filter((c) => c !== config),
        ),
        output: CommandOutput.messages(
          OutputMessage.plain(`${config.kind}/${config.name} deleted`),
        ),
      });
    }
    case "deployment": {
      const deployment = World.findKubeDeployment(ctx.world, cluster.value, name.value);
      if (!Option.isSome(deployment)) return Result.err(notFound("deployments.apps", name.value));
      return Result.ok({
        world: World.withoutKubeDeployment(ctx.world, deployment.value),
        output: CommandOutput.messages(
          OutputMessage.plain(`deployment.apps "${name.value}" deleted`),
        ),
      });
    }
    case "service": {
      const service = World.findKubeService(ctx.world, cluster.value, name.value);
      if (!Option.isSome(service)) return Result.err(notFound("services", name.value));
      return Result.ok({
        world: World.withoutKubeService(ctx.world, service.value),
        output: CommandOutput.messages(OutputMessage.plain(`service "${name.value}" deleted`)),
      });
    }
    case "pod": {
      const owner = World.kubeDeploymentsOf(ctx.world, cluster.value).find((d) =>
        KubePod.fromDeployment(d).some((p) => p.name === name.value),
      );
      if (owner === undefined) return Result.err(notFound("pods", name.value));
      return Result.ok({
        world: World.replaceKubeDeployment(
          ctx.world,
          KubeDeployment.replacePod(
            owner,
            KubePod.fromDeployment(owner).findIndex((p) => p.name === name.value),
          ),
        ),
        output: CommandOutput.messages(
          OutputMessage.plain(`pod "${name.value}" deleted`),
          OutputMessage.hint(
            `gcloud-sim: Deployment ${owner.name} が新しい Pod を作り直しました（kubectl get pods で確認できます）。`,
          ),
        ),
      });
    }
    case "node":
    case "replicaset":
    case "all":
      return Result.err(usage(`cannot delete ${ref.value.kind} on gcloud-sim`));
  }
};

const describe = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const cluster = currentCluster(ctx);
  if (!Result.isOk(cluster)) return cluster;
  const ref = parseResource(ParsedArgs.requiredPositional(args, 0), ParsedArgs.positional(args, 1));
  if (!Result.isOk(ref)) return ref;
  const collected = collect(ctx, cluster.value, ref.value, true);
  if (!Result.isOk(collected)) return collected;
  return Result.ok({ world: ctx.world, output: CommandOutput.yamlList(collected.value.rows) });
};

const expose = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const cluster = currentCluster(ctx);
  if (!Result.isOk(cluster)) return cluster;
  const ref = parseResource(ParsedArgs.requiredPositional(args, 0), ParsedArgs.positional(args, 1));
  if (!Result.isOk(ref)) return ref;
  if (ref.value.kind !== "deployment" || !Option.isSome(ref.value.name)) {
    return Result.err(usage('gcloud-sim supports "kubectl expose deployment NAME --port=PORT".'));
  }
  const port = ParsedArgs.integer(args, "port");
  if (!Option.isSome(port))
    return Result.err(usage("couldn't find port via --port flag or introspection"));
  return createService(ctx, cluster.value, {
    name: Option.unwrapOr(ParsedArgs.string(args, "name"), ref.value.name.value),
    type: Option.unwrapOr(ParsedArgs.string(args, "type"), KubeServiceTypes.ClusterIp),
    targetDeployment: ref.value.name.value,
    port: port.value,
    targetPort: ParsedArgs.integer(args, "target-port"),
  });
};

const requireDeployment = (
  ctx: ProjectContext,
  cluster: GkeCluster,
  args: ParsedArgs,
): Result<KubeDeployment, CommandFailure> => {
  const ref = parseResource(ParsedArgs.requiredPositional(args, 0), ParsedArgs.positional(args, 1));
  if (!Result.isOk(ref)) return ref;
  if (ref.value.kind !== "deployment" || !Option.isSome(ref.value.name)) {
    return Result.err(usage("expected a deployment, e.g. deployment/NAME or deployment NAME"));
  }
  const name = ref.value.name.value;
  return Option.toResult(World.findKubeDeployment(ctx.world, cluster, name), () =>
    notFound("deployments.apps", name),
  );
};

const scale = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const cluster = currentCluster(ctx);
  if (!Result.isOk(cluster)) return cluster;
  const deployment = requireDeployment(ctx, cluster.value, args);
  if (!Result.isOk(deployment)) return deployment;
  const replicas = ParsedArgs.integer(args, "replicas");
  if (!Option.isSome(replicas)) return Result.err(usage('required flag(s) "replicas" not set'));
  const scaled = Result.mapErr(
    KubeDeployment.withReplicas(deployment.value, replicas.value),
    usage,
  );
  return Result.map(scaled, (next) => ({
    world: World.replaceKubeDeployment(ctx.world, next),
    output: CommandOutput.messages(OutputMessage.plain(`deployment.apps/${next.name} scaled`)),
  }));
};

const setImage = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const cluster = currentCluster(ctx);
  if (!Result.isOk(cluster)) return cluster;
  const inline = ParsedArgs.requiredPositional(args, 0).includes("/");
  const assignments = args.positionals.slice(inline ? 1 : 2);
  if (assignments.length !== 1)
    return Result.err(usage("Specify one deployment and one CONTAINER=IMAGE assignment."));
  const deployment = requireDeployment(ctx, cluster.value, args);
  if (!Result.isOk(deployment)) return deployment;
  const assignment = /^([^=]+)=([^=\s]+)$/.exec(assignments[0] ?? "");
  if (!assignment || (assignment[1] !== deployment.value.name && assignment[1] !== "*"))
    return Result.err(
      usage(`Container must be ${deployment.value.name} or * and image must be non-empty.`),
    );
  const next = KubeDeployment.withSpec(
    deployment.value,
    assignment[2] ?? "",
    deployment.value.replicas,
  );
  return Result.ok({
    world: World.replaceKubeDeployment(ctx.world, next),
    output: CommandOutput.messages(
      OutputMessage.plain(
        `deployment.apps/${next.name} ${next === deployment.value ? "unchanged" : "image updated"}`,
      ),
    ),
  });
};

const rollout = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const cluster = currentCluster(ctx);
  if (!Result.isOk(cluster)) return cluster;
  const verb = ParsedArgs.requiredPositional(args, 0);
  const rest: ParsedArgs = { ...args, positionals: args.positionals.slice(1) };
  if (rest.positionals.length === 0) return Result.err(usage(`required resource not specified`));
  const deployment = requireDeployment(ctx, cluster.value, rest);
  if (!Result.isOk(deployment)) return deployment;
  const d = deployment.value;
  switch (verb) {
    case "status": {
      const error = deploymentErrors(ctx.world, cluster.value, d).find(Boolean) ?? "";
      if (error)
        return Result.err(
          CommandFailure.invalidState(`Deployment ${d.name} is not ready: ${error}`),
        );
      return Result.ok({
        world: ctx.world,
        output: CommandOutput.messages(
          OutputMessage.plain(`deployment "${d.name}" successfully rolled out`),
        ),
      });
    }
    case "restart":
      return Result.ok({
        world: World.replaceKubeDeployment(ctx.world, KubeDeployment.restarted(d)),
        output: CommandOutput.messages(OutputMessage.plain(`deployment.apps/${d.name} restarted`)),
      });
    case "undo": {
      const target = Option.unwrapOr(ParsedArgs.integer(args, "to-revision"), 0);
      if (!Number.isSafeInteger(target) || target < 0)
        return Result.err(usage("--to-revision must be a non-negative integer."));
      return Result.map(Result.mapErr(KubeDeployment.undo(d, target), usage), (next) => ({
        world: World.replaceKubeDeployment(ctx.world, next),
        output: CommandOutput.messages(
          OutputMessage.plain(
            `deployment.apps/${d.name} ${next === d ? "skipped rollback (current revision)" : "rolled back"}`,
          ),
        ),
      }));
    }
    case "history": {
      const revision = ParsedArgs.integer(args, "revision");
      if (Option.isSome(revision)) {
        if (!Number.isSafeInteger(revision.value) || revision.value < 0)
          return Result.err(usage("--revision must be a non-negative integer."));
        if (revision.value > 0) {
          const record = d.revisions.find((r) => r.revision === revision.value);
          if (!record) return Result.err(usage("Requested revision is not retained."));
          return Result.ok({
            world: ctx.world,
            output: CommandOutput.yaml({
              revision: record.revision,
              kind: "PodTemplate",
              spec: {
                containers: [
                  { name: d.name, image: record.image, env: record.env.map(KubeEnv.toRecord) },
                ],
              },
            }),
          });
        }
      }
      return Result.ok({
        world: ctx.world,
        output: CommandOutput.messages(
          OutputMessage.plain(`deployment.apps/${d.name}`),
          OutputMessage.plain("REVISION  CHANGE-CAUSE  IMAGE"),
          ...d.revisions.map((r) =>
            OutputMessage.plain(`${r.revision}         <none>        ${r.image}`),
          ),
        ),
      });
    }
    default:
      return Result.err(
        usage(
          `unknown command "${verb}" for "kubectl rollout" (status / restart / history / undo)`,
        ),
      );
  }
};

const logs = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const cluster = currentCluster(ctx);
  if (!Result.isOk(cluster)) return cluster;
  const name = ParsedArgs.requiredPositional(args, 0);
  const owner = World.kubeDeploymentsOf(ctx.world, cluster.value).find((d) =>
    KubePod.fromDeployment(d).some((p) => p.name === name),
  );
  if (owner === undefined) return Result.err(notFound("pods", name));
  const error = podError(ctx.world, cluster.value, owner, name);
  if (error) return Result.err(CommandFailure.invalidState(`Container is waiting: ${error}`));
  return Result.ok({
    world: ctx.world,
    output: CommandOutput.messages(
      OutputMessage.plain(`${ctx.now} [${owner.image}] Listening on port 8080`),
      OutputMessage.hint(
        "gcloud-sim: コンテナのログは持たないので、起動の 1 行だけを出しています。",
      ),
    ),
  });
};

const config = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const verb = ParsedArgs.requiredPositional(args, 0);
  const clusters = World.clustersOf(ctx.world, ctx.project.projectId);
  const current = currentClusterOf(ctx);
  switch (verb) {
    case "current-context":
      return Option.isSome(current)
        ? Result.ok({
            world: ctx.world,
            output: CommandOutput.messages(OutputMessage.plain(contextName(current.value))),
          })
        : Result.err(usage("current-context is not set"));
    case "get-contexts":
      return Result.ok({
        world: ctx.world,
        output: CommandOutput.table(
          clusters.map((c) => ({
            current: Option.isSome(current) && current.value.name === c.name ? "*" : "",
            name: contextName(c),
            cluster: contextName(c),
            authinfo: contextName(c),
          })),
          [
            Column.create("CURRENT", "current"),
            Column.create("NAME", "name"),
            Column.create("CLUSTER", "cluster"),
            Column.create("AUTHINFO", "authinfo"),
          ],
        ),
      });
    case "use-context": {
      const target = ParsedArgs.positional(args, 1);
      const cluster = Option.flatMap(target, (t) =>
        Option.fromNullable(clusters.find((c) => contextName(c) === t || c.name === t)),
      );
      if (!Option.isSome(cluster)) {
        return Result.err(
          usage(`no context exists with the name: "${Option.unwrapOr(target, "")}"`),
        );
      }
      return Result.ok({
        world: World.withConfig(
          ctx.world,
          GcloudConfig.set(ctx.world.config, "container/cluster", cluster.value.name),
        ),
        output: CommandOutput.messages(
          OutputMessage.plain(`Switched to context "${contextName(cluster.value)}".`),
        ),
      });
    }
    case "view":
      return Result.ok({
        world: ctx.world,
        output: CommandOutput.yaml({
          apiVersion: "v1",
          kind: "Config",
          "current-context": Option.unwrapOr(Option.map(current, contextName), ""),
          contexts: clusters.map((c) => ({
            name: contextName(c),
            context: { cluster: contextName(c), user: contextName(c) },
          })),
          clusters: clusters.map((c) => ({
            name: contextName(c),
            cluster: { server: "https://34.85.0.1" },
          })),
        }),
      });
    default:
      return Result.err(
        usage(
          `unknown command "${verb}" for "kubectl config" (current-context / get-contexts / use-context / view)`,
        ),
      );
  }
};

const FileFlag = Flag.string(
  "filename",
  "The file that contains the configuration to apply (sample files only).",
  { aliases: ["-f"] },
);
const OutputFlag = Flag.string("output", "Output format: wide, yaml or json.", { aliases: ["-o"] });
const NamespaceFlag = Flag.string("namespace", "The namespace (only default is simulated).", {
  aliases: ["-n"],
});
const TypePositional = Positional.required(
  "TYPE[/NAME]",
  "Resource type, e.g. pods, deployment/web.",
);
const NamePositional = Positional.optional("NAME", "Resource name.", Candidates.kubeDeployments);

/** kubectl はコンテキストのクラスタで判定するので、どのコマンドも container の権限と API を要求する。 */
type KubectlSeed = Readonly<{
  verb: string;
  summary: string;
  positionals: readonly PositionalSpec[];
  flags: readonly FlagSpec[];
  permission: string | ((args: ParsedArgs) => string);
  run: (ctx: ProjectContext, args: ParsedArgs) => CommandResult;
}>;

const kubectl = (seed: KubectlSeed): CommandSpec =>
  projectCommand({
    path: ["kubectl", ...seed.verb.split(" ")],
    summary: seed.summary,
    positionals: seed.positionals,
    flags: [...seed.flags, NamespaceFlag],
    permissions: typeof seed.permission === "string" ? [seed.permission] : [],
    requiredApis: [ContainerApi],
    run: (ctx, args) => {
      const namespace = Option.unwrapOr(ParsedArgs.string(args, "namespace"), "default");
      if (namespace !== "default")
        return Result.err(usage("Only namespace default is supported on gcloud-sim."));
      if (typeof seed.permission === "function") {
        const allowed = kubePermission(ctx, seed.permission(args));
        if (!Result.isOk(allowed)) return allowed;
      }
      return seed.run(ctx, args);
    },
  });

const resourcePermission =
  (action: string, fallback: string) =>
  (args: ParsedArgs): string => {
    const ref = parseResource(
      ParsedArgs.requiredPositional(args, 0),
      ParsedArgs.positional(args, 1),
    );
    if (!Result.isOk(ref)) return fallback;
    const verb = action === "delete" ? "delete" : Option.isSome(ref.value.name) ? "get" : "list";
    if (ref.value.kind === "secret") return `container.secrets.${verb}`;
    if (ref.value.kind === "configmap") return `container.configMaps.${verb}`;
    return fallback;
  };
const execEnvironment = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const cluster = currentCluster(ctx);
  if (!Result.isOk(cluster)) return cluster;
  const [resource, command, key, ...extra] = args.positionals;
  if ((command !== "printenv" && command !== "env") || extra.length || (command === "env" && key))
    return Result.err(
      usage("Only exec POD -- printenv [KEY] or env is simulated; no shell is executed."),
    );
  const d = World.kubeDeploymentsOf(ctx.world, cluster.value).find(
    (d) =>
      resource === `deployment/${d.name}` ||
      KubePod.fromDeployment(d).some((p) => p.name === resource || `pod/${p.name}` === resource),
  );
  if (!d) return Result.err(notFound("pods", resource ?? ""));
  const name = resource?.startsWith("deployment/")
    ? KubePod.fromDeployment(d)[0]?.name
    : resource?.replace(/^pod\//, "");
  if (!name) return Result.err(usage("Deployment has no Pods."));
  const error = podError(ctx.world, cluster.value, d, name);
  if (error) return Result.err(CommandFailure.invalidState(`Container is waiting: ${error}`));
  const env = KubeRuntime.environment(ctx.world.kubeConfigs, d, name);
  if (!Result.isOk(env)) return Result.err(CommandFailure.invalidState(env.error));
  if (key && !env.value.values.some((e) => e.name === key))
    return Result.err(usage(`Environment variable ${key} is not set.`));
  const values = env.value.values.filter((e) => !key || e.name === key);
  return Result.ok({
    world: ctx.world,
    output: CommandOutput.messages(
      ...values.map((e) => OutputMessage.plain(key ? e.value : `${e.name}=${e.value}`)),
    ),
  });
};

export const KubectlCommands: readonly CommandSpec[] = [
  ...(["configmap", "secret"] as const).map((kind) =>
    kubectl({
      verb: kind === "secret" ? "create secret generic" : "create configmap",
      summary: `Create a ${kind} from repeated --from-literal=KEY=VALUE (default namespace).`,
      positionals: [Positional.required("NAME", "Configuration name.")],
      flags: [Flag.literals("from-literal", "One KEY=VALUE per flag; repeat to add keys.")],
      permission: `container.${kind === "secret" ? "secrets" : "configMaps"}.create`,
      run: (ctx, args) =>
        Result.flatMap(currentCluster(ctx), (cluster) => createConfig(ctx, args, cluster, kind)),
    }),
  ),
  kubectl({
    verb: "set env",
    summary: "Set/remove environment variables or import ConfigMap/Secret key references.",
    positionals: [
      TypePositional,
      {
        ...Positional.variadic("NAME_OR_ENV", "Deployment name, KEY=VALUE or KEY-."),
        required: false,
      },
    ],
    flags: [
      Flag.string("from", "configmap/NAME or secret/NAME.", {
        singleUse: true,
        candidates: Candidates.kubeConfigs,
      }),
      Flag.list("keys", "Comma-separated source keys.", { singleUse: true }),
      Flag.string("prefix", "Prefix for imported variable names.", { singleUse: true }),
      Flag.boolean("list", "List template variables without resolving secrets."),
    ],
    permission: (args) =>
      ParsedArgs.boolean(args, "list")
        ? "container.deployments.get"
        : "container.deployments.update",
    run: (ctx, args) =>
      Result.flatMap(currentCluster(ctx), (cluster) =>
        Result.flatMap(requireDeployment(ctx, cluster, args), (d) => setEnv(ctx, args, cluster, d)),
      ),
  }),
  kubectl({
    verb: "exec",
    summary: "Inspect simulated Pod environment with printenv or env (no shell execution).",
    positionals: [
      Positional.required("POD", "Pod name or deployment/NAME."),
      Positional.variadic("COMMAND", "-- printenv [KEY] or -- env."),
    ],
    flags: [],
    permission: "container.pods.exec",
    run: execEnvironment,
  }),
  kubectl({
    verb: "get",
    summary: "Display one or many resources.",
    positionals: [TypePositional, NamePositional],
    flags: [OutputFlag],
    permission: resourcePermission("list", "container.pods.list"),
    run: get,
  }),
  kubectl({
    verb: "apply",
    summary: "Apply a configuration to a resource by file name (sample files only).",
    positionals: [],
    flags: [FileFlag],
    permission: "container.deployments.update",
    run: apply,
  }),
  kubectl({
    verb: "create",
    summary: "Create a resource from a file or from the command line (deployment).",
    positionals: [
      Positional.optional("TYPE", "Resource type (deployment, configmap, secret).", () => [
        "deployment",
      ]),
      NamePositional,
    ],
    flags: [
      FileFlag,
      Flag.string("image", "Image name to run."),
      Flag.integer("replicas", "Number of replicas to create (default 1)."),
    ],
    permission: "container.deployments.create",
    run: create,
  }),
  kubectl({
    verb: "delete",
    summary: "Delete resources.",
    positionals: [Positional.optional("TYPE[/NAME]", "Resource type."), NamePositional],
    flags: [FileFlag],
    permission: resourcePermission("delete", "container.deployments.delete"),
    run: remove,
  }),
  kubectl({
    verb: "describe",
    summary: "Show details of a specific resource or group of resources.",
    positionals: [TypePositional, NamePositional],
    flags: [],
    permission: resourcePermission("get", "container.pods.get"),
    run: describe,
  }),
  kubectl({
    verb: "expose",
    summary: "Expose a resource as a new Kubernetes service.",
    positionals: [TypePositional, NamePositional],
    flags: [
      Flag.string("type", "Type for this service: ClusterIP, NodePort, LoadBalancer."),
      Flag.integer("port", "The port that the service should serve on."),
      Flag.integer("target-port", "Name or number for the port on the container."),
      Flag.string("name", "The name for the newly created object."),
    ],
    permission: "container.services.create",
    run: expose,
  }),
  kubectl({
    verb: "scale",
    summary: "Set a new size for a deployment.",
    positionals: [TypePositional, NamePositional],
    flags: [Flag.integer("replicas", "The new desired number of replicas.")],
    permission: "container.deployments.update",
    run: scale,
  }),
  kubectl({
    verb: "set image",
    summary: "Update the single container image of a Deployment.",
    positionals: [
      TypePositional,
      Positional.required("NAME_OR_ASSIGNMENT", "Name or CONTAINER=IMAGE."),
      Positional.optional("ASSIGNMENT", "CONTAINER=IMAGE when using deployment NAME."),
    ],
    flags: [],
    permission: "container.deployments.update",
    run: setImage,
  }),
  ...(["status", "restart", "history", "undo"] as const).map((verb) =>
    kubectl({
      verb: `rollout ${verb}`,
      summary: `Deployment rollout ${verb} (retains current and 10 previous templates).`,
      positionals: [TypePositional, NamePositional],
      flags:
        verb === "history"
          ? [Flag.integer("revision", "Inspect a retained revision; 0 lists history.")]
          : verb === "undo"
            ? [
                Flag.integer(
                  "to-revision",
                  "Restore a retained revision; 0 uses the previous revision.",
                ),
              ]
            : [],
      permission:
        verb === "status" || verb === "history"
          ? "container.deployments.get"
          : "container.deployments.update",
      run: (ctx, args) => rollout(ctx, { ...args, positionals: [verb, ...args.positionals] }),
    }),
  ),
  kubectl({
    verb: "logs",
    summary: "Print the logs for a container in a pod.",
    positionals: [Positional.required("POD", "Pod name.")],
    flags: [
      Flag.boolean("follow", "Specify if the logs should be streamed (ignored).", {
        aliases: ["-f"],
      }),
    ],
    permission: "container.pods.get",
    run: logs,
  }),
  kubectl({
    verb: "config",
    summary: "Modify kubeconfig files (current-context / get-contexts / use-context / view).",
    positionals: [
      Positional.required("SUBCOMMAND", "current-context, get-contexts, use-context or view."),
      Positional.optional("CONTEXT", "Context name for use-context."),
    ],
    flags: [],
    permission: "container.clusters.get",
    run: config,
  }),
];
