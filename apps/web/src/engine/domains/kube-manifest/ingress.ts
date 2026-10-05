import { type IngressBackend, type IngressPath, KubeIngress } from "@/engine/domains/kube-ingress";
import { KubeLabels } from "@/engine/domains/kube-labels";
import { KubeNamespace } from "@/engine/domains/kube-namespace";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
import { fail, fields, namespace, record } from "./validation";

export type IngressManifest = Readonly<{
  kind: "ingress";
  name: string;
  namespace: string | undefined;
}> &
  Pick<KubeIngress, "labels" | "annotations" | "paths" | "defaultBackend">;

const backend = (value: unknown): IngressBackend => {
  const b = record(value, "Ingress backend");
  fields(b, ["service"], "Ingress backend (resource backends are not simulated)");
  const s = record(b.service, "backend.service");
  fields(s, ["name", "port"], "backend.service");
  const port = record(s.port, "backend.service.port");
  fields(port, ["number"], "backend.service.port (named ports are not simulated)");
  if (
    !KubeNamespace.valid(s.name) ||
    typeof port.number !== "number" ||
    !Number.isInteger(port.number) ||
    port.number < 1 ||
    port.number > 65535
  )
    return fail("Ingress backend requires a Service name and numeric port from 1 to 65535.");
  return { name: s.name, port: port.number };
};

export const parseIngress = (r: Record<string, unknown>): IngressManifest => {
  fields(r, ["apiVersion", "kind", "metadata", "spec"], "Ingress manifest");
  if (r.apiVersion !== "networking.k8s.io/v1")
    return fail("Ingress requires networking.k8s.io/v1.");
  const m = record(r.metadata, "Ingress metadata");
  fields(m, ["name", "namespace", "labels", "annotations"], "Ingress metadata");
  if (!KubeNamespace.valid(m.name)) return fail("Invalid Ingress name.");
  const labels = KubeLabels.parse(m.labels === undefined ? {} : m.labels);
  if (!Result.isOk(labels)) return fail(labels.error);
  const annotations = record(
    m.annotations === undefined ? {} : m.annotations,
    "Ingress annotations",
  );
  fields(annotations, ["kubernetes.io/ingress.class"], "Ingress annotations");
  if (
    annotations["kubernetes.io/ingress.class"] !== undefined &&
    annotations["kubernetes.io/ingress.class"] !== "gce"
  )
    return fail("Only external gce Ingress is simulated.");
  const s = record(r.spec, "Ingress spec");
  fields(
    s,
    ["rules", "defaultBackend"],
    "Ingress spec (TLS and ingressClassName are not simulated; use kubernetes.io/ingress.class: gce)",
  );
  const rules = s.rules === undefined ? [] : s.rules;
  if (!Array.isArray(rules) || rules.length > 32)
    return fail("Ingress rules must be an array of at most 32 entries.");
  const paths: IngressPath[] = rules.flatMap((value) => {
    const r = record(value, "Ingress rule");
    fields(r, ["host", "http"], "Ingress rule");
    const host = r.host === undefined ? "" : r.host;
    if (!KubeIngress.validHost(host))
      return fail(
        "Ingress host must be a lowercase DNS name; wildcard and IP hosts are not simulated.",
      );
    const http = record(r.http, "Ingress http");
    fields(http, ["paths"], "Ingress http");
    if (!Array.isArray(http.paths) || !http.paths.length || http.paths.length > 32)
      return fail("Ingress http.paths requires 1..32 entries.");
    return http.paths.map((value) => {
      const p = record(value, "Ingress path");
      fields(p, ["path", "pathType", "backend"], "Ingress path");
      if (!KubeIngress.validPath(p.path) || (p.pathType !== "Exact" && p.pathType !== "Prefix"))
        return fail(
          "Ingress requires an absolute path and pathType Exact or Prefix; wildcard paths and ImplementationSpecific are not simulated.",
        );
      return { host, path: p.path, pathType: p.pathType, backend: backend(p.backend) };
    });
  });
  const manifest: IngressManifest = {
    kind: "ingress",
    name: m.name,
    namespace: namespace(m.namespace),
    labels: labels.value,
    annotations: annotations as Record<string, string>,
    paths,
    defaultBackend:
      s.defaultBackend === undefined ? Option.none : Option.some(backend(s.defaultBackend)),
  };
  if (
    !KubeIngress.valid({
      ...manifest,
      namespace: manifest.namespace ?? "default",
      projectId: "",
      cluster: "",
      createdAt: "2026-01-01T00:00:00Z",
    })
  )
    return fail(
      "Ingress requires rules or defaultBackend, at most 32 paths and no duplicate host/pathType/path.",
    );
  return manifest;
};
