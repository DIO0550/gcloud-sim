import type { StatefulMetadata } from "@/engine/domains/kube-statefulset";
import { KubeName } from "@/engine/domains/kubernetes";
import { Result } from "@/utils/Result";
import { parseStorage } from "./storage";
import { fail, fields, record } from "./validation";
import { parseWorkload, type WorkloadManifest } from "./workloads";

export type StatefulManifest = Omit<Extract<WorkloadManifest, { kind: "deployment" }>, "kind"> &
  Readonly<{ kind: "statefulset"; statefulSet: StatefulMetadata }>;

export const parseStatefulSet = (r: Record<string, unknown>): StatefulManifest => {
  if (r.apiVersion !== "apps/v1") return fail("StatefulSet requires apps/v1.");
  fields(r, ["apiVersion", "kind", "metadata", "spec"], "StatefulSet");
  const spec = record(r.spec, "StatefulSet.spec");
  fields(
    spec,
    [
      "replicas",
      "selector",
      "template",
      "serviceName",
      "volumeClaimTemplates",
      "podManagementPolicy",
      "updateStrategy",
      "persistentVolumeClaimRetentionPolicy",
    ],
    "StatefulSet.spec",
  );

  if (typeof spec.serviceName !== "string" || !Result.isOk(KubeName.parse(spec.serviceName)))
    return fail("StatefulSet requires a valid serviceName.");
  if (spec.podManagementPolicy !== "Parallel")
    return fail(
      "StatefulSet requires explicit podManagementPolicy: Parallel on gcloud-sim; OrderedReady is not simulated.",
    );

  const strategy = record(spec.updateStrategy ?? {}, "updateStrategy");
  fields(strategy, ["type"], "updateStrategy");
  if ((strategy.type ?? "RollingUpdate") !== "RollingUpdate")
    return fail(
      "Only RollingUpdate with immediate replacement of all Pods is simulated; OnDelete/partition are unsupported.",
    );
  const retention = record(spec.persistentVolumeClaimRetentionPolicy ?? {}, "PVC retention policy");
  fields(retention, ["whenDeleted", "whenScaled"], "PVC retention policy");
  if (
    (retention.whenDeleted ?? "Retain") !== "Retain" ||
    (retention.whenScaled ?? "Retain") !== "Retain"
  )
    return fail("StatefulSet PVC retention supports Retain only.");

  const entries = spec.volumeClaimTemplates ?? [];
  if (!Array.isArray(entries) || entries.length > 10)
    return fail("Use at most 10 volumeClaimTemplates.");
  const templates = entries.map((entry) => {
    const c = record(entry, "volumeClaimTemplate");
    fields(c, ["metadata", "spec", "apiVersion", "kind"], "volumeClaimTemplate");
    if (
      (c.apiVersion ?? "v1") !== "v1" ||
      (c.kind ?? "PersistentVolumeClaim") !== "PersistentVolumeClaim"
    )
      return fail("Invalid volumeClaimTemplate kind/apiVersion.");
    const parsed = parseStorage({
      apiVersion: "v1",
      kind: "PersistentVolumeClaim",
      metadata: c.metadata,
      spec: c.spec,
    });
    if (parsed.kind !== "pvc" || parsed.namespace !== undefined)
      return fail("volumeClaimTemplates inherit the StatefulSet namespace.");
    return {
      name: parsed.name,
      storageClassName: parsed.storageClassName,
      storageGi: parsed.storageGi,
    };
  });
  if (new Set(templates.map((t) => t.name)).size !== templates.length)
    return fail("Duplicate volumeClaimTemplate.");

  const template = record(spec.template, "template");
  fields(template, ["metadata", "spec"], "template");
  const pod = record(template.spec, "template.spec");
  fields(pod, ["containers"], "StatefulSet template.spec");
  if (!Array.isArray(pod.containers) || pod.containers.length !== 1)
    return fail("Use exactly one container.");
  const container = record(pod.containers[0], "container");
  fields(container, ["name", "image", "volumeMounts"], "StatefulSet container");
  const workload = parseWorkload({
    ...r,
    kind: "Deployment",
    spec: {
      replicas: spec.replicas,
      selector: spec.selector,
      template: {
        ...template,
        spec: {
          ...pod,
          volumes: templates.map((t) => ({
            name: t.name,
            persistentVolumeClaim: { claimName: t.name },
          })),
        },
      },
    },
  });
  if (workload.kind !== "deployment") return fail("Invalid StatefulSet workload.");
  if (
    ["statefulset.kubernetes.io/pod-name", "apps.kubernetes.io/pod-index"].some((k) =>
      Object.hasOwn(workload.podLabels, k),
    )
  )
    return fail("StatefulSet identity labels are managed by the controller.");
  if (
    workload.name.length > 59 ||
    templates.some((t) => `${t.name}-${workload.name}-999`.length > 63) ||
    templates.some((t) => !workload.volumeMounts.some((m) => m.name === t.name))
  )
    return fail(
      "Every volumeClaimTemplate must be mounted and generated Pod/PVC names must fit 63 characters.",
    );
  return {
    ...workload,
    kind: "statefulset",
    statefulSet: { serviceName: spec.serviceName, volumeClaimTemplates: templates },
  };
};
