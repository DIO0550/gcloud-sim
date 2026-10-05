import { KubeLabels } from "@/engine/domains/kube-labels";
import { KubeNamespace } from "@/engine/domains/kube-namespace";
import { KubeServiceRouting } from "@/engine/domains/kube-service-routing";
import type { GkeCluster } from "@/engine/domains/managed-services";
import type { World } from "@/engine/domains/world";
import type { JsonRecord } from "@/types/Json";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

export type IngressBackend = Readonly<{ name: string; port: number }>;
export type IngressPath = Readonly<{
  host: string;
  path: string;
  pathType: "Exact" | "Prefix";
  backend: IngressBackend;
}>;
export type KubeIngress = Readonly<{
  projectId: string;
  cluster: string;
  namespace: string;
  name: string;
  labels: KubeLabels;
  annotations: Readonly<Record<string, string>>;
  paths: readonly IngressPath[];
  defaultBackend: Option<IngressBackend>;
  createdAt: string;
}>;
export type IngressRoute = Readonly<{
  backend: IngressBackend;
  matched: string;
  endpoints: readonly string[];
}>;

const validBackend = (b: IngressBackend): boolean =>
  KubeNamespace.valid(b.name) && Number.isInteger(b.port) && b.port >= 1 && b.port <= 65535;
const prefix = (path: string): string => path.replace(/\/+$/, "") || "/";
const backendRecord = (b: IngressBackend): JsonRecord => ({
  service: { name: b.name, port: { number: b.port } },
});
const backendState = (world: World, ingress: KubeIngress, backend: IngressBackend) => {
  const service = world.kubeServices.find(
    (s) =>
      s.projectId === ingress.projectId &&
      s.cluster === ingress.cluster &&
      s.namespace === ingress.namespace &&
      s.name === backend.name,
  );
  if (!service)
    return Result.err(`Service ${backend.name} not found in namespace ${ingress.namespace}.`);
  if (service.type !== "NodePort")
    return Result.err(
      `Service ${backend.name} must be NodePort in this simulator; NEG backends are not simulated.`,
    );
  if (service.port !== backend.port)
    return Result.err(
      `Service ${backend.name} exposes port ${service.port}, not ${backend.port}; use Service port, not targetPort or nodePort.`,
    );
  const endpoints = KubeServiceRouting.endpoints(world, service);
  if (!endpoints.length)
    return Result.err(
      `Service ${backend.name}:${backend.port} has no Ready backends; check selector, replicas, image and readiness.`,
    );
  return Result.ok(endpoints);
};

/** Deterministic HTTP routing only; no GCE resources, sockets or LB health checks. */
export const KubeIngress = {
  validHost(value: unknown): value is string {
    return (
      typeof value === "string" &&
      (value === "" ||
        (value.length <= 253 &&
          value === value.toLowerCase() &&
          !/^\d+\.\d+\.\d+\.\d+$/.test(value) &&
          value.split(".").every((part) => KubeNamespace.valid(part))))
    );
  },
  validPath(value: unknown): value is string {
    return typeof value === "string" && value.length <= 1024 && /^\/[^?#*\s]*$/.test(value);
  },
  valid(ingress: KubeIngress): boolean {
    const keys = ingress.paths.map(
      (p) => `${p.host}/${p.pathType}/${p.pathType === "Prefix" ? prefix(p.path) : p.path}`,
    );
    return (
      KubeNamespace.valid(ingress.name) &&
      KubeNamespace.valid(ingress.namespace) &&
      Result.isOk(KubeLabels.parse(ingress.labels)) &&
      Number.isFinite(Date.parse(ingress.createdAt)) &&
      Object.entries(ingress.annotations).every(
        ([k, v]) => k === "kubernetes.io/ingress.class" && v === "gce",
      ) &&
      ingress.paths.length <= 32 &&
      new Set(keys).size === keys.length &&
      ingress.paths.every(
        (p) =>
          KubeIngress.validHost(p.host) &&
          KubeIngress.validPath(p.path) &&
          (p.pathType === "Exact" || p.pathType === "Prefix") &&
          validBackend(p.backend),
      ) &&
      (Option.isSome(ingress.defaultBackend)
        ? validBackend(ingress.defaultBackend.value)
        : ingress.defaultBackend.some === false) &&
      (ingress.paths.length > 0 || Option.isSome(ingress.defaultBackend))
    );
  },
  of(world: World, cluster: GkeCluster, namespace?: string): readonly KubeIngress[] {
    return world.kubeIngresses
      .filter(
        (i) =>
          i.projectId === cluster.projectId &&
          i.cluster === cluster.name &&
          (namespace === undefined || i.namespace === namespace),
      )
      .toSorted((a, b) => a.name.localeCompare(b.name));
  },
  select(
    ingress: KubeIngress,
    host: string,
    path: string,
  ): Option<{ backend: IngressBackend; matched: string }> {
    const matches = ingress.paths.filter(
      (p) =>
        (!p.host || p.host === host.toLowerCase()) &&
        (p.pathType === "Exact"
          ? path === p.path
          : prefix(p.path) === "/" ||
            path === prefix(p.path) ||
            path.startsWith(`${prefix(p.path)}/`)),
    );
    const selected = matches.toSorted(
      (a, b) =>
        (b.pathType === "Prefix" ? prefix(b.path).length : b.path.length) -
          (a.pathType === "Prefix" ? prefix(a.path).length : a.path.length) ||
        Number(b.pathType === "Exact") - Number(a.pathType === "Exact") ||
        Number(Boolean(b.host)) - Number(Boolean(a.host)),
    )[0];
    if (selected)
      return Option.some({
        backend: selected.backend,
        matched: `${selected.host || "*"} ${selected.path} (${selected.pathType})`,
      });
    if (Option.isSome(ingress.defaultBackend))
      return Option.some({ backend: ingress.defaultBackend.value, matched: "defaultBackend" });
    return Option.none;
  },
  request(
    world: World,
    ingress: KubeIngress,
    host: string,
    path: string,
  ): Result<IngressRoute, string> {
    const selected = KubeIngress.select(ingress, host, path);
    if (!Option.isSome(selected))
      return Result.err(`NO_ROUTE: no rule or defaultBackend for ${host}${path}.`);
    const state = backendState(world, ingress, selected.value.backend);
    if (!Result.isOk(state)) return Result.err(`BACKEND_UNAVAILABLE: ${state.error}`);
    return Result.ok({ ...selected.value, endpoints: state.value });
  },
  diagnostics(world: World, ingress: KubeIngress): readonly string[] {
    const backends = [
      ...ingress.paths.map((p) => p.backend),
      ...(Option.isSome(ingress.defaultBackend) ? [ingress.defaultBackend.value] : []),
    ];
    return [
      ...new Set(
        backends.flatMap((b) => {
          const state = backendState(world, ingress, b);
          return Result.isOk(state) ? [] : [state.error];
        }),
      ),
    ];
  },
  toRecord(ingress: KubeIngress): JsonRecord {
    const hosts = [...new Set(ingress.paths.map((p) => p.host))];
    return {
      apiVersion: "networking.k8s.io/v1",
      kind: "Ingress",
      metadata: {
        name: ingress.name,
        namespace: ingress.namespace,
        labels: ingress.labels,
        ...(Object.keys(ingress.annotations).length ? { annotations: ingress.annotations } : {}),
        creationTimestamp: ingress.createdAt,
      },
      spec: {
        ...(Option.isSome(ingress.defaultBackend)
          ? { defaultBackend: backendRecord(ingress.defaultBackend.value) }
          : {}),
        ...(hosts.length
          ? {
              rules: hosts.map((host) => ({
                ...(host ? { host } : {}),
                http: {
                  paths: ingress.paths
                    .filter((p) => p.host === host)
                    .map((p) => ({
                      path: p.path,
                      pathType: p.pathType,
                      backend: backendRecord(p.backend),
                    })),
                },
              })),
            }
          : {}),
      },
      status: { loadBalancer: {} },
    };
  },
} as const;
