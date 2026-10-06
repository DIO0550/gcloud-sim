import { ImagePull } from "@/engine/domains/image-pull";
import { KubeEnv, KubeRuntime } from "@/engine/domains/kube-config";
import { KubeContainer } from "@/engine/domains/kube-container";
import { KubeLiveness } from "@/engine/domains/kube-liveness";
import { KubeReadiness } from "@/engine/domains/kube-readiness";
import { KubeResources } from "@/engine/domains/kube-resources";
import { KubeStartup } from "@/engine/domains/kube-startup";
import { KubeVolumes } from "@/engine/domains/kube-volume";
import { KubeDeployment, KubeName, KubePod, type KubeRevision } from "@/engine/domains/kubernetes";
import type { GkeCluster } from "@/engine/domains/managed-services";
import type { World } from "@/engine/domains/world";
import type { JsonRecord } from "@/types/Json";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

export type ContainerSpec = Pick<
  KubeDeployment,
  | "image"
  | "env"
  | "volumeMounts"
  | "resources"
  | "readinessProbe"
  | "livenessProbe"
  | "startupProbe"
> &
  Readonly<{ name: string }>;
export type ContainerRuntime = Pick<
  KubeDeployment,
  "podReadiness" | "podLiveness" | "podStartup" | "podRestarts" | "podEnvironments" | "podFiles"
>;
export type ExtraContainer = ContainerSpec & ContainerRuntime;

const emptyRuntime = (): ContainerRuntime => ({
  podReadiness: [],
  podLiveness: [],
  podStartup: [],
  podRestarts: [],
  podEnvironments: [],
  podFiles: [],
});

/** Reuse the existing container runtime with the owner's Pod identities and shared volumes. */
export const KubeMulti = {
  revisionSpec(d: KubeDeployment, r: KubeRevision): readonly ContainerSpec[] {
    return [
      {
        name: r.containerName ?? d.name,
        image: r.image,
        env: r.env,
        volumeMounts: r.volumeMounts,
        resources: r.resources,
        readinessProbe: r.readinessProbe,
        livenessProbe: r.livenessProbe,
        startupProbe: r.startupProbe,
      },
      ...(r.extraContainers ?? []),
    ];
  },

  spec(d: KubeDeployment): readonly ContainerSpec[] {
    return [
      {
        name: d.containerName ?? d.name,
        image: d.image,
        env: d.env,
        volumeMounts: d.volumeMounts,
        resources: d.resources,
        readinessProbe: d.readinessProbe,
        livenessProbe: d.livenessProbe,
        startupProbe: d.startupProbe,
      },
      ...(d.extraContainers ?? []).map(KubeMulti.containerSpec),
    ];
  },

  containerSpec(c: ContainerSpec): ContainerSpec {
    return {
      name: c.name,
      image: c.image,
      env: c.env,
      volumeMounts: c.volumeMounts,
      resources: c.resources,
      readinessProbe: c.readinessProbe,
      livenessProbe: c.livenessProbe,
      startupProbe: c.startupProbe,
    };
  },

  fresh(c: ContainerSpec): ExtraContainer {
    return { ...c, ...emptyRuntime() };
  },

  runtimes(d: KubeDeployment): readonly Readonly<{ name: string; runtime: KubeDeployment }>[] {
    return [
      { name: d.containerName ?? d.name, runtime: { ...d, extraContainers: [] } },
      ...(d.extraContainers ?? []).map((c) => ({
        name: c.name,
        runtime: {
          ...d,
          ...c,
          name: d.name,
          extraContainers: [],
          containerName: c.name,
          revisions: d.revisions.map((r) => ({
            ...r,
            ...(r.extraContainers?.find((v) => v.name === c.name) ?? KubeMulti.containerSpec(c)),
            extraContainers: [],
            containerName: c.name,
          })),
        },
      })),
    ];
  },

  select(d: KubeDeployment, name: string | undefined): Result<KubeDeployment, string> {
    const target = name ?? d.containerName ?? d.name;
    const found = KubeMulti.runtimes(d).find((c) => c.name === target);
    if (!found) {
      return Result.err(
        `Container ${target} not found; available: ${KubeMulti.spec(d)
          .map((c) => c.name)
          .join(", ")}`,
      );
    }

    return Result.ok(found.runtime);
  },

  withRuntime(owner: KubeDeployment, runtime: KubeDeployment): KubeDeployment {
    const name = runtime.containerName ?? runtime.name;
    const fields: ContainerRuntime = {
      podReadiness: runtime.podReadiness,
      podLiveness: runtime.podLiveness,
      podStartup: runtime.podStartup,
      podRestarts: runtime.podRestarts,
      podEnvironments: runtime.podEnvironments,
      podFiles: runtime.podFiles,
    };
    if (name === (owner.containerName ?? owner.name)) {
      return { ...owner, ...fields };
    }

    return {
      ...owner,
      extraContainers: (owner.extraContainers ?? []).map((c) =>
        c.name === name ? { ...c, ...fields } : c,
      ),
    };
  },

  reconcile<T extends KubeDeployment>(
    source: Parameters<typeof KubeRuntime.reconcile>[0],
    d: T,
  ): T {
    let next = d;
    for (const c of KubeMulti.runtimes(d)) {
      const runtime = KubeRuntime.reconcile(source, c.runtime);
      const containers = KubeContainer.reconcile(runtime);
      const startup = KubeStartup.reconcile(containers);
      const liveness = KubeLiveness.reconcile(startup);
      next = { ...next, ...KubeMulti.withRuntime(next, KubeReadiness.reconcile(liveness)) };
    }

    return next;
  },

  ready(d: KubeDeployment, podName: string): boolean {
    return KubeMulti.runtimes(d).every((c) => KubeReadiness.ready(c.runtime, podName));
  },

  error(world: World, cluster: GkeCluster, d: KubeDeployment, podName: string): string {
    for (const c of KubeMulti.runtimes(d)) {
      const error = KubeMulti.containerError(world, cluster, c.runtime, podName, c.name);
      if (error.length > 0) {
        return error;
      }
    }

    return "";
  },

  containerError(
    world: World,
    cluster: GkeCluster,
    d: KubeDeployment,
    podName: string,
    containerName: string,
  ): string {
    const admission = d.podResources?.find(
      (s) => s.podName === podName && s.containerName === containerName,
    )?.admissionError;
    if (admission) {
      return admission;
    }
    const image = ImagePull.error(world, cluster, d.image);
    if (image.length > 0) {
      return image;
    }

    return KubeRuntime.error(world, d, podName);
  },

  reason(d: KubeDeployment, podName: string): string {
    for (const c of KubeMulti.runtimes(d)) {
      const reason = KubeReadiness.reason(c.runtime, podName);
      if (reason.length > 0) {
        return `${c.name}: ${reason}`;
      }
    }

    return "";
  },

  readyCount(world: World, cluster: GkeCluster, d: KubeDeployment, podName: string): number {
    return KubeMulti.runtimes(d).filter(
      (c) =>
        !KubeMulti.containerError(world, cluster, c.runtime, podName, c.name) &&
        KubeReadiness.ready(c.runtime, podName),
    ).length;
  },

  qos(d: KubeDeployment): ReturnType<typeof KubeResources.qosClass> {
    const classes = KubeMulti.spec(d).map((c) => KubeResources.qosClass(c.resources));
    if (classes.every((c) => c === "Guaranteed")) {
      return "Guaranteed";
    }
    if (classes.every((c) => c === "BestEffort")) {
      return "BestEffort";
    }

    return "Burstable";
  },

  forPod(d: KubeDeployment, podName: string): KubeDeployment {
    const resources = (name: string, base: KubeResources) =>
      d.podResources?.find((s) => s.podName === podName && s.containerName === name)?.resources ??
      base;
    return {
      ...d,
      resources: resources(d.containerName ?? d.name, d.resources),
      extraContainers: (d.extraContainers ?? []).map((c) => ({
        ...c,
        resources: resources(c.name, c.resources),
      })),
    };
  },

  record(c: ContainerSpec): JsonRecord {
    return {
      name: c.name,
      image: c.image,
      env: c.env.map(KubeEnv.toRecord),
      ...KubeVolumes.mountFields(c.volumeMounts),
      ...KubeResources.toContainerFields(c.resources),
      ...KubeReadiness.fields(c.readinessProbe),
      ...KubeLiveness.fields(c.livenessProbe),
      ...KubeStartup.fields(c.startupProbe),
    };
  },

  update(
    d: KubeDeployment,
    containers: readonly ContainerSpec[],
    serviceAccountName = d.serviceAccountName ?? "default",
  ): KubeDeployment {
    const first = containers[0];
    if (!first) {
      return d;
    }

    return KubeDeployment.withManifest(
      d,
      first.image,
      d.replicas,
      first.env,
      d.podLabels,
      d.labels,
      first.resources,
      first.readinessProbe,
      first.livenessProbe,
      first.startupProbe,
      d.volumes,
      first.volumeMounts,
      containers.slice(1),
      first.name,
      serviceAccountName,
    );
  },

  validateSpecs(specs: readonly ContainerSpec[], volumes: KubeDeployment["volumes"]): string {
    if (specs.length > 10 || new Set(specs.map((c) => c.name)).size !== specs.length) {
      return "Container names must be unique (maximum 10).";
    }
    for (const c of specs) {
      if (!Result.isOk(KubeName.parse(c.name)) || !c.image.trim() || /\s/.test(c.image)) {
        return "Invalid container identity or image.";
      }
      const resources = KubeResources.parse(c.resources);
      if (
        !Result.isOk(resources) ||
        !KubeResources.equal(resources.value, c.resources) ||
        !KubeEnv.validate(c.env) ||
        !KubeVolumes.validate(volumes, c.volumeMounts)
      ) {
        return "Invalid container resources, env or mounts.";
      }
      const probes = [
        Option.map(c.readinessProbe, KubeReadiness.parse),
        Option.map(c.livenessProbe, KubeLiveness.parse),
        Option.map(c.startupProbe, KubeStartup.parse),
      ];
      if (probes.some((p) => Option.isSome(p) && !Result.isOk(p.value))) {
        return "Invalid container probe.";
      }
    }

    return "";
  },

  validate(d: KubeDeployment): string {
    const specs = KubeMulti.spec(d);
    const specError = KubeMulti.validateSpecs(specs, d.volumes);
    if (specError.length > 0) {
      return specError;
    }
    if (specs.length > 10 || new Set(specs.map((c) => c.name)).size !== specs.length) {
      return "Containers must have unique names (maximum 10).";
    }
    const podNames = new Set(KubePod.fromDeployment(d).map((p) => p.name));
    const saved = d.podResources ?? [];
    if (
      saved.length > d.replicas * specs.length ||
      new Set(saved.map((s) => `${s.podName}/${s.containerName}`)).size !== saved.length ||
      saved.some((s) => {
        const parsed = KubeResources.parse(s.resources);
        return (
          !podNames.has(s.podName) ||
          !specs.some((c) => c.name === s.containerName) ||
          !Result.isOk(parsed) ||
          !KubeResources.equal(parsed.value, s.resources) ||
          (s.admissionError !== undefined && !s.admissionError.startsWith("VpaAdmissionError: "))
        );
      })
    ) {
      return "Invalid saved Pod resource admission.";
    }
    if (!Result.isOk(KubeName.parse(d.serviceAccountName ?? "default"))) {
      return "Invalid Pod serviceAccountName.";
    }
    for (const c of KubeMulti.runtimes(d)) {
      if (!Result.isOk(KubeName.parse(c.name))) {
        return "Invalid container name.";
      }
      if (!c.runtime.image.trim() || /\s/.test(c.runtime.image)) {
        return "Invalid container image.";
      }
      if (
        !KubeVolumes.validate(d.volumes, c.runtime.volumeMounts) ||
        !KubeEnv.validate(c.runtime.env)
      ) {
        return "Invalid container configuration.";
      }
      if (
        !KubeContainer.validate(c.runtime) ||
        !KubeStartup.validate(c.runtime) ||
        !KubeLiveness.validate(c.runtime) ||
        !KubeReadiness.validate(c.runtime)
      ) {
        return "Invalid saved container probe state.";
      }
      const resources = KubeResources.parse(c.runtime.resources);
      if (!Result.isOk(resources) || !KubeResources.equal(resources.value, c.runtime.resources)) {
        return "Invalid container resources.";
      }
      const names = new Set(KubePod.fromDeployment(c.runtime).map((p) => p.name));
      if (
        new Set(c.runtime.podEnvironments.map((p) => p.podName)).size !==
          c.runtime.podEnvironments.length ||
        c.runtime.podEnvironments.some(
          (p) =>
            !names.has(p.podName) ||
            p.values.length !== c.runtime.env.length ||
            new Set(p.values.map((v) => v.name)).size !== p.values.length ||
            p.values.some((v) => !c.runtime.env.some((e) => e.name === v.name)),
        )
      ) {
        return "Invalid saved container environment.";
      }
      if (!KubeVolumes.validFiles(c.runtime, [...names])) {
        return "Invalid saved container mounted files.";
      }
    }

    return "";
  },
} as const;
