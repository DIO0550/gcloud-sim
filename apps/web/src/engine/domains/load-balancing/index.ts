import type { Region } from "@/engine/domains/catalog";
import { ResourceName } from "@/engine/domains/compute";
import type { JsonRecord } from "@/types/Json";
import type { ValueOf } from "@/types/ValueOf";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const projectBase = (projectId: string): string =>
  `https://www.googleapis.com/compute/v1/projects/${projectId}`;

/** グローバルかリージョンか。ロードバランサの 3 リソースが共有する。 */
export type LbScope = Readonly<{ kind: "global" }> | Readonly<{ kind: "region"; region: Region }>;

export const LbScope = {
  Global: Object.freeze({ kind: "global" as const }),

  region(region: Region): LbScope {
    return { kind: "region", region };
  },

  /** selfLink の `global` / `regions/R` の部分。 */
  toPath(scope: LbScope): string {
    return scope.kind === "global" ? "global" : `regions/${scope.region}`;
  },

  equals(a: LbScope, b: LbScope): boolean {
    return a.kind === "global" ? b.kind === "global" : b.kind === "region" && a.region === b.region;
  },
} as const;

export const HealthCheckProtocols = {
  Tcp: "TCP",
  Http: "HTTP",
  Https: "HTTPS",
} as const;
export type HealthCheckProtocol = ValueOf<typeof HealthCheckProtocols>;

export type HealthCheck = Readonly<{
  projectId: string;
  name: string;
  protocol: HealthCheckProtocol;
  port: number;
  checkIntervalSec: number;
  timeoutSec: number;
}>;

/** プロトコルごとの既定ポート（本物と同じ）。 */
const DefaultPorts: Readonly<Record<HealthCheckProtocol, number>> = {
  TCP: 80,
  HTTP: 80,
  HTTPS: 443,
};

export const HealthCheck = {
  /**
   * ヘルスチェックを作る。ポートの既定はプロトコルで決まる。
   *
   * @param seed 材料
   * @returns 作ったヘルスチェック。名前の形式が悪ければ理由
   */
  create(
    seed: Readonly<{
      projectId: string;
      name: string;
      protocol: HealthCheckProtocol;
      port: Option<number>;
    }>,
  ): Result<HealthCheck, string> {
    return Result.map(ResourceName.parse(seed.name), (name) => ({
      projectId: seed.projectId,
      name,
      protocol: seed.protocol,
      port: Option.unwrapOr(seed.port, DefaultPorts[seed.protocol]),
      checkIntervalSec: 5,
      timeoutSec: 5,
    }));
  },

  selfLink(check: HealthCheck): string {
    return `${projectBase(check.projectId)}/global/healthChecks/${check.name}`;
  },

  toRecord(check: HealthCheck): JsonRecord {
    const key = `${check.protocol.toLowerCase()}HealthCheck`;
    return {
      name: check.name,
      type: check.protocol,
      [key]: { port: check.port },
      checkIntervalSec: check.checkIntervalSec,
      timeoutSec: check.timeoutSec,
      healthyThreshold: 2,
      unhealthyThreshold: 2,
      selfLink: HealthCheck.selfLink(check),
    };
  },
} as const;

export const LoadBalancingSchemes = {
  External: "EXTERNAL",
  ExternalManaged: "EXTERNAL_MANAGED",
  Internal: "INTERNAL",
  InternalManaged: "INTERNAL_MANAGED",
} as const;
export type LoadBalancingScheme = ValueOf<typeof LoadBalancingSchemes>;

export const BackendProtocols = {
  Http: "HTTP",
  Https: "HTTPS",
  Tcp: "TCP",
  Udp: "UDP",
} as const;
export type BackendProtocol = ValueOf<typeof BackendProtocols>;

export type BackendService = Readonly<{
  projectId: string;
  name: string;
  scope: LbScope;
  protocol: BackendProtocol;
  loadBalancingScheme: LoadBalancingScheme;
  /** ヘルスチェックの名前 */
  healthChecks: readonly string[];
  /** バックエンドのインスタンスグループの名前 */
  backends: readonly string[];
  timeoutSec: number;
}>;

export const BackendService = {
  /**
   * バックエンドサービスを作る。名前の形式はここで検証する。
   *
   * @param seed 材料
   * @returns 作ったバックエンドサービス。名前の形式が悪ければ理由
   */
  create(
    seed: Readonly<{
      projectId: string;
      name: string;
      scope: LbScope;
      protocol: BackendProtocol;
      loadBalancingScheme: LoadBalancingScheme;
      healthChecks: readonly string[];
    }>,
  ): Result<BackendService, string> {
    return Result.map(ResourceName.parse(seed.name), (name) => ({
      projectId: seed.projectId,
      name,
      scope: seed.scope,
      protocol: seed.protocol,
      loadBalancingScheme: seed.loadBalancingScheme,
      healthChecks: seed.healthChecks,
      backends: [],
      timeoutSec: 30,
    }));
  },

  selfLink(service: BackendService): string {
    return `${projectBase(service.projectId)}/${LbScope.toPath(service.scope)}/backendServices/${service.name}`;
  },

  toRecord(service: BackendService): JsonRecord {
    const base = projectBase(service.projectId);
    return {
      name: service.name,
      protocol: service.protocol,
      loadBalancingScheme: service.loadBalancingScheme,
      healthChecks: service.healthChecks.map((h) => `${base}/global/healthChecks/${h}`),
      backends: service.backends.map((group) => ({ group })),
      timeoutSec: service.timeoutSec,
      region:
        service.scope.kind === "region" ? `${base}/regions/${service.scope.region}` : undefined,
      selfLink: BackendService.selfLink(service),
    };
  },
} as const;

export type ForwardingRule = Readonly<{
  projectId: string;
  name: string;
  scope: LbScope;
  ipAddress: string;
  ipProtocol: "TCP" | "UDP";
  portRange: string;
  loadBalancingScheme: LoadBalancingScheme;
  /** 転送先のバックエンドサービスの名前 */
  backendService: string;
  creationTimestamp: string;
}>;

export type ForwardingRuleSeed = Readonly<{
  projectId: string;
  name: string;
  scope: LbScope;
  /** 採番済みの IP。予約したアドレスを指定したときはその値 */
  ipAddress: string;
  ipProtocol: "TCP" | "UDP";
  portRange: string;
  loadBalancingScheme: LoadBalancingScheme;
  backendService: string;
  creationTimestamp: string;
}>;

export const ForwardingRule = {
  /**
   * 転送ルールを作る。名前の形式はここで検証する。
   *
   * @param seed 材料
   * @returns 作った転送ルール。名前の形式が悪ければ理由
   */
  create(seed: ForwardingRuleSeed): Result<ForwardingRule, string> {
    return Result.map(ResourceName.parse(seed.name), (name) => ({ ...seed, name }));
  },

  selfLink(rule: ForwardingRule): string {
    return `${projectBase(rule.projectId)}/${LbScope.toPath(rule.scope)}/forwardingRules/${rule.name}`;
  },

  toRecord(rule: ForwardingRule): JsonRecord {
    const base = projectBase(rule.projectId);
    return {
      name: rule.name,
      IPAddress: rule.ipAddress,
      IPProtocol: rule.ipProtocol,
      portRange: rule.portRange,
      loadBalancingScheme: rule.loadBalancingScheme,
      target: `${base}/${LbScope.toPath(rule.scope)}/backendServices/${rule.backendService}`,
      region: rule.scope.kind === "region" ? `${base}/regions/${rule.scope.region}` : undefined,
      creationTimestamp: rule.creationTimestamp,
      selfLink: ForwardingRule.selfLink(rule),
    };
  },
} as const;
