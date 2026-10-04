import { KubeResources } from "@/engine/domains/kube-resources";
import type { KubeDeployment } from "@/engine/domains/kubernetes";
import type { JsonRecord, JsonValue } from "@/types/Json";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

export const HpaReasons = [
  "Scaled",
  "WithinRange",
  "TooManyReplicas",
  "TooFewReplicas",
  "MissingCpuRequest",
  "TargetNotFound",
  "ScalingDisabled",
  "PodsNotReady",
] as const;
export type HpaEvaluation = Readonly<{
  evaluatedAt: string;
  cpuMilli: number;
  requestMilli: number;
  currentReplicas: number;
  desiredReplicas: number;
  reason: (typeof HpaReasons)[number];
}>;
export type KubeHpa = Readonly<{
  projectId: string;
  cluster: string;
  name: string;
  target: string;
  minReplicas: number;
  maxReplicas: number;
  targetCpu: number;
  createdAt: string;
  lastEvaluation: Option<HpaEvaluation>;
}>;
const integer = (n: number, min: number, max: number) =>
  Number.isSafeInteger(n) && n >= min && n <= max;
const validName = (name: string) =>
  name.length <= 63 && /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(name);
const measured = (e: HpaEvaluation) =>
  e.requestMilli > 0 &&
  !["TargetNotFound", "ScalingDisabled", "MissingCpuRequest", "PodsNotReady"].includes(e.reason);
export const KubeHpa = {
  validate(h: KubeHpa): Result<KubeHpa, string> {
    if (!validName(h.name) || !validName(h.target))
      return Result.err("HPA and target names must be DNS labels of at most 63 characters.");
    if (!integer(h.minReplicas, 1, 1000) || !integer(h.maxReplicas, h.minReplicas, 1000))
      return Result.err("HPA requires 1 <= min <= max <= 1000.");
    if (!integer(h.targetCpu, 1, 1000))
      return Result.err("CPU target must be an integer from 1 to 1000 percent of requests.");
    if (!Number.isFinite(Date.parse(h.createdAt))) return Result.err("Invalid HPA creation time.");
    if (Option.isSome(h.lastEvaluation)) {
      const e = h.lastEvaluation.value;
      if (
        !Number.isFinite(Date.parse(e.evaluatedAt)) ||
        !integer(e.cpuMilli, 0, 1_000_000_000) ||
        !integer(e.requestMilli, 0, Number.MAX_SAFE_INTEGER) ||
        !integer(e.currentReplicas, 0, 1000) ||
        !integer(e.desiredReplicas, 0, 1000) ||
        !HpaReasons.includes(e.reason)
      )
        return Result.err("Invalid HPA evaluation.");
      if (
        measured(e) &&
        (e.currentReplicas === 0 ||
          e.desiredReplicas < h.minReplicas ||
          e.desiredReplicas > h.maxReplicas)
      )
        return Result.err("Invalid HPA scaling result.");
      if (!measured(e) && e.desiredReplicas !== e.currentReplicas)
        return Result.err("Blocked HPA evaluation cannot scale.");
    }
    return Result.ok(h);
  },
  /** One explicit teaching cycle. Every existing Pod receives the same supplied CPU sample. */
  evaluate(
    h: KubeHpa,
    d: KubeDeployment | undefined,
    ready: boolean,
    cpuMilli: number,
    now: string,
  ): HpaEvaluation {
    const requestMilli = d ? KubeResources.cpuMilli(d.resources.requests.cpu) : 0;
    const base = {
      evaluatedAt: now,
      cpuMilli,
      requestMilli,
      currentReplicas: d?.replicas ?? 0,
      desiredReplicas: d?.replicas ?? 0,
    };
    if (!d) return { ...base, reason: "TargetNotFound" };
    if (d.replicas === 0) return { ...base, reason: "ScalingDisabled" };
    if (!requestMilli) return { ...base, reason: "MissingCpuRequest" };
    if (!ready) return { ...base, reason: "PodsNotReady" };
    const numerator = BigInt(cpuMilli) * 100n;
    const denominator = BigInt(requestMilli) * BigInt(h.targetCpu);
    const delta = numerator > denominator ? numerator - denominator : denominator - numerator;
    const raw =
      delta * 10n <= denominator
        ? BigInt(d.replicas)
        : (BigInt(d.replicas) * numerator + denominator - 1n) / denominator;
    if (raw > BigInt(h.maxReplicas))
      return { ...base, desiredReplicas: h.maxReplicas, reason: "TooManyReplicas" };
    if (raw < BigInt(h.minReplicas))
      return { ...base, desiredReplicas: h.minReplicas, reason: "TooFewReplicas" };
    const desiredReplicas = Number(raw);
    return {
      ...base,
      desiredReplicas,
      reason: desiredReplicas === d.replicas ? "WithinRange" : "Scaled",
    };
  },
  utilization(e: HpaEvaluation): Option<number> {
    if (!measured(e)) return Option.none;
    return Option.some(Math.floor((e.cpuMilli * 100) / e.requestMilli));
  },
  targets(h: KubeHpa): string {
    const value = Option.flatMap(h.lastEvaluation, KubeHpa.utilization);
    return `${Option.isSome(value) ? `${value.value}%` : "<unknown>"}/${h.targetCpu}%`;
  },
  toRecord(h: KubeHpa): JsonRecord {
    const status: Record<string, JsonValue> = {};
    if (Option.isSome(h.lastEvaluation)) {
      const e = h.lastEvaluation.value;
      const utilization = KubeHpa.utilization(e);
      status.currentReplicas = e.currentReplicas;
      status.desiredReplicas = e.desiredReplicas;
      status.currentMetrics = Option.isSome(utilization)
        ? [
            {
              type: "Resource",
              resource: {
                name: "cpu",
                current: { averageUtilization: utilization.value, averageValue: `${e.cpuMilli}m` },
              },
            },
          ]
        : [];
      status.conditions = [
        {
          type: "ScalingActive",
          status: Option.isSome(utilization) ? "True" : "False",
          reason: e.reason,
        },
      ];
    }
    return {
      apiVersion: "autoscaling/v2",
      kind: "HorizontalPodAutoscaler",
      metadata: { name: h.name, namespace: "default", creationTimestamp: h.createdAt },
      spec: {
        scaleTargetRef: { apiVersion: "apps/v1", kind: "Deployment", name: h.target },
        minReplicas: h.minReplicas,
        maxReplicas: h.maxReplicas,
        metrics: [
          {
            type: "Resource",
            resource: {
              name: "cpu",
              target: { type: "Utilization", averageUtilization: h.targetCpu },
            },
          },
        ],
      },
      status,
      simulator: {
        mode: "explicit-single-cycle",
        lastEvaluation: Option.isSome(h.lastEvaluation) ? { ...h.lastEvaluation.value } : null,
      },
    };
  },
} as const;
