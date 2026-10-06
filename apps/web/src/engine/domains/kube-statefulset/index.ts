import { KubeLabels } from "@/engine/domains/kube-labels";
import type { KubePvc } from "@/engine/domains/kube-storage";
import { KubeDeployment, KubeName, KubePod } from "@/engine/domains/kubernetes";
import type { World } from "@/engine/domains/world";
import type { JsonRecord } from "@/types/Json";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

export type StatefulMetadata = NonNullable<KubeDeployment["statefulSet"]>;
export type KubeStatefulSet = KubeDeployment & Readonly<{ statefulSet: StatefulMetadata }>;

const scoped = (s: KubeStatefulSet, c: KubePvc) =>
  c.projectId === s.projectId && c.cluster === s.cluster && c.namespace === s.namespace;

export const KubeStatefulSet = {
  claimName(template: string, set: string, ordinal: number): string {
    return `${template}-${set}-${ordinal}`;
  },

  recordScale(
    world: World,
    before: KubeStatefulSet | undefined,
    next: KubeStatefulSet,
  ): KubeStatefulSet {
    if (!before || before.replicas === next.replicas) return next;

    const reusedClaims = KubeStatefulSet.claims(next)
      .filter((c) => Number(c.name.slice(c.name.lastIndexOf("-") + 1)) >= before.replicas)
      .flatMap((c) => {
        const existing = world.kubePvcs.find(
          (p) => scoped(next, p) && p.name === c.name && p.volumeName && !p.deleting,
        );
        return existing ? [{ name: existing.name, volumeName: existing.volumeName }] : [];
      });

    return {
      ...next,
      statefulSet: {
        ...next.statefulSet,
        lastScale: { from: before.replicas, to: next.replicas, reusedClaims },
      },
    };
  },

  validate(s: KubeStatefulSet): Result<KubeStatefulSet, string> {
    const checked = KubeDeployment.validate(s);
    if (!Result.isOk(checked)) return Result.err(checked.error);

    const meta = s.statefulSet;
    if (!meta || !Result.isOk(KubeName.parse(meta.serviceName)) || s.name.length > 59)
      return Result.err("Invalid StatefulSet serviceName or generated Pod name.");

    const templates = meta.volumeClaimTemplates;
    if (templates.length > 10 || new Set(templates.map((t) => t.name)).size !== templates.length)
      return Result.err("Use at most 10 unique volumeClaimTemplates.");

    for (const t of templates) {
      if (
        !Result.isOk(KubeName.parse(t.name)) ||
        (t.storageClassName !== "" && !Result.isOk(KubeName.parse(t.storageClassName))) ||
        !Number.isInteger(t.storageGi) ||
        t.storageGi < 1 ||
        t.storageGi > 1024 ||
        KubeStatefulSet.claimName(t.name, s.name, 999).length > 63 ||
        !s.volumes.some(
          (v) => v.name === t.name && v.source === "persistentvolumeclaim" && v.resource === t.name,
        ) ||
        !s.volumeMounts.some((m) => m.name === t.name)
      )
        return Result.err("Invalid StatefulSet volumeClaimTemplate or generated PVC name.");
    }

    const scale = meta.lastScale;
    if (
      scale &&
      (!Number.isInteger(scale.from) ||
        !Number.isInteger(scale.to) ||
        scale.from < 0 ||
        scale.from > 1000 ||
        scale.to < 0 ||
        scale.to > 1000 ||
        scale.from === scale.to ||
        scale.to !== s.replicas ||
        new Set(scale.reusedClaims.map((c) => c.name)).size !== scale.reusedClaims.length ||
        scale.reusedClaims.some(
          (c) =>
            !Result.isOk(KubeName.parse(c.name)) ||
            !Result.isOk(KubeName.parse(c.volumeName)) ||
            !templates.some((t) =>
              Array.from({ length: Math.max(0, scale.to - scale.from) }, (_, i) =>
                KubeStatefulSet.claimName(t.name, s.name, scale.from + i),
              ).includes(c.name),
            ),
        ))
    )
      return Result.err("Invalid StatefulSet scale history.");

    if (
      s.volumes.length !== templates.length ||
      s.env.length ||
      Option.isSome(s.readinessProbe) ||
      Option.isSome(s.livenessProbe) ||
      Option.isSome(s.startupProbe) ||
      Object.keys(s.resources.requests).length > 0 ||
      Object.keys(s.resources.limits).length > 0
    )
      return Result.err(
        "StatefulSet supports one image and template PVC mounts only on gcloud-sim.",
      );

    return Result.ok(s);
  },

  /** Reuse retained claims; changing a live template or adopting an incompatible claim is rejected. */
  claimConflict(world: World, s: KubeStatefulSet): string {
    for (const t of s.statefulSet.volumeClaimTemplates) {
      for (let ordinal = 0; ordinal < s.replicas; ordinal += 1) {
        const name = KubeStatefulSet.claimName(t.name, s.name, ordinal);
        const c = world.kubePvcs.find((c) => scoped(s, c) && c.name === name);
        if (
          c &&
          (c.deleting || c.storageClassName !== t.storageClassName || c.storageGi < t.storageGi)
        )
          return `PVC ${name} is Terminating or incompatible with the volumeClaimTemplate.`;
      }
    }
    return "";
  },

  claims(s: KubeStatefulSet): readonly KubePvc[] {
    return s.statefulSet.volumeClaimTemplates.flatMap((t) =>
      Array.from({ length: s.replicas }, (_, ordinal) => ({
        projectId: s.projectId,
        cluster: s.cluster,
        namespace: s.namespace,
        name: KubeStatefulSet.claimName(t.name, s.name, ordinal),
        storageClassName: t.storageClassName,
        storageGi: t.storageGi,
        volumeName: "",
        deleting: "",
        createdAt: s.createdAt,
      })),
    );
  },

  networkReason(world: World, s: KubeStatefulSet): string {
    const service = world.kubeServices.find(
      (v) =>
        v.projectId === s.projectId &&
        v.cluster === s.cluster &&
        v.namespace === s.namespace &&
        v.name === s.statefulSet.serviceName,
    );
    if (!service) return "Governing Service not found";
    if (service.type !== "ClusterIP" || service.clusterIp !== "None")
      return "Governing Service must be headless (clusterIP: None)";
    if (!KubeLabels.matches(service.selector, s.podLabels))
      return "Governing Service selector does not match Pod labels";
    return "Headless Service configured (DNS is not simulated)";
  },

  /** A recreated stable name must resolve startup state again; PV data stays in World. */
  replacePod(s: KubeStatefulSet, index: number): KubeStatefulSet {
    const podName = KubePod.fromDeployment(s)[index]?.name;
    const next = KubeDeployment.replacePod(s, index);
    return {
      ...next,
      statefulSet: s.statefulSet,
      podEnvironments: next.podEnvironments.filter((p) => p.podName !== podName),
      podFiles: next.podFiles.filter((p) => p.podName !== podName),
    };
  },

  toRecord(s: KubeStatefulSet): JsonRecord {
    const base = KubeDeployment.toRecord(s);
    const template = (base.spec as JsonRecord).template as JsonRecord;
    const podSpec = template.spec as JsonRecord;
    return {
      apiVersion: "apps/v1",
      kind: "StatefulSet",
      metadata: {
        name: s.name,
        namespace: s.namespace,
        labels: s.labels,
        creationTimestamp: s.createdAt,
      },
      spec: {
        replicas: s.replicas,
        selector: { matchLabels: s.selector },
        serviceName: s.statefulSet.serviceName,
        podManagementPolicy: "Parallel",
        updateStrategy: { type: "RollingUpdate" },
        persistentVolumeClaimRetentionPolicy: { whenDeleted: "Retain", whenScaled: "Retain" },
        template: { metadata: template.metadata, spec: { containers: podSpec.containers } },
        volumeClaimTemplates: s.statefulSet.volumeClaimTemplates.map((t) => ({
          metadata: { name: t.name },
          spec: {
            accessModes: ["ReadWriteOnce"],
            volumeMode: "Filesystem",
            storageClassName: t.storageClassName,
            resources: { requests: { storage: `${t.storageGi}Gi` } },
          },
        })),
      },
      status: {
        replicas: s.replicas,
        readyReplicas: s.replicas,
        updatedReplicas: s.replicas,
        observedGeneration: s.generation,
        currentRevision: `${s.name}-${s.revision}`,
        updateRevision: `${s.name}-${s.revision}`,
      },
      ...(s.statefulSet.lastScale ? { simulator: { lastScale: s.statefulSet.lastScale } } : {}),
    };
  },
} as const;
