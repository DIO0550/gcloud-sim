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

export type KubeDeployment = Readonly<{
  projectId: string;
  cluster: string;
  name: string;
  image: string;
  replicas: number;
  /** ロールアウトの世代。`apply` / `scale` / `rollout restart` で上がる */
  generation: number;
  createdAt: string;
}>;

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
      createdAt: string;
    }>,
  ): Result<KubeDeployment, string> {
    return Result.map(KubeName.parse(seed.name), (name) => ({
      projectId: seed.projectId,
      cluster: seed.cluster,
      name,
      image: seed.image,
      replicas: Option.unwrapOr(seed.replicas, 1),
      generation: 1,
      createdAt: seed.createdAt,
    }));
  },

  /**
   * レプリカ数を替える（`scale`）。ReplicaSet は同じままなので世代は上げない
   * （既存の Pod の名前が変わらず、減らすと末尾から消える）。
   *
   * @param deployment 元
   * @param replicas 新しい数。0 以上
   * @returns 替えた Deployment。負なら理由
   */
  withReplicas(deployment: KubeDeployment, replicas: number): Result<KubeDeployment, string> {
    return replicas >= 0
      ? Result.ok({ ...deployment, replicas })
      : Result.err(`Invalid value for --replicas: ${replicas}. Must be non-negative.`);
  },

  /** イメージとレプリカを置き換える（`apply` の再適用）。世代が上がる。 */
  withSpec(deployment: KubeDeployment, image: string, replicas: number): KubeDeployment {
    return { ...deployment, image, replicas, generation: deployment.generation + 1 };
  },

  /** `rollout restart`。中身は変えず世代だけ上げる。 */
  restarted(deployment: KubeDeployment): KubeDeployment {
    return { ...deployment, generation: deployment.generation + 1 };
  },

  /**
   * ReplicaSet のハッシュ。Pod 名の中間に出る。世代から決めるので同じ世代なら同じ綴り。
   *
   * @param deployment 対象
   * @returns 10 文字の綴り
   */
  replicaSetHash(deployment: KubeDeployment): string {
    const seed = `${deployment.name}:${deployment.generation}`;
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
        creationTimestamp: deployment.createdAt,
        labels: { app: deployment.name },
      },
      spec: {
        replicas: deployment.replicas,
        selector: { matchLabels: { app: deployment.name } },
        template: {
          metadata: { labels: { app: deployment.name } },
          spec: { containers: [{ name: deployment.name, image: deployment.image }] },
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
      const suffix = ((i + 1) * 2654435761 + deployment.generation * 97)
        .toString(36)
        .padStart(5, "x")
        .slice(-5);
      return {
        name: `${deployment.name}-${hash}-${suffix}`,
        deployment: deployment.name,
        image: deployment.image,
        status: "Running",
        restarts: 0,
        ip: `10.8.${deployment.generation % 256}.${(i + 2) % 256}`,
      };
    });
  },

  toRecord(pod: KubePod): JsonRecord {
    return {
      apiVersion: "v1",
      kind: "Pod",
      metadata: { name: pod.name, namespace: "default", labels: { app: pod.deployment } },
      spec: { containers: [{ name: pod.deployment, image: pod.image }] },
      status: { phase: pod.status, podIP: pod.ip },
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
  /** `selector: app=<deployment>` の対象 */
  targetDeployment: string;
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
  targetDeployment: string;
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
    return Result.map(KubeName.parse(seed.name), (name) => ({
      projectId: seed.projectId,
      cluster: seed.cluster,
      name,
      type: seed.type,
      targetDeployment: seed.targetDeployment,
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
      metadata: { name: service.name, namespace: "default", creationTimestamp: service.createdAt },
      spec: {
        type: service.type,
        selector: { app: service.targetDeployment },
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
