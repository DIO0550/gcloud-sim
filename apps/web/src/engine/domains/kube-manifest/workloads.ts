import { KubeEnv } from "@/engine/domains/kube-config";
import { KubeLabels } from "@/engine/domains/kube-labels";
import { KubeLiveness, type LivenessProbe } from "@/engine/domains/kube-liveness";
import { KubeReadiness, type ReadinessProbe } from "@/engine/domains/kube-readiness";
import { KubeResources } from "@/engine/domains/kube-resources";
import { KubeStartup, type StartupProbe } from "@/engine/domains/kube-startup";
import { KubeDeployment, KubeName, KubeServiceType } from "@/engine/domains/kubernetes";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
import { fail, fields, namespace, record } from "./validation";

export type WorkloadManifest =
  | Readonly<{
      kind: "deployment";
      name: string;
      namespace: string | undefined;
      image: string;
      replicas: number | undefined;
      env: readonly KubeEnv[];
      resources: KubeResources;
      readinessProbe: Option<ReadinessProbe>;
      livenessProbe: Option<LivenessProbe>;
      startupProbe: Option<StartupProbe>;
      labels: KubeLabels;
      selector: KubeLabels;
      podLabels: KubeLabels;
    }>
  | Readonly<{
      kind: "service";
      name: string;
      namespace: string | undefined;
      type: KubeServiceType;
      selector: KubeLabels;
      labels: KubeLabels;
      port: number;
      targetPort: number;
    }>;

const labelMap = (value: unknown, required = false): KubeLabels => {
  const parsed = KubeLabels.parse(value, required);
  if (!Result.isOk(parsed)) return fail(parsed.error);
  return parsed.value;
};
const environment = (value: unknown): readonly KubeEnv[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return fail("env must be an array.");
  const env = value.map((entry): KubeEnv => {
    const e = record(entry, "env entry");
    fields(e, ["name", "value", "valueFrom"], "env entry");
    if (typeof e.name !== "string") return fail("env.name must be a string.");
    if (e.valueFrom === undefined) {
      if (e.value !== undefined && typeof e.value !== "string")
        return fail("env.value must be a string.");
      return { name: e.name, source: "literal", value: e.value ?? "", resource: "", key: "" };
    }
    if (e.value !== undefined) return fail("Use either env.value or env.valueFrom.");
    const from = record(e.valueFrom, "env.valueFrom");
    fields(from, ["configMapKeyRef", "secretKeyRef"], "env.valueFrom");
    if (Object.keys(from).length !== 1) return fail("Use exactly one configuration key reference.");
    const secret = "secretKeyRef" in from;
    const ref = record(secret ? from.secretKeyRef : from.configMapKeyRef, "key reference");
    fields(ref, ["name", "key"], "key reference");
    if (typeof ref.name !== "string" || typeof ref.key !== "string")
      return fail("Key reference requires name and key strings.");
    return {
      name: e.name,
      source: secret ? "secret" : "configmap",
      value: "",
      resource: ref.name,
      key: ref.key,
    };
  });
  if (!KubeEnv.validate(env)) return fail("Invalid or duplicate environment variables.");
  return env;
};

export const parseWorkload = (r: Record<string, unknown>): WorkloadManifest => {
  const deployment = r.kind === "Deployment";
  if (r.apiVersion !== (deployment ? "apps/v1" : "v1"))
    return fail("Unsupported workload apiVersion.");
  fields(r, ["apiVersion", "kind", "metadata", "spec"], "manifest");
  const meta = record(r.metadata, "metadata");
  fields(meta, ["name", "namespace", "labels"], "metadata");
  const labels = labelMap(meta.labels === undefined ? {} : meta.labels);
  const ns = namespace(meta.namespace);
  if (typeof meta.name !== "string" || !Result.isOk(KubeName.parse(meta.name)))
    return fail("Invalid metadata.name.");
  const spec = record(r.spec, "spec");
  if (!deployment) {
    fields(spec, ["type", "selector", "ports"], "Service.spec");
    const type = KubeServiceType.parse(typeof spec.type === "string" ? spec.type : "ClusterIP");
    if (!Option.isSome(type) || (spec.type !== undefined && typeof spec.type !== "string"))
      return fail("Unsupported Service type.");
    const selector = labelMap(spec.selector, true);
    if (!Array.isArray(spec.ports) || spec.ports.length !== 1)
      return fail("Use exactly one Service port.");
    const port = record(spec.ports[0], "Service port");
    fields(port, ["port", "targetPort", "protocol"], "Service port");
    if (port.protocol !== undefined && port.protocol !== "TCP")
      return fail("Only TCP Service ports are supported.");
    const validPort = (n: unknown): n is number =>
      typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 65535;
    const targetPort = port.targetPort ?? port.port;
    if (!validPort(port.port) || !validPort(targetPort) || port.targetPort === null)
      return fail("Service ports must be integers from 1 to 65535.");
    return {
      kind: "service",
      name: meta.name,
      namespace: ns,
      type: type.value,
      selector,
      labels,
      port: port.port,
      targetPort,
    };
  }
  fields(spec, ["replicas", "selector", "template"], "Deployment.spec");
  const selector = record(spec.selector, "Deployment.spec.selector");
  fields(selector, ["matchLabels"], "Deployment.spec.selector");
  const template = record(spec.template, "template");
  fields(template, ["metadata", "spec"], "template");
  const templateMeta = record(template.metadata, "template.metadata");
  fields(templateMeta, ["labels"], "template.metadata");
  const matchLabels = labelMap(selector.matchLabels, true);
  const podLabels = labelMap(templateMeta.labels, true);
  if (!KubeLabels.matches(matchLabels, podLabels))
    return fail("Deployment selector must match template labels.");
  const pod = record(template.spec, "template.spec");
  fields(pod, ["containers"], "template.spec");
  if (!Array.isArray(pod.containers) || pod.containers.length !== 1)
    return fail("Use exactly one container.");
  const container = record(pod.containers[0], "container");
  fields(
    container,
    ["name", "image", "env", "resources", "readinessProbe", "livenessProbe", "startupProbe"],
    "container",
  );
  if (container.name !== meta.name)
    return fail("Container name must equal Deployment name on gcloud-sim.");
  if (typeof container.image !== "string") return fail("Container image must be a string.");
  if (spec.replicas !== undefined && typeof spec.replicas !== "number")
    return fail("replicas must be an integer.");
  const env = environment(container.env);
  const probe: Result<Option<ReadinessProbe>, string> = container.readinessProbe === undefined
    ? Result.ok(Option.none)
    : Result.map(KubeReadiness.parse(container.readinessProbe), Option.some);
  if (!Result.isOk(probe)) return fail(probe.error);
  const liveness: Result<Option<LivenessProbe>, string> = container.livenessProbe === undefined
    ? Result.ok(Option.none)
    : Result.map(KubeLiveness.parse(container.livenessProbe), Option.some);
  if (!Result.isOk(liveness)) return fail(liveness.error);
  const startup: Result<Option<StartupProbe>, string> = container.startupProbe === undefined
    ? Result.ok(Option.none)
    : Result.map(KubeStartup.parse(container.startupProbe), Option.some);
  if (!Result.isOk(startup)) return fail(startup.error);
  const resources = KubeResources.parse(
    container.resources === undefined ? {} : container.resources,
  );
  if (!Result.isOk(resources)) return fail(resources.error);
  const valid = KubeDeployment.create({
    projectId: "",
    cluster: "",
    namespace: ns ?? "default",
    name: meta.name,
    image: container.image,
    replicas: Option.fromNullable(spec.replicas),
    createdAt: "",
  });
  if (!Result.isOk(valid)) return fail(valid.error);
  return {
    kind: "deployment",
    name: meta.name,
    namespace: ns,
    image: container.image,
    replicas: spec.replicas,
    env,
    resources: resources.value,
    readinessProbe: probe.value,
    livenessProbe: liveness.value,
    startupProbe: startup.value,
    labels,
    selector: matchLabels,
    podLabels,
  };
};
