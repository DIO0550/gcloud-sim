import { KubeHpa } from "@/engine/domains/kube-hpa";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
import { fail, fields, namespace, record } from "./validation";

export type HpaManifest = Readonly<{
  kind: "hpa";
  name: string;
  namespace: string | undefined;
  target: string;
  minReplicas: number;
  maxReplicas: number;
  targetCpu: number;
}>;

export const parseHpa = (r: Record<string, unknown>): HpaManifest => {
  if (r.apiVersion !== "autoscaling/v2") return fail("HPA manifests require autoscaling/v2.");
  fields(r, ["apiVersion", "kind", "metadata", "spec"], "HPA manifest");
  const meta = record(r.metadata, "metadata");
  fields(meta, ["name", "namespace"], "HPA metadata");
  const ns = namespace(meta.namespace);
  if (typeof meta.name !== "string") return fail("metadata.name must be a string.");
  const spec = record(r.spec, "HPA spec");
  fields(spec, ["scaleTargetRef", "minReplicas", "maxReplicas", "metrics"], "HPA spec");
  const ref = record(spec.scaleTargetRef, "scaleTargetRef");
  fields(ref, ["apiVersion", "kind", "name"], "scaleTargetRef");
  if (ref.apiVersion !== "apps/v1" || ref.kind !== "Deployment" || typeof ref.name !== "string")
    return fail("HPA scaleTargetRef must name an apps/v1 Deployment.");
  if (!Array.isArray(spec.metrics) || spec.metrics.length !== 1)
    return fail("HPA manifests require exactly one explicit CPU Resource metric.");
  const metric = record(spec.metrics[0], "HPA metric");
  fields(metric, ["type", "resource"], "HPA metric");
  if (metric.type !== "Resource") return fail("Only Resource CPU utilization is supported.");
  const resource = record(metric.resource, "HPA metric.resource");
  fields(resource, ["name", "target"], "HPA metric.resource");
  if (resource.name !== "cpu") return fail("Only Resource CPU utilization is supported.");
  const target = record(resource.target, "HPA metric target");
  fields(target, ["type", "averageUtilization"], "HPA metric target");
  if (target.type !== "Utilization") return fail("Only CPU target type Utilization is supported.");
  const min = spec.minReplicas === undefined ? 1 : spec.minReplicas;
  if (
    typeof min !== "number" ||
    typeof spec.maxReplicas !== "number" ||
    typeof target.averageUtilization !== "number"
  )
    return fail("HPA replica limits and averageUtilization must be integers.");
  const h = KubeHpa.validate({
    projectId: "",
    cluster: "",
    namespace: ns ?? "default",
    name: meta.name,
    target: ref.name,
    minReplicas: min,
    maxReplicas: spec.maxReplicas,
    targetCpu: target.averageUtilization,
    createdAt: "1970-01-01T00:00:00.000Z",
    lastEvaluation: Option.none,
  });
  if (!Result.isOk(h)) return fail(h.error);
  return {
    kind: "hpa",
    name: h.value.name,
    namespace: ns,
    target: h.value.target,
    minReplicas: h.value.minReplicas,
    maxReplicas: h.value.maxReplicas,
    targetCpu: h.value.targetCpu,
  };
};
