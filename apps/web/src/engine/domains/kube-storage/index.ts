import { KubeBinary } from "@/engine/domains/kube-config/binary";
import { KubeNamespace } from "@/engine/domains/kube-namespace";
import { KubeVolumes } from "@/engine/domains/kube-volume";
import type { KubeDeployment } from "@/engine/domains/kubernetes";
import type { World } from "@/engine/domains/world";
import type { JsonRecord } from "@/types/Json";
import { Result } from "@/utils/Result";

export type KubeStorageClass = Readonly<{
  projectId: string;
  cluster: string;
  name: string;
  provisioner: "pd.csi.storage.gke.io";
  diskType: "pd-balanced" | "pd-ssd";
  bindingMode: "Immediate" | "WaitForFirstConsumer";
  reclaimPolicy: "Delete" | "Retain";
  allowVolumeExpansion: boolean;
  createdAt: string;
}>;
export type KubePvc = Readonly<{
  projectId: string;
  cluster: string;
  namespace: string;
  name: string;
  storageClassName: string;
  storageGi: number;
  volumeName: string;
  deleting: string;
  createdAt: string;
}>;
export type KubePv = Readonly<{
  projectId: string;
  cluster: string;
  name: string;
  namespace: string;
  claim: string;
  storageClassName: string;
  storageGi: number;
  reclaimPolicy: "Delete" | "Retain";
  released: boolean;
  files: readonly Readonly<{ path: string; value: string }>[];
  createdAt: string;
}>;
export type KubeStorageState = Pick<
  World,
  | "kubeStorageClasses"
  | "kubePvcs"
  | "kubePvs"
  | "kubeDeployments"
  | "kubeStatefulSets"
  | "sequence"
>;
const name = (s: string) => KubeNamespace.valid(s);
const sameCluster = (
  a: { projectId: string; cluster: string },
  b: { projectId: string; cluster: string },
) => a.projectId === b.projectId && a.cluster === b.cluster;
const sizeValid = (n: number) => Number.isInteger(n) && n >= 1 && n <= 1024;
const builtinNames = ["standard-rwo", "premium-rwo"];

export const KubeStorage = {
  builtin: (n: string) => builtinNames.includes(n),
  capacity(value: unknown): number | undefined {
    if (typeof value !== "string" || !/^[1-9][0-9]*Gi$/.test(value)) return undefined;
    const n = Number(value.slice(0, -2));
    return sizeValid(n) ? n : undefined;
  },
  classes(
    world: Pick<World, "kubeStorageClasses">,
    cluster: { projectId: string; name: string },
  ): readonly KubeStorageClass[] {
    return [
      ...builtinNames.map(
        (n): KubeStorageClass => ({
          projectId: cluster.projectId,
          cluster: cluster.name,
          name: n,
          provisioner: "pd.csi.storage.gke.io",
          diskType: n === "premium-rwo" ? "pd-ssd" : "pd-balanced",
          bindingMode: "WaitForFirstConsumer",
          reclaimPolicy: "Delete",
          allowVolumeExpansion: true,
          createdAt: "",
        }),
      ),
      ...world.kubeStorageClasses.filter(
        (c) => c.projectId === cluster.projectId && c.cluster === cluster.name,
      ),
    ];
  },
  consumers(
    world: Pick<World, "kubeDeployments" | "kubeStatefulSets">,
    c: KubePvc,
  ): readonly KubeDeployment[] {
    return [...world.kubeDeployments, ...world.kubeStatefulSets].filter(
      (d) =>
        sameCluster(d, c) &&
        d.namespace === c.namespace &&
        d.replicas > 0 &&
        d.volumes.some((v) => {
          if (v.source !== "persistentvolumeclaim") return false;
          if (!d.statefulSet) return v.resource === c.name;
          const ordinal = c.name.slice(c.name.lastIndexOf("-") + 1);
          return (
            /^(0|[1-9][0-9]*)$/.test(ordinal) &&
            Number(ordinal) < d.replicas &&
            d.statefulSet.volumeClaimTemplates.some((t) => t.name === v.name) &&
            c.name === `${v.name}-${d.name}-${ordinal}`
          );
        }),
    );
  },
  volume(
    world: Pick<World, "kubePvcs" | "kubePvs">,
    d: { projectId: string; cluster: string; namespace: string },
    claim: string,
  ): KubePv | undefined {
    const c = world.kubePvcs.find(
      (c) => sameCluster(d, c) && c.namespace === d.namespace && c.name === claim,
    );
    return (
      c && world.kubePvs.find((p) => sameCluster(p, c) && p.name === c.volumeName && !p.released)
    );
  },
  reason(
    world: Pick<World, "kubeStorageClasses" | "kubeDeployments" | "kubeStatefulSets">,
    c: KubePvc,
  ): string {
    if (c.deleting) return "PVC deletion requested; waiting for consuming Pods to be removed.";
    if (c.volumeName) return "Bound";
    if (!c.storageClassName)
      return "No storage class; static PersistentVolume binding is not supported on gcloud-sim.";
    const sc = KubeStorage.classes(world, { projectId: c.projectId, name: c.cluster }).find(
      (s) => s.name === c.storageClassName,
    );
    if (!sc) return `StorageClass ${c.storageClassName} not found`;
    return "WaitForFirstConsumer: waiting for a Pod to consume the claim.";
  },
  /** Dynamic provisioning and PVC protection are explicit, immediate teaching models. */
  reconcile<T extends KubeStorageState>(world: T): T {
    let sequence = world.sequence;
    let pvs = [...world.kubePvs];
    const claims: KubePvc[] = [];
    for (const c of world.kubePvcs) {
      const consumers = KubeStorage.consumers(world, c);
      if (c.deleting && !consumers.length) {
        pvs = pvs.flatMap((p) => {
          if (!sameCluster(p, c) || p.name !== c.volumeName) return [p];
          return p.reclaimPolicy === "Retain" ? [{ ...p, released: true }] : [];
        });
        continue;
      }
      if (c.volumeName || c.deleting) {
        claims.push(c);
        continue;
      }
      const sc = KubeStorage.classes(world, { projectId: c.projectId, name: c.cluster }).find(
        (s) => s.name === c.storageClassName,
      );
      if (!sc || (sc.bindingMode === "WaitForFirstConsumer" && !consumers.length)) {
        claims.push(c);
        continue;
      }
      while (pvs.some((p) => p.name === `pvc-sim-${sequence}` && sameCluster(p, c))) sequence += 1;
      const volumeName = `pvc-sim-${sequence++}`;
      pvs.push({
        projectId: c.projectId,
        cluster: c.cluster,
        name: volumeName,
        namespace: c.namespace,
        claim: c.name,
        storageClassName: sc.name,
        storageGi: c.storageGi,
        reclaimPolicy: sc.reclaimPolicy,
        released: false,
        files: [],
        createdAt: c.createdAt,
      });
      claims.push({ ...c, volumeName });
    }
    return { ...world, sequence, kubePvcs: claims, kubePvs: pvs };
  },
  classRecord(s: KubeStorageClass): JsonRecord {
    return {
      apiVersion: "storage.k8s.io/v1",
      kind: "StorageClass",
      metadata: { name: s.name, ...(s.createdAt ? { creationTimestamp: s.createdAt } : {}) },
      provisioner: s.provisioner,
      parameters: { type: s.diskType },
      reclaimPolicy: s.reclaimPolicy,
      volumeBindingMode: s.bindingMode,
      allowVolumeExpansion: s.allowVolumeExpansion,
    };
  },
  claimRecord(
    world: Pick<World, "kubeStorageClasses" | "kubeDeployments" | "kubeStatefulSets" | "kubePvs">,
    c: KubePvc,
  ): JsonRecord {
    const pv = world.kubePvs.find((p) => sameCluster(p, c) && p.name === c.volumeName);
    return {
      apiVersion: "v1",
      kind: "PersistentVolumeClaim",
      metadata: {
        name: c.name,
        namespace: c.namespace,
        creationTimestamp: c.createdAt,
        ...(c.deleting ? { deletionTimestamp: c.deleting } : {}),
      },
      spec: {
        accessModes: ["ReadWriteOnce"],
        volumeMode: "Filesystem",
        storageClassName: c.storageClassName,
        resources: { requests: { storage: `${c.storageGi}Gi` } },
        ...(c.volumeName ? { volumeName: c.volumeName } : {}),
      },
      status: {
        phase: c.volumeName ? "Bound" : "Pending",
        ...(pv
          ? { capacity: { storage: `${pv.storageGi}Gi` }, accessModes: ["ReadWriteOnce"] }
          : {}),
      },
      simulator: { reason: KubeStorage.reason(world, c) },
    };
  },
  volumeRecord(p: KubePv): JsonRecord {
    return {
      apiVersion: "v1",
      kind: "PersistentVolume",
      metadata: { name: p.name, creationTimestamp: p.createdAt },
      spec: {
        capacity: { storage: `${p.storageGi}Gi` },
        accessModes: ["ReadWriteOnce"],
        volumeMode: "Filesystem",
        storageClassName: p.storageClassName,
        persistentVolumeReclaimPolicy: p.reclaimPolicy,
        claimRef: { name: p.claim, namespace: p.namespace },
        csi: {
          driver: "pd.csi.storage.gke.io",
          volumeHandle: `simulated://${p.projectId}/${p.cluster}/${p.name}`,
        },
      },
      status: { phase: p.released ? "Released" : "Bound" },
    };
  },
  valid(world: KubeStorageState): boolean {
    const ids = [
      world.kubeStorageClasses.map((r) => `${r.projectId}/${r.cluster}/${r.name}`),
      world.kubePvcs.map((r) => `${r.projectId}/${r.cluster}/${r.namespace}/${r.name}`),
      world.kubePvs.map((r) => `${r.projectId}/${r.cluster}/${r.name}`),
    ];
    if (ids.some((entries) => new Set(entries).size !== entries.length)) return false;
    if (
      world.kubeStorageClasses.some(
        (s) =>
          !name(s.name) ||
          KubeStorage.builtin(s.name) ||
          s.provisioner !== "pd.csi.storage.gke.io" ||
          !["pd-balanced", "pd-ssd"].includes(s.diskType) ||
          !["Immediate", "WaitForFirstConsumer"].includes(s.bindingMode) ||
          !["Delete", "Retain"].includes(s.reclaimPolicy) ||
          typeof s.allowVolumeExpansion !== "boolean" ||
          !Number.isFinite(Date.parse(s.createdAt)),
      )
    )
      return false;
    if (
      world.kubePvcs.some(
        (c) =>
          !name(c.name) ||
          !name(c.namespace) ||
          (c.storageClassName !== "" && !name(c.storageClassName)) ||
          !sizeValid(c.storageGi) ||
          typeof c.deleting !== "string" ||
          (c.deleting !== "" && !Number.isFinite(Date.parse(c.deleting))) ||
          !Number.isFinite(Date.parse(c.createdAt)) ||
          (c.volumeName !== "" &&
            !world.kubePvs.some(
              (p) =>
                sameCluster(p, c) &&
                p.name === c.volumeName &&
                !p.released &&
                p.namespace === c.namespace &&
                p.claim === c.name &&
                p.storageClassName === c.storageClassName &&
                p.storageGi >= c.storageGi,
            )),
      )
    )
      return false;
    if (
      world.kubePvs.some(
        (p) =>
          !name(p.name) ||
          !name(p.namespace) ||
          !name(p.claim) ||
          !name(p.storageClassName) ||
          !sizeValid(p.storageGi) ||
          !["Delete", "Retain"].includes(p.reclaimPolicy) ||
          typeof p.released !== "boolean" ||
          !Number.isFinite(Date.parse(p.createdAt)) ||
          (!p.released &&
            !world.kubePvcs.some((c) => sameCluster(p, c) && c.volumeName === p.name)) ||
          p.files.length > 100 ||
          new Set(p.files.map((f) => f.path)).size !== p.files.length ||
          p.files.some(
            (f) =>
              !KubeVolumes.relativePath(f.path) ||
              p.files.some(
                (other) =>
                  other !== f &&
                  (other.path.startsWith(`${f.path}/`) || f.path.startsWith(`${other.path}/`)),
              ) ||
              !Result.isOk(KubeBinary.parse(f.value)) ||
              Result.unwrapOr(KubeBinary.parse(f.value), "") !== f.value,
          ) ||
          p.files.reduce((n, f) => n + KubeBinary.size(f.value), 0) > 1048576,
      )
    )
      return false;
    return true;
  },
} as const;
