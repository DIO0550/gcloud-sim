import { KubeEnv, type PodEnvironment } from "@/engine/domains/kube-config";
import { KubeLabels } from "@/engine/domains/kube-labels";
import { KubeResources } from "@/engine/domains/kube-resources";
import type { JsonRecord } from "@/types/Json";
import type { ValueOf } from "@/types/ValueOf";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

/**
 * `kubectl` が扱う Kubernetes リソース（TBD-007）。クラスタごとに持ち、コンテキストは
 * `container/cluster` が指すクラスタ。名前空間は `default` だけを再現する。
 */

/** DNS-1123 ラベル（Kubernetes の名前）。 */
export const KubeName = {
  parse(value: string): Result<string, string> {
    const valid = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/.test(value);
    return valid
      ? Result.ok(value)
      : Result.err(
          `The Deployment "${value}" is invalid: metadata.name: Invalid value: "${value}": a lowercase RFC 1123 subdomain must consist of lower case alphanumeric characters, '-' or '.', and must start and end with an alphanumeric character`,
        );
  },
} as const;

export type KubeRevision = Readonly<{
  revision: number;
  templateId: number;
  image: string;
  reason: "create" | "image" | "env" | "resources" | "labels" | "restart" | "undo" | "migrated";
  env: readonly KubeEnv[];
  resources: KubeResources;
  podLabels: KubeLabels;
}>;
export type KubeDeployment = Readonly<{
  projectId: string;
  cluster: string;
  name: string;
  image: string;
  env: readonly KubeEnv[];
  resources: KubeResources;
  podEnvironments: readonly PodEnvironment[];
  labels: KubeLabels;
  selector: KubeLabels;
  podLabels: KubeLabels;
  /** Unique /22 slot within the simulated cluster; independent of template revision. */
  podNetwork: number;
  replicas: number;
  /** Specの世代。Pod templateのrevisionとは別に管理する。 */
  generation: number;
  revision: number;
  revisions: readonly KubeRevision[];
  podIncarnations: readonly number[];
  podSequence: number;
  createdAt: string;
}>;

const validReplicas = (n: number): boolean => Number.isSafeInteger(n) && n >= 0 && n <= 1000;
const newRevision = (
  d: KubeDeployment,
  image: string,
  reason: KubeRevision["reason"],
  templateId = d.revision + 1,
  env = d.env,
  podLabels = d.podLabels,
  resources = d.resources,
): KubeDeployment => {
  const revision = d.revision + 1;
  return {
    ...d,
    image,
    env,
    resources,
    podLabels,
    generation: d.generation + 1,
    revision,
    revisions: [
      ...d.revisions.filter((r) => r.templateId !== templateId),
      { revision, image, templateId, reason, env, podLabels, resources },
    ].slice(-11),
    podSequence: d.podSequence + 1,
    podIncarnations: Array.from({ length: d.replicas }, () => d.podSequence + 1),
  };
};

const templateChangeReason = (
  d: KubeDeployment,
  image: string,
  env: readonly KubeEnv[],
  resources: KubeResources,
): KubeRevision["reason"] => {
  if (image !== d.image) return "image";
  if (JSON.stringify(env) !== JSON.stringify(d.env)) return "env";
  if (!KubeResources.equal(resources, d.resources)) return "resources";
  return "labels";
};

export const KubeDeployment = {
  /**
   * Deployment を作る。名前の形式はここで検証し、レプリカの既定は 1。
   *
   * @param seed 材料
   * @returns 作った Deployment。名前の形式が悪ければ理由
   */
  create(
    seed: Readonly<{
      projectId: string;
      cluster: string;
      name: string;
      image: string;
      replicas: Option<number>;
      labels?: KubeLabels;
      selector?: KubeLabels;
      podLabels?: KubeLabels;
      createdAt: string;
    }>,
  ): Result<KubeDeployment, string> {
    const labels = seed.labels ?? { app: seed.name };
    const selector = seed.selector ?? { app: seed.name };
    const podLabels = seed.podLabels ?? { app: seed.name };
    if (
      ![
        KubeLabels.parse(labels),
        KubeLabels.parse(selector, true),
        KubeLabels.parse(podLabels),
      ].every(Result.isOk) ||
      !KubeLabels.matches(selector, podLabels)
    )
      return Result.err("Deployment selector must match valid Pod labels.");
    const replicas = Option.unwrapOr(seed.replicas, 1);
    if (!validReplicas(replicas))
      return Result.err("Replicas must be an integer from 0 to 1000 on gcloud-sim.");
    if (!seed.image.trim() || /\s/.test(seed.image))
      return Result.err("Image must be a non-empty reference without whitespace.");
    return Result.map(KubeName.parse(seed.name), (name) => ({
      projectId: seed.projectId,
      cluster: seed.cluster,
      name,
      image: seed.image,
      env: [],
      resources: KubeResources.empty(),
      podEnvironments: [],
      labels,
      selector,
      podLabels,
      podNetwork: 0,
      replicas,
      generation: 1,
      revision: 1,
      revisions: [
        {
          revision: 1,
          templateId: 1,
          image: seed.image,
          reason: "create",
          env: [],
          podLabels,
          resources: KubeResources.empty(),
        },
      ],
      podIncarnations: Array.from({ length: replicas }, () => 0),
      podSequence: 0,
      createdAt: seed.createdAt,
    }));
  },

  /**
   * レプリカ数を替える（`scale`）。Spec世代は上げ、revisionとReplicaSetは保持する
   * （既存の Pod の名前が変わらず、減らすと末尾から消える）。
   *
   * @param deployment 元
   * @param replicas 新しい数。0 以上
   * @returns 替えた Deployment。負なら理由
   */
  withReplicas(deployment: KubeDeployment, replicas: number): Result<KubeDeployment, string> {
    if (!validReplicas(replicas))
      return Result.err("Replicas must be an integer from 0 to 1000 on gcloud-sim.");
    if (replicas === deployment.replicas) return Result.ok(deployment);
    return Result.ok({
      ...deployment,
      replicas,
      generation: deployment.generation + 1,
      podSequence:
        replicas > deployment.replicas ? deployment.podSequence + 1 : deployment.podSequence,
      podIncarnations: Array.from(
        { length: replicas },
        (_, i) => deployment.podIncarnations[i] ?? deployment.podSequence + 1,
      ),
    });
  },

  /** イメージとレプリカを置き換える（`apply` の再適用）。世代が上がる。 */
  withSpec(deployment: KubeDeployment, image: string, replicas: number): KubeDeployment {
    const scaled = Result.unwrap(KubeDeployment.withReplicas(deployment, replicas));
    if (image === deployment.image) return scaled;
    return { ...newRevision(scaled, image, "image"), generation: deployment.generation + 1 };
  },

  /** Apply the supported template and replicas in one revision, preserving scale-only Pod identities. */
  withManifest(
    deployment: KubeDeployment,
    image: string,
    replicas: number,
    env: readonly KubeEnv[],
    podLabels = deployment.podLabels,
    labels = deployment.labels,
    resources = deployment.resources,
  ): KubeDeployment {
    const metadata = KubeLabels.equal(labels, deployment.labels)
      ? deployment
      : { ...deployment, labels };
    const scaled = Result.unwrap(KubeDeployment.withReplicas(metadata, replicas));
    if (
      image === deployment.image &&
      JSON.stringify(env) === JSON.stringify(deployment.env) &&
      KubeLabels.equal(podLabels, deployment.podLabels) &&
      KubeResources.equal(resources, deployment.resources)
    )
      return scaled;
    const reason = templateChangeReason(deployment, image, env, resources);
    return {
      ...newRevision(scaled, image, reason, undefined, env, podLabels, resources),
      generation: deployment.generation + 1,
    };
  },

  withEnv(deployment: KubeDeployment, env: readonly KubeEnv[]): KubeDeployment {
    if (JSON.stringify(env) === JSON.stringify(deployment.env)) return deployment;
    return newRevision(deployment, deployment.image, "env", undefined, env);
  },

  /** `rollout restart`。同じイメージで新しいtemplateとrevisionを作る。 */
  restarted(deployment: KubeDeployment): KubeDeployment {
    return newRevision(deployment, deployment.image, "restart");
  },

  undo(deployment: KubeDeployment, target: number): Result<KubeDeployment, string> {
    const previous =
      target === 0
        ? deployment.revisions.at(-2)
        : deployment.revisions.find((r) => r.revision === target);
    if (!previous)
      return Result.err("Requested revision is not retained; inspect rollout history first.");
    if (previous.revision === deployment.revision) return Result.ok(deployment);
    return Result.ok(
      newRevision(
        deployment,
        previous.image,
        "undo",
        previous.templateId,
        previous.env,
        previous.podLabels,
        previous.resources,
      ),
    );
  },

  replacePod(deployment: KubeDeployment, index: number): KubeDeployment {
    return {
      ...deployment,
      podSequence: deployment.podSequence + 1,
      podIncarnations: deployment.podIncarnations.map((n, i) =>
        i === index ? deployment.podSequence + 1 : n,
      ),
    };
  },

  validate(d: KubeDeployment): Result<KubeDeployment, string> {
    for (const r of [d, ...d.revisions]) {
      const parsed = KubeResources.parse(r.resources);
      if (!Result.isOk(parsed) || !KubeResources.equal(parsed.value, r.resources))
        return Result.err("Invalid Deployment resources.");
    }
    if (!KubeResources.equal(d.resources, d.revisions.at(-1)?.resources ?? KubeResources.empty()))
      return Result.err("Resources differ from current revision.");
    if (!Number.isInteger(d.podNetwork) || d.podNetwork < 0 || d.podNetwork >= 16384)
      return Result.err("Invalid Deployment Pod network.");
    if (
      ![
        KubeLabels.parse(d.labels),
        KubeLabels.parse(d.selector, true),
        KubeLabels.parse(d.podLabels),
      ].every(Result.isOk) ||
      !KubeLabels.matches(d.selector, d.podLabels) ||
      d.revisions.some(
        (r) =>
          !Result.isOk(KubeLabels.parse(r.podLabels)) ||
          !KubeLabels.matches(d.selector, r.podLabels),
      )
    )
      return Result.err("Invalid Deployment labels or selector.");
    if (!KubeLabels.equal(d.podLabels, d.revisions.at(-1)?.podLabels ?? {}))
      return Result.err("Pod labels differ from current revision.");
    if (!KubeEnv.validate(d.env) || d.revisions.some((r) => !KubeEnv.validate(r.env)))
      return Result.err("Invalid Deployment environment.");
    if (JSON.stringify(d.env) !== JSON.stringify(d.revisions.at(-1)?.env))
      return Result.err("Deployment environment differs from current revision.");
    const positive = (n: number) => Number.isSafeInteger(n) && n > 0;
    const latest = d.revisions.at(-1);
    if (
      !Result.isOk(KubeName.parse(d.name)) ||
      !validReplicas(d.replicas) ||
      !positive(d.generation) ||
      !positive(d.revision) ||
      d.generation < d.revision
    )
      return Result.err("Invalid Deployment identity, replicas or generation.");
    const names = new Set(KubePod.fromDeployment(d).map((p) => p.name));
    if (
      new Set(d.podEnvironments.map((p) => p.podName)).size !== d.podEnvironments.length ||
      d.podEnvironments.some(
        (p) =>
          !names.has(p.podName) ||
          p.values.length !== d.env.length ||
          new Set(p.values.map((e) => e.name)).size !== p.values.length ||
          p.values.some((e) => !d.env.some((v) => v.name === e.name)),
      )
    )
      return Result.err("Invalid saved Pod environment.");
    if (
      !latest ||
      d.revisions.length > 11 ||
      latest.revision !== d.revision ||
      latest.image !== d.image ||
      new Set(d.revisions.map((r) => r.templateId)).size !== d.revisions.length
    )
      return Result.err("Invalid Deployment revision history.");
    for (const [i, r] of d.revisions.entries()) {
      if (
        !positive(r.revision) ||
        !positive(r.templateId) ||
        r.templateId > r.revision ||
        !r.image.trim() ||
        /\s/.test(r.image) ||
        (i > 0 && (d.revisions[i - 1]?.revision ?? 0) >= r.revision)
      )
        return Result.err("Invalid Deployment revision entry.");
    }
    if (
      d.podIncarnations.length !== d.replicas ||
      !Number.isSafeInteger(d.podSequence) ||
      d.podSequence < 0 ||
      d.podIncarnations.some((n) => !Number.isSafeInteger(n) || n < 0 || n > d.podSequence)
    )
      return Result.err("Invalid Deployment Pod identities.");
    return Result.ok(d);
  },

  /**
   * ReplicaSet の疑似ハッシュ。templateの識別子から決め、rollbackでも再利用する。
   *
   * @param deployment 対象
   * @returns 10 文字の綴り
   */
  replicaSetHash(
    deployment: KubeDeployment,
    templateId = deployment.revisions.at(-1)?.templateId ?? deployment.revision,
  ): string {
    const seed = `${deployment.name}:${templateId}`;
    const digest = [...seed].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 7);
    return digest.toString(36).padStart(10, "0").slice(0, 10);
  },

  toRecord(deployment: KubeDeployment): JsonRecord {
    return {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: {
        name: deployment.name,
        namespace: "default",
        generation: deployment.generation,
        annotations: { "deployment.kubernetes.io/revision": String(deployment.revision) },
        creationTimestamp: deployment.createdAt,
        labels: deployment.labels,
      },
      spec: {
        replicas: deployment.replicas,
        selector: { matchLabels: deployment.selector },
        template: {
          metadata: { labels: deployment.podLabels },
          spec: {
            containers: [
              {
                name: deployment.name,
                image: deployment.image,
                env: deployment.env.map(KubeEnv.toRecord),
                ...KubeResources.toContainerFields(deployment.resources),
              },
            ],
          },
        },
      },
      status: {
        replicas: deployment.replicas,
        readyReplicas: deployment.replicas,
        availableReplicas: deployment.replicas,
        updatedReplicas: deployment.replicas,
        observedGeneration: deployment.generation,
      },
    };
  },
} as const;

/** Deployment から導出する Pod。保存せず、読むたびに作る。 */
export type KubePod = Readonly<{
  name: string;
  deployment: string;
  labels: KubeLabels;
  resources: KubeResources;
  image: string;
  status: "Running";
  restarts: 0;
  ip: string;
}>;

export const KubePod = {
  /**
   * Deployment のレプリカ数ぶんの Pod を作る。名前は `deployment-<hash>-<5 文字>`。
   *
   * @param deployment 元
   * @returns レプリカ数ぶんの Pod
   */
  fromDeployment(deployment: KubeDeployment): readonly KubePod[] {
    const hash = KubeDeployment.replicaSetHash(deployment);
    return Array.from({ length: deployment.replicas }, (_, i) => {
      const templateId = deployment.revisions.at(-1)?.templateId ?? deployment.revision;
      const suffix = (
        (i + 1) * 2654435761 +
        templateId * 97 +
        (deployment.podIncarnations[i] ?? 0) * 101
      )
        .toString(36)
        .padStart(5, "x")
        .slice(-5);
      return {
        name: `${deployment.name}-${hash}-${suffix}`,
        deployment: deployment.name,
        labels: deployment.podLabels,
        resources: deployment.resources,
        image: deployment.image,
        status: "Running",
        restarts: 0,
        ip: `10.${deployment.podNetwork >> 6}.${(deployment.podNetwork % 64) * 4 + ((i + 2) >> 8)}.${(i + 2) % 256}`,
      };
    });
  },

  toRecord(pod: KubePod): JsonRecord {
    return {
      apiVersion: "v1",
      kind: "Pod",
      metadata: { name: pod.name, namespace: "default", labels: pod.labels },
      spec: {
        containers: [
          {
            name: pod.deployment,
            image: pod.image,
            ...KubeResources.toContainerFields(pod.resources),
          },
        ],
      },
      status: { phase: pod.status, podIP: pod.ip, qosClass: KubeResources.qosClass(pod.resources) },
    };
  },
} as const;

export const KubeServiceTypes = {
  ClusterIp: "ClusterIP",
  NodePort: "NodePort",
  LoadBalancer: "LoadBalancer",
} as const;
export type KubeServiceType = ValueOf<typeof KubeServiceTypes>;

export const KubeServiceType = {
  /**
   * `--type` の綴りを閉じた型にする。
   *
   * @param value ユーザーが打った綴り
   * @returns 3 種のどれかならそれ。無ければ `none`
   */
  parse(value: string): Option<KubeServiceType> {
    return Option.fromNullable(Object.values(KubeServiceTypes).find((t) => t === value));
  },
} as const;

export type KubeService = Readonly<{
  projectId: string;
  cluster: string;
  name: string;
  type: KubeServiceType;
  selector: KubeLabels;
  labels: KubeLabels;
  port: number;
  targetPort: number;
  clusterIp: string;
  /** `LoadBalancer` だけが持つ */
  externalIp: Option<string>;
  createdAt: string;
}>;

export type KubeServiceSeed = Readonly<{
  projectId: string;
  cluster: string;
  name: string;
  type: KubeServiceType;
  selector: KubeLabels;
  labels?: KubeLabels;
  port: number;
  targetPort: Option<number>;
  /** 採番済みの IP。ClusterIP と（LoadBalancer なら）外部 IP */
  clusterIp: string;
  externalIp: string;
  createdAt: string;
}>;

export const KubeService = {
  /**
   * Service を作る（`expose` / `apply -f service.yaml`）。targetPort の既定は port。
   *
   * @param seed 材料
   * @returns 作った Service。名前の形式が悪ければ理由
   */
  create(seed: KubeServiceSeed): Result<KubeService, string> {
    if (
      !Result.isOk(KubeLabels.parse(seed.selector, true)) ||
      !Result.isOk(KubeLabels.parse(seed.labels ?? {}))
    )
      return Result.err("Invalid Service labels or selector.");
    return Result.map(KubeName.parse(seed.name), (name) => ({
      projectId: seed.projectId,
      cluster: seed.cluster,
      name,
      type: seed.type,
      selector: seed.selector,
      labels: seed.labels ?? {},
      port: seed.port,
      targetPort: Option.unwrapOr(seed.targetPort, seed.port),
      clusterIp: seed.clusterIp,
      externalIp:
        seed.type === KubeServiceTypes.LoadBalancer ? Option.some(seed.externalIp) : Option.none,
      createdAt: seed.createdAt,
    }));
  },

  /** `kubectl get services` の PORT(S) 列の綴り。 */
  portsText(service: KubeService): string {
    return service.type === KubeServiceTypes.ClusterIp
      ? `${service.port}/TCP`
      : `${service.port}:${30000 + (service.port % 2768)}/TCP`;
  },

  toRecord(service: KubeService): JsonRecord {
    return {
      apiVersion: "v1",
      kind: "Service",
      metadata: {
        name: service.name,
        namespace: "default",
        creationTimestamp: service.createdAt,
        labels: service.labels,
      },
      spec: {
        type: service.type,
        selector: service.selector,
        clusterIP: service.clusterIp,
        ports: [{ protocol: "TCP", port: service.port, targetPort: service.targetPort }],
      },
      status: {
        loadBalancer: Option.isSome(service.externalIp)
          ? { ingress: [{ ip: service.externalIp.value }] }
          : {},
      },
    };
  },
} as const;
