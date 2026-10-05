import { KubeNamespace } from "@/engine/domains/kube-namespace";
import { KubeStorage, type KubeStorageClass } from "@/engine/domains/kube-storage";
import { fail, fields, namespace, record } from "./validation";

export type StorageManifest =
  | Readonly<{
      kind: "storageclass";
      name: string;
      namespace: undefined;
      diskType: KubeStorageClass["diskType"];
      bindingMode: KubeStorageClass["bindingMode"];
      reclaimPolicy: KubeStorageClass["reclaimPolicy"];
      allowVolumeExpansion: boolean;
    }>
  | Readonly<{
      kind: "pvc";
      name: string;
      namespace: string | undefined;
      storageClassName: string;
      storageGi: number;
    }>;
export const parseStorage = (r: Record<string, unknown>): StorageManifest => {
  const sc = r.kind === "StorageClass";
  fields(
    r,
    sc
      ? [
          "apiVersion",
          "kind",
          "metadata",
          "provisioner",
          "parameters",
          "reclaimPolicy",
          "volumeBindingMode",
          "allowVolumeExpansion",
        ]
      : ["apiVersion", "kind", "metadata", "spec"],
    "storage manifest",
  );
  if (r.apiVersion !== (sc ? "storage.k8s.io/v1" : "v1"))
    return fail("Invalid storage apiVersion.");
  const m = record(r.metadata, "metadata");
  fields(m, sc ? ["name"] : ["name", "namespace"], "metadata");
  if (!KubeNamespace.valid(m.name)) return fail("Invalid storage resource name.");
  if (sc) {
    if (r.provisioner !== "pd.csi.storage.gke.io")
      return fail("Only pd.csi.storage.gke.io provisioning is supported.");
    const parameters = r.parameters === undefined ? {} : record(r.parameters, "parameters");
    fields(parameters, ["type"], "parameters");
    const diskType = parameters.type ?? "pd-balanced";
    const bindingMode = r.volumeBindingMode ?? "Immediate";
    const reclaimPolicy = r.reclaimPolicy ?? "Delete";
    if (diskType !== "pd-balanced" && diskType !== "pd-ssd")
      return fail("StorageClass type must be pd-balanced or pd-ssd.");
    if (bindingMode !== "Immediate" && bindingMode !== "WaitForFirstConsumer")
      return fail("Invalid volumeBindingMode.");
    if (reclaimPolicy !== "Delete" && reclaimPolicy !== "Retain")
      return fail("Invalid reclaimPolicy.");
    if (r.allowVolumeExpansion !== undefined && typeof r.allowVolumeExpansion !== "boolean")
      return fail("allowVolumeExpansion must be boolean.");
    return {
      kind: "storageclass",
      name: m.name,
      namespace: undefined,
      diskType,
      bindingMode,
      reclaimPolicy,
      allowVolumeExpansion: r.allowVolumeExpansion === true,
    };
  }
  const s = record(r.spec, "PVC spec");
  fields(s, ["accessModes", "volumeMode", "storageClassName", "resources"], "PVC spec");
  if (
    !Array.isArray(s.accessModes) ||
    s.accessModes.length !== 1 ||
    s.accessModes[0] !== "ReadWriteOnce"
  )
    return fail(
      "Only ReadWriteOnce is supported (one node, not one Pod; node scheduling is not simulated).",
    );
  if (s.volumeMode !== undefined && s.volumeMode !== "Filesystem")
    return fail("Only Filesystem volumeMode is supported.");
  if (
    typeof s.storageClassName !== "string" ||
    (s.storageClassName !== "" && !KubeNamespace.valid(s.storageClassName))
  )
    return fail(
      "Specify storageClassName explicitly (e.g. standard-rwo); default selection is not simulated.",
    );
  const resources = record(s.resources, "PVC resources");
  fields(resources, ["requests"], "PVC resources");
  const requests = record(resources.requests, "PVC requests");
  fields(requests, ["storage"], "PVC requests");
  const storageGi = KubeStorage.capacity(requests.storage);
  if (storageGi === undefined)
    return fail("Storage request must be an integer from 1Gi to 1024Gi on gcloud-sim.");
  return {
    kind: "pvc",
    name: m.name,
    namespace: namespace(m.namespace),
    storageClassName: s.storageClassName,
    storageGi,
  };
};
