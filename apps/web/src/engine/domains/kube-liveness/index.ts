import { KubeReadiness, type ReadinessProbe } from "@/engine/domains/kube-readiness";
import { type KubeDeployment, KubePod } from "@/engine/domains/kubernetes";
import type { JsonRecord } from "@/types/Json";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

export type LivenessProbe = ReadinessProbe;
export type PodLiveness = Readonly<{
  podName: string;
  statusCode: number;
  failures: number;
  restarts: number;
  /** Whether the last explicit sample triggered a restart; not a pending restart. */
  restarted: boolean;
}>;
const integer = (n: number, min: number, max: number): boolean =>
  Number.isSafeInteger(n) && n >= min && n <= max;
export const KubeLiveness = {
  parse(value: unknown): Result<LivenessProbe, string> {
    const parsed = KubeReadiness.parse(value);
    if (!Result.isOk(parsed))
      return Result.err(parsed.error.replaceAll("readinessProbe", "livenessProbe"));
    if (parsed.value.successThreshold !== 1)
      return Result.err("livenessProbe.successThreshold must be 1.");
    return parsed;
  },
  equal: KubeReadiness.equal,
  fields(probe: Option<LivenessProbe>): JsonRecord {
    if (!Option.isSome(probe)) return {};
    return { livenessProbe: { ...probe.value } };
  },
  sampleFields(d: KubeDeployment, podName: string): JsonRecord {
    if (!Option.isSome(d.livenessProbe)) return {};
    return { livenessSample: d.podLiveness.find((p) => p.podName === podName) ?? null };
  },
  restarts(d: KubeDeployment, podName: string): number {
    return d.podLiveness.find((p) => p.podName === podName)?.restarts ?? 0;
  },
  summary(d: KubeDeployment, podName: string): string {
    const sample = d.podLiveness.find((p) => p.podName === podName);
    if (!sample) return "未評価 / RESTARTS 0";
    const event = sample.restarted ? " / この応答で再起動" : "";
    return `HTTP ${sample.statusCode} / 連続失敗 ${sample.failures} / RESTARTS ${sample.restarts}${event}`;
  },
  reconcile(d: KubeDeployment): KubeDeployment {
    const names = new Set(KubePod.fromDeployment(d).map((p) => p.name));
    const podLiveness = d.podLiveness.filter(
      (p) => Option.isSome(d.livenessProbe) && names.has(p.podName),
    );
    if (podLiveness.length === d.podLiveness.length) return d;
    return { ...d, podLiveness };
  },
  evaluate(
    probe: LivenessProbe,
    podName: string,
    previous: PodLiveness | undefined,
    statusCode: number,
  ): PodLiveness {
    const failures = statusCode >= 200 && statusCode < 400 ? 0 : (previous?.failures ?? 0) + 1;
    const restarted = failures >= probe.failureThreshold;
    return {
      podName,
      statusCode,
      failures: restarted ? 0 : failures,
      restarts: (previous?.restarts ?? 0) + Number(restarted),
      restarted,
    };
  },
  /** Same Pod/template. Restarted containers resolve their environment and readiness anew. */
  withSamples(d: KubeDeployment, samples: readonly PodLiveness[]): KubeDeployment {
    const names = new Set(samples.map((s) => s.podName));
    const restarted = new Set(samples.filter((s) => s.restarted).map((s) => s.podName));
    return {
      ...d,
      podLiveness: [...d.podLiveness.filter((s) => !names.has(s.podName)), ...samples],
      podReadiness: d.podReadiness.filter((s) => !restarted.has(s.podName)),
      podEnvironments: d.podEnvironments.filter((s) => !restarted.has(s.podName)),
    };
  },
  validate(d: KubeDeployment): boolean {
    for (const entry of [d, ...d.revisions]) {
      if (!Option.isSome(entry.livenessProbe)) continue;
      const parsed = KubeLiveness.parse(entry.livenessProbe.value);
      if (
        !Result.isOk(parsed) ||
        !KubeLiveness.equal(entry.livenessProbe, Option.some(parsed.value))
      )
        return false;
    }
    if (!KubeLiveness.equal(d.livenessProbe, d.revisions.at(-1)?.livenessProbe ?? Option.none))
      return false;
    if (!Option.isSome(d.livenessProbe)) return d.podLiveness.length === 0;
    const threshold = d.livenessProbe.value.failureThreshold;
    const names = new Set(KubePod.fromDeployment(d).map((p) => p.name));
    if (new Set(d.podLiveness.map((p) => p.podName)).size !== d.podLiveness.length) return false;
    return d.podLiveness.every((p) => {
      if (
        !names.has(p.podName) ||
        !integer(p.statusCode, 100, 599) ||
        !integer(p.failures, 0, threshold - 1) ||
        !integer(p.restarts, 0, Number.MAX_SAFE_INTEGER) ||
        typeof p.restarted !== "boolean"
      )
        return false;
      if (p.statusCode >= 200 && p.statusCode < 400) return p.failures === 0 && !p.restarted;
      if (p.restarted) return p.failures === 0 && p.restarts > 0;
      return p.failures > 0;
    });
  },
} as const;
