import { KubeName } from "@/engine/domains/kubernetes";
import { Result } from "@/utils/Result";
import { fail, fields, namespace, record } from "./validation";

export type GkeLessonManifest =
  | Readonly<{
      kind: "serviceaccount";
      name: string;
      namespace: string | undefined;
      gcpServiceAccount: string;
    }>
  | Readonly<{
      kind: "vpa";
      name: string;
      namespace: string | undefined;
      target: string;
      container: string;
      mode: "Off" | "Initial" | "Recreate";
    }>;

export const parseGkeLesson = (r: Record<string, unknown>): GkeLessonManifest => {
  fields(r, ["apiVersion", "kind", "metadata", "spec"], "manifest");
  const meta = record(r.metadata, "metadata");
  fields(meta, ["name", "namespace", "annotations"], "metadata");
  if (typeof meta.name !== "string" || !Result.isOk(KubeName.parse(meta.name))) {
    return fail("Invalid metadata.name.");
  }
  const ns = namespace(meta.namespace);
  if (r.kind === "ServiceAccount") {
    if (r.apiVersion !== "v1" || r.spec !== undefined) {
      return fail("ServiceAccount requires v1 and no spec.");
    }
    const annotations =
      meta.annotations === undefined ? {} : record(meta.annotations, "annotations");
    fields(annotations, ["iam.gke.io/gcp-service-account"], "annotations");
    const email = annotations["iam.gke.io/gcp-service-account"] ?? "";
    if (
      typeof email !== "string" ||
      (email.length > 0 && !/^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(email))
    ) {
      return fail("Invalid IAM service account annotation.");
    }

    return { kind: "serviceaccount", name: meta.name, namespace: ns, gcpServiceAccount: email };
  }
  if (r.apiVersion !== "autoscaling.k8s.io/v1" || meta.annotations !== undefined) {
    return fail("VPA requires autoscaling.k8s.io/v1 without unsupported annotations.");
  }
  const spec = record(r.spec, "VPA.spec");
  fields(spec, ["targetRef", "updatePolicy", "resourcePolicy"], "VPA.spec");
  const target = record(spec.targetRef, "targetRef");
  fields(target, ["apiVersion", "kind", "name"], "targetRef");
  if (
    target.apiVersion !== "apps/v1" ||
    target.kind !== "Deployment" ||
    typeof target.name !== "string" ||
    !Result.isOk(KubeName.parse(target.name))
  ) {
    return fail("VPA targets one apps/v1 Deployment.");
  }
  const update = record(spec.updatePolicy, "updatePolicy");
  fields(update, ["updateMode"], "updatePolicy");
  if (!["Off", "Initial", "Recreate", "Auto"].includes(String(update.updateMode))) {
    return fail("VPA supports explicit Off, Initial, Recreate or Auto update modes.");
  }
  const mode =
    update.updateMode === "Auto"
      ? "Recreate"
      : (update.updateMode as "Off" | "Initial" | "Recreate");
  const policy = record(spec.resourcePolicy, "resourcePolicy");
  fields(policy, ["containerPolicies"], "resourcePolicy");
  if (!Array.isArray(policy.containerPolicies) || policy.containerPolicies.length !== 1) {
    return fail("Specify exactly one container policy.");
  }
  const container = record(policy.containerPolicies[0], "containerPolicy");
  fields(container, ["containerName", "controlledValues"], "containerPolicy");
  if (
    typeof container.containerName !== "string" ||
    !Result.isOk(KubeName.parse(container.containerName))
  ) {
    return fail("Specify a container name; wildcard policies are not simulated.");
  }

  if (
    (mode !== "Off" && container.controlledValues !== "RequestsOnly") ||
    (container.controlledValues !== undefined && container.controlledValues !== "RequestsOnly")
  ) {
    return fail(
      "Initial/Recreate requires explicit controlledValues: RequestsOnly; limits are not scaled.",
    );
  }
  return {
    kind: "vpa",
    name: meta.name,
    namespace: ns,
    target: target.name,
    container: container.containerName,
    mode,
  };
};
