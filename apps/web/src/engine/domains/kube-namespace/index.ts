import type { GkeCluster } from "@/engine/domains/managed-services";
import type { World } from "@/engine/domains/world";
import type { JsonRecord } from "@/types/Json";

export type KubeNamespace = Readonly<{
  projectId: string;
  cluster: string;
  name: string;
  createdAt: string;
}>;

/** Built-ins are derived from each cluster, including legacy snapshots. */
const builtins = ["default", "kube-system", "kube-public", "kube-node-lease"] as const;
export const KubeNamespace = {
  valid(name: unknown): name is string {
    return typeof name === "string" && /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/.test(name);
  },
  builtin(name: string): boolean {
    return builtins.some((n) => n === name);
  },
  of(world: World, cluster: GkeCluster): readonly KubeNamespace[] {
    return [
      ...builtins.map((name) => ({
        projectId: cluster.projectId,
        cluster: cluster.name,
        name,
        createdAt: "",
      })),
      ...world.kubeNamespaces.filter(
        (n) => n.projectId === cluster.projectId && n.cluster === cluster.name,
      ),
    ].toSorted((a, b) => a.name.localeCompare(b.name));
  },
  exists(world: World, cluster: GkeCluster, name: string): boolean {
    return KubeNamespace.of(world, cluster).some((n) => n.name === name);
  },
  toRecord(n: KubeNamespace): JsonRecord {
    return {
      apiVersion: "v1",
      kind: "Namespace",
      metadata: {
        name: n.name,
        ...(n.createdAt ? { creationTimestamp: n.createdAt } : {}),
        labels: { "kubernetes.io/metadata.name": n.name },
      },
      status: { phase: "Active" },
    };
  },
} as const;
