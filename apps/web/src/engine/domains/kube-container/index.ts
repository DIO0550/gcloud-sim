import { type KubeDeployment, KubePod } from "@/engine/domains/kubernetes";
import { Option } from "@/utils/Option";

export type PodRestart = Readonly<{ podName: string; restarts: number }>;
type RestartSample = PodRestart & Readonly<{ restarted: boolean }>;
/** One container per Pod: shared restart count and startup gate, independent of probe kind. */
export const KubeContainer = {
  restarts(d: KubeDeployment, podName: string): number {
    return d.podRestarts.find((p) => p.podName === podName)?.restarts ?? 0;
  },
  started(d: KubeDeployment, podName: string): boolean {
    if (!Option.isSome(d.startupProbe)) return true;
    return d.podStartup.find((p) => p.podName === podName)?.started ?? false;
  },
  withRestarts(d: KubeDeployment, samples: readonly RestartSample[]): KubeDeployment {
    const restarted = new Set(samples.filter((s) => s.restarted).map((s) => s.podName));
    return {
      ...d,
      podRestarts: [
        ...d.podRestarts.filter((s) => !restarted.has(s.podName)),
        ...samples
          .filter((s) => s.restarted)
          .map(({ podName, restarts }) => ({ podName, restarts })),
      ],
      podStartup: d.podStartup.filter((s) => !restarted.has(s.podName)),
      podLiveness: d.podLiveness.filter((s) => !restarted.has(s.podName)),
      podReadiness: d.podReadiness.filter((s) => !restarted.has(s.podName)),
      podEnvironments: d.podEnvironments.filter((s) => !restarted.has(s.podName)),
    };
  },
  reconcile(d: KubeDeployment): KubeDeployment {
    const names = new Set(KubePod.fromDeployment(d).map((p) => p.name));
    return { ...d, podRestarts: d.podRestarts.filter((s) => names.has(s.podName)) };
  },
  validate(d: KubeDeployment): boolean {
    const names = new Set(KubePod.fromDeployment(d).map((p) => p.name));
    if (new Set(d.podRestarts.map((p) => p.podName)).size !== d.podRestarts.length) return false;
    if (!Option.isSome(d.livenessProbe) && !Option.isSome(d.startupProbe) && d.podRestarts.length)
      return false;
    return d.podRestarts.every(
      (p) => names.has(p.podName) && Number.isSafeInteger(p.restarts) && p.restarts > 0,
    );
  },
} as const;
