import { KubeContainer } from "@/engine/domains/kube-container";
import { KubeLiveness, type LivenessProbe, type PodLiveness } from "@/engine/domains/kube-liveness";
import { type KubeDeployment, KubePod } from "@/engine/domains/kubernetes";
import type { JsonRecord } from "@/types/Json";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

export type StartupProbe = LivenessProbe;
export type PodStartup = PodLiveness & Readonly<{ started: boolean }>;
export const KubeStartup = {
  parse(value: unknown): Result<StartupProbe, string> {
    return Result.mapErr(KubeLiveness.parse(value), (reason) =>
      reason.replaceAll("livenessProbe", "startupProbe"),
    );
  },
  equal: KubeLiveness.equal,
  fields(probe: Option<StartupProbe>): JsonRecord {
    if (!Option.isSome(probe)) return {};
    return { startupProbe: { ...probe.value } };
  },
  sampleFields(d: KubeDeployment, podName: string): JsonRecord {
    if (!Option.isSome(d.startupProbe)) return {};
    return { startupSample: d.podStartup.find((p) => p.podName === podName) ?? null };
  },
  summary(d: KubeDeployment, podName: string): string {
    const sample = d.podStartup.find((p) => p.podName === podName);
    const count = KubeContainer.restarts(d, podName);
    if (!sample) return `起動待ち（未評価） / RESTARTS ${count}`;
    if (sample.started) return `起動確認済み / HTTP ${sample.statusCode} / RESTARTS ${count}`;
    return `起動待ち / HTTP ${sample.statusCode} / 連続失敗 ${sample.failures} / RESTARTS ${count}`;
  },
  evaluate(
    probe: StartupProbe,
    podName: string,
    previous: PodStartup | undefined,
    statusCode: number,
    restarts: number,
  ): PodStartup {
    const sample = KubeLiveness.evaluate(probe, podName, previous, statusCode, restarts);
    return { ...sample, started: statusCode >= 200 && statusCode < 400 };
  },
  withSamples(d: KubeDeployment, samples: readonly PodStartup[]): KubeDeployment {
    const next = KubeContainer.withRestarts(d, samples);
    const names = new Set(samples.map((s) => s.podName));
    return {
      ...next,
      podStartup: [...next.podStartup.filter((s) => !names.has(s.podName)), ...samples],
    };
  },
  reconcile(d: KubeDeployment): KubeDeployment {
    const names = new Set(KubePod.fromDeployment(d).map((p) => p.name));
    return {
      ...d,
      podStartup: d.podStartup.filter((p) => Option.isSome(d.startupProbe) && names.has(p.podName)),
    };
  },
  validate(d: KubeDeployment): boolean {
    // The supported startup and liveness HTTP config/counters have the same constraints.
    const asLiveness = {
      ...d,
      livenessProbe: d.startupProbe,
      podLiveness: d.podStartup,
      revisions: d.revisions.map((r) => ({ ...r, livenessProbe: r.startupProbe })),
    };
    if (!KubeLiveness.validate(asLiveness)) return false;
    if (d.podStartup.some((s) => s.started !== (s.statusCode >= 200 && s.statusCode < 400)))
      return false;
    // A liveness response that caused this restart remains a historical sample.
    const blocked = KubePod.fromDeployment(d).filter((p) => !KubeContainer.started(d, p.name));
    return blocked.every(
      (p) =>
        !d.podReadiness.some((s) => s.podName === p.name) &&
        !d.podLiveness.some((s) => s.podName === p.name && !s.restarted),
    );
  },
} as const;
