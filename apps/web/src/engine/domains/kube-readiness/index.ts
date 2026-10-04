import { KubeContainer } from "@/engine/domains/kube-container";
import { type KubeDeployment, KubePod } from "@/engine/domains/kubernetes";
import type { JsonRecord } from "@/types/Json";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

export type ReadinessProbe = Readonly<{
  httpGet: Readonly<{ path: string; port: number }>;
  successThreshold: number;
  failureThreshold: number;
}>;
export type PodReadiness = Readonly<{
  podName: string;
  ready: boolean;
  successes: number;
  failures: number;
  statusCode: number;
}>;
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const integer = (n: unknown, min: number, max: number): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= min && n <= max;
export const KubeReadiness = {
  parse(value: unknown): Result<ReadinessProbe, string> {
    if (
      !record(value) ||
      Object.keys(value).some(
        (k) => !["httpGet", "successThreshold", "failureThreshold"].includes(k),
      )
    )
      return Result.err(
        "readinessProbe supports only httpGet, successThreshold and failureThreshold on gcloud-sim.",
      );
    const http = value.httpGet;
    if (!record(http) || Object.keys(http).some((k) => !["path", "port"].includes(k)))
      return Result.err("readinessProbe.httpGet supports only path and numeric port (HTTP).");
    const path = http.path === undefined ? "/" : http.path;
    if (
      typeof path !== "string" ||
      !path.startsWith("/") ||
      /\s/.test(path) ||
      path.length > 1024 ||
      !integer(http.port, 1, 65535)
    )
      return Result.err("readinessProbe.httpGet requires an absolute path and port 1..65535.");
    const successThreshold = value.successThreshold === undefined ? 1 : value.successThreshold;
    const failureThreshold = value.failureThreshold === undefined ? 3 : value.failureThreshold;
    if (!integer(successThreshold, 1, 1000) || !integer(failureThreshold, 1, 1000))
      return Result.err("Probe thresholds must be integers from 1 to 1000 on gcloud-sim.");
    return Result.ok({ httpGet: { path, port: http.port }, successThreshold, failureThreshold });
  },
  equal(a: Option<ReadinessProbe>, b: Option<ReadinessProbe>): boolean {
    if (!Option.isSome(a)) return !Option.isSome(b);
    return (
      Option.isSome(b) &&
      a.value.httpGet.path === b.value.httpGet.path &&
      a.value.httpGet.port === b.value.httpGet.port &&
      a.value.successThreshold === b.value.successThreshold &&
      a.value.failureThreshold === b.value.failureThreshold
    );
  },
  fields(probe: Option<ReadinessProbe>): JsonRecord {
    if (!Option.isSome(probe)) return {};
    return {
      readinessProbe: {
        httpGet: probe.value.httpGet,
        successThreshold: probe.value.successThreshold,
        failureThreshold: probe.value.failureThreshold,
      },
    };
  },
  sampleFields(d: KubeDeployment, podName: string): JsonRecord {
    if (!Option.isSome(d.readinessProbe)) return {};
    return {
      readinessSample: d.podReadiness.find((p) => p.podName === podName) ?? null,
    };
  },
  summary(d: KubeDeployment, podName: string): string {
    const sample = d.podReadiness.find((p) => p.podName === podName);
    if (!sample) return "未評価（NotReady）";
    const state = sample.ready ? "Ready" : "NotReady";
    return `${state} / HTTP ${sample.statusCode} / 連続成功 ${sample.successes}・失敗 ${sample.failures}`;
  },
  ready(d: KubeDeployment, podName: string): boolean {
    if (!KubeContainer.started(d, podName)) return false;
    if (!Option.isSome(d.readinessProbe)) return true;
    return d.podReadiness.find((p) => p.podName === podName)?.ready ?? false;
  },
  reason(d: KubeDeployment, podName: string): string {
    if (!KubeContainer.started(d, podName))
      return "StartupProbePending: startup has not succeeded for this container";
    if (KubeReadiness.ready(d, podName)) return "";
    const sample = d.podReadiness.find((p) => p.podName === podName);
    if (!sample) return "ReadinessProbePending: no simulated HTTP response yet";
    return `ReadinessProbeNotReady: HTTP ${sample.statusCode}, successes=${sample.successes}, failures=${sample.failures}`;
  },
  reconcile(d: KubeDeployment): KubeDeployment {
    const names = new Set(KubePod.fromDeployment(d).map((p) => p.name));
    const podReadiness = d.podReadiness.filter(
      (p) => Option.isSome(d.readinessProbe) && names.has(p.podName),
    );
    if (podReadiness.length === d.podReadiness.length) return d;
    return { ...d, podReadiness };
  },
  evaluate(
    probe: ReadinessProbe,
    podName: string,
    previous: PodReadiness | undefined,
    statusCode: number,
  ): PodReadiness {
    if (statusCode >= 200 && statusCode < 400) {
      const successes = Math.min(probe.successThreshold, (previous?.successes ?? 0) + 1);
      return {
        podName,
        ready: (previous?.ready ?? false) || successes >= probe.successThreshold,
        successes,
        failures: 0,
        statusCode,
      };
    }
    const failures = Math.min(probe.failureThreshold, (previous?.failures ?? 0) + 1);
    return {
      podName,
      ready: (previous?.ready ?? false) && failures < probe.failureThreshold,
      successes: 0,
      failures,
      statusCode,
    };
  },
  validate(d: KubeDeployment): boolean {
    for (const entry of [d, ...d.revisions]) {
      if (!Option.isSome(entry.readinessProbe)) continue;
      const parsed = KubeReadiness.parse(entry.readinessProbe.value);
      if (
        !Result.isOk(parsed) ||
        !KubeReadiness.equal(entry.readinessProbe, Option.some(parsed.value))
      )
        return false;
    }
    if (!KubeReadiness.equal(d.readinessProbe, d.revisions.at(-1)?.readinessProbe ?? Option.none))
      return false;
    if (!Option.isSome(d.readinessProbe)) return d.podReadiness.length === 0;
    const probe = d.readinessProbe.value;
    const names = new Set(KubePod.fromDeployment(d).map((p) => p.name));
    if (new Set(d.podReadiness.map((p) => p.podName)).size !== d.podReadiness.length) return false;
    return d.podReadiness.every((p) => {
      if (
        !names.has(p.podName) ||
        typeof p.ready !== "boolean" ||
        !integer(p.statusCode, 100, 599) ||
        !integer(p.successes, 0, probe.successThreshold) ||
        !integer(p.failures, 0, probe.failureThreshold)
      )
        return false;
      if (p.statusCode >= 200 && p.statusCode < 400)
        return (
          p.failures === 0 && p.successes > 0 && (p.successes < probe.successThreshold || p.ready)
        );
      return (
        p.successes === 0 && p.failures > 0 && (p.failures < probe.failureThreshold || !p.ready)
      );
    });
  },
} as const;
