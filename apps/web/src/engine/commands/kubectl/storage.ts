import { CommandFailure } from "@/engine/cli/command-failure";
import {
  Column,
  CommandOutput,
  type CommandResult,
  OutputMessage,
  ParsedArgs,
} from "@/engine/cli/command-spec";
import { ImagePull } from "@/engine/domains/image-pull";
import { KubeRuntime } from "@/engine/domains/kube-config";
import { KubeBinary } from "@/engine/domains/kube-config/binary";
import type { StorageManifest } from "@/engine/domains/kube-manifest/storage";
import { type KubePvc, KubeStorage, type KubeStorageClass } from "@/engine/domains/kube-storage";
import { KubeVolumes } from "@/engine/domains/kube-volume";
import { KubePod } from "@/engine/domains/kubernetes";
import type { GkeCluster } from "@/engine/domains/managed-services";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
import { kubePermission } from "./configuration";
import type { KubectlContext } from "./context";

export type StorageKind = "storageclass" | "pvc" | "pv";
export const storagePermission = (kind: StorageKind, verb: string) =>
  `container.${{ storageclass: "storageClasses", pvc: "persistentVolumeClaims", pv: "persistentVolumes" }[kind]}.${verb}`;
const invalid = (message: string) => Result.err(CommandFailure.invalidArgumentWith(message));
const missing = (kind: string, name: string) =>
  Result.err(CommandFailure.notFoundWith(`${kind} "${name}" not found`));
const inCluster = (cluster: GkeCluster) => (r: { projectId: string; cluster: string }) =>
  r.projectId === cluster.projectId && r.cluster === cluster.name;
const finish = (world: World, message: string, hint?: string): CommandResult =>
  Result.ok({
    world: World.reconcileKubeStorage(world),
    output: CommandOutput.messages(
      OutputMessage.plain(message),
      ...(hint ? [OutputMessage.hint(hint)] : []),
    ),
  });

export const removeStorage = (
  ctx: KubectlContext,
  cluster: GkeCluster,
  kind: StorageKind,
  name: string,
): CommandResult => {
  const allowed = kubePermission(ctx, storagePermission(kind, "delete"));
  if (!Result.isOk(allowed)) return allowed;
  if (kind === "storageclass") {
    if (KubeStorage.builtin(name))
      return invalid("Built-in StorageClasses are read-only on gcloud-sim.");
    const sc = ctx.world.kubeStorageClasses.find((s) => inCluster(cluster)(s) && s.name === name);
    if (!sc) return missing(kind, name);
    return finish(
      { ...ctx.world, kubeStorageClasses: ctx.world.kubeStorageClasses.filter((s) => s !== sc) },
      `storageclass.storage.k8s.io/${name} deleted`,
    );
  }
  if (kind === "pv") {
    const pv = ctx.world.kubePvs.find((p) => inCluster(cluster)(p) && p.name === name);
    if (!pv) return missing(kind, name);
    if (!pv.released)
      return invalid("Bound PV is protected; remove consuming Pods and delete the PVC first.");
    return finish(
      { ...ctx.world, kubePvs: ctx.world.kubePvs.filter((p) => p !== pv) },
      `persistentvolume/${name} deleted`,
      "gcloud-sim: PVの教材記録を削除しました。実環境のRetainディスクはPV削除だけでは消えず、別の管理操作が必要です。",
    );
  }
  const c = ctx.world.kubePvcs.find(
    (c) => inCluster(cluster)(c) && c.namespace === ctx.namespace && c.name === name,
  );
  if (!c) return missing(kind, name);
  const used = KubeStorage.consumers(ctx.world, c).length > 0;
  return finish(
    {
      ...ctx.world,
      kubePvcs: ctx.world.kubePvcs.map((p) =>
        p === c ? { ...c, deleting: c.deleting || ctx.now } : p,
      ),
    },
    `persistentvolumeclaim/${name} ${used ? "deletion requested (Terminating: protected by consuming Pods)" : "deleted"}`,
  );
};
export const applyStorage = (
  ctx: KubectlContext,
  cluster: GkeCluster,
  m: StorageManifest,
  action: "create" | "apply" | "delete",
): CommandResult => {
  if (action === "delete") return removeStorage(ctx, cluster, m.kind, m.name);
  const existing =
    m.kind === "storageclass"
      ? KubeStorage.classes(ctx.world, cluster).find((s) => s.name === m.name)
      : ctx.world.kubePvcs.find(
          (c) => inCluster(cluster)(c) && c.namespace === ctx.namespace && c.name === m.name,
        );
  for (const verb of action === "apply" ? ["get", existing ? "update" : "create"] : ["create"]) {
    const allowed = kubePermission(ctx, storagePermission(m.kind, verb));
    if (!Result.isOk(allowed)) return allowed;
  }
  if (action === "create" && existing)
    return Result.err(CommandFailure.alreadyExistsWith(`${m.kind} "${m.name}" already exists`));
  if (m.kind === "storageclass") {
    if (KubeStorage.builtin(m.name))
      return invalid("Built-in StorageClasses are read-only on gcloud-sim.");
    const current = existing as KubeStorageClass | undefined;
    if (
      current &&
      (current.diskType !== m.diskType ||
        current.bindingMode !== m.bindingMode ||
        current.reclaimPolicy !== m.reclaimPolicy)
    )
      return invalid(
        "StorageClass parameters, binding mode and reclaim policy are immutable; use a new class name.",
      );
    const next: KubeStorageClass = {
      name: m.name,
      diskType: m.diskType,
      bindingMode: m.bindingMode,
      reclaimPolicy: m.reclaimPolicy,
      allowVolumeExpansion: m.allowVolumeExpansion,
      projectId: cluster.projectId,
      cluster: cluster.name,
      provisioner: "pd.csi.storage.gke.io",
      createdAt: current?.createdAt ?? ctx.now,
    };
    const unchanged = current?.allowVolumeExpansion === next.allowVolumeExpansion;
    return finish(
      {
        ...ctx.world,
        kubeStorageClasses: current
          ? ctx.world.kubeStorageClasses.map((s) => (s === current ? next : s))
          : [...ctx.world.kubeStorageClasses, next],
      },
      `storageclass.storage.k8s.io/${m.name} ${!current ? "created" : unchanged ? "unchanged" : "configured"}`,
    );
  }
  const current = existing as KubePvc | undefined;
  if (current?.deleting)
    return invalid("PVC is Terminating; remove consuming Pods before recreating it.");
  if (current && current.storageClassName !== m.storageClassName)
    return invalid("PVC storageClassName is immutable; delete and recreate the claim.");
  if (current && m.storageGi < current.storageGi) return invalid("PVC capacity cannot shrink.");
  if (
    current?.volumeName &&
    m.storageGi > current.storageGi &&
    !KubeStorage.classes(ctx.world, cluster).some(
      (s) => s.name === current.storageClassName && s.allowVolumeExpansion,
    )
  )
    return invalid("StorageClass does not allow volume expansion.");
  const next: KubePvc = {
    name: m.name,
    storageGi: m.storageGi,
    storageClassName: m.storageClassName,
    projectId: cluster.projectId,
    cluster: cluster.name,
    namespace: ctx.namespace,
    volumeName: current?.volumeName ?? "",
    deleting: "",
    createdAt: current?.createdAt ?? ctx.now,
  };
  const kubePvs = ctx.world.kubePvs.map((p) =>
    current && inCluster(cluster)(p) && p.name === current.volumeName
      ? { ...p, storageGi: m.storageGi }
      : p,
  );
  return finish(
    {
      ...ctx.world,
      kubePvs,
      kubePvcs: current
        ? ctx.world.kubePvcs.map((c) => (c === current ? next : c))
        : [...ctx.world.kubePvcs, next],
    },
    `persistentvolumeclaim/${m.name} ${!current ? "created" : current.storageGi === next.storageGi ? "unchanged" : "configured"}`,
  );
};
export const storageListing = (
  ctx: KubectlContext,
  cluster: GkeCluster,
  kind: StorageKind,
  wanted: Option<string>,
) => {
  const records =
    kind === "storageclass"
      ? KubeStorage.classes(ctx.world, cluster).map((s) => ({
          ...KubeStorage.classRecord(s),
          name: s.name,
          driver: s.provisioner,
          binding: s.bindingMode,
          reclaim: s.reclaimPolicy,
          expansion: String(s.allowVolumeExpansion),
        }))
      : kind === "pvc"
        ? ctx.world.kubePvcs
            .filter((c) => inCluster(cluster)(c) && c.namespace === ctx.namespace)
            .map((c) => ({
              ...KubeStorage.claimRecord(ctx.world, c),
              name: c.name,
              phase: c.deleting ? "Terminating" : c.volumeName ? "Bound" : "Pending",
              volume: c.volumeName || "<none>",
              capacity: c.volumeName ? `${c.storageGi}Gi` : "",
              class: c.storageClassName || "<none>",
              access: c.volumeName ? "RWO" : "",
            }))
        : ctx.world.kubePvs.filter(inCluster(cluster)).map((p) => ({
            ...KubeStorage.volumeRecord(p),
            name: p.name,
            phase: p.released ? "Released" : "Bound",
            capacity: `${p.storageGi}Gi`,
            class: p.storageClassName,
            reclaim: p.reclaimPolicy,
            claim: `${p.namespace}/${p.claim}`,
            access: "RWO",
          }));
  const rows = Option.isSome(wanted) ? records.filter((r) => r.name === wanted.value) : records;
  if (Option.isSome(wanted) && !rows.length) return missing(kind, wanted.value);
  const columns = [
    Column.create("NAME", "name"),
    ...(kind === "storageclass"
      ? [
          Column.create("PROVISIONER", "driver"),
          Column.create("RECLAIMPOLICY", "reclaim"),
          Column.create("VOLUMEBINDINGMODE", "binding"),
          Column.create("ALLOWVOLUMEEXPANSION", "expansion"),
        ]
      : [
          Column.create("STATUS", "phase"),
          Column.create(kind === "pvc" ? "VOLUME" : "CLAIM", kind === "pvc" ? "volume" : "claim"),
          Column.create("CAPACITY", "capacity"),
          Column.create("ACCESS MODES", "access"),
          Column.create("STORAGECLASS", "class"),
          ...(kind === "pv" ? [Column.create("RECLAIM POLICY", "reclaim")] : []),
        ]),
  ];
  return Result.ok({ rows, columns });
};
/** Explicit simulated application write, never evaluates a shell or accesses the host filesystem. */
export const writePersistentFile = (
  ctx: KubectlContext,
  cluster: GkeCluster,
  args: ParsedArgs,
): CommandResult => {
  const name = ParsedArgs.requiredPositional(args, 0);
  const d = World.kubeDeploymentsOf(ctx.world, cluster, ctx.namespace).find((d) => d.name === name);
  if (!d) return missing("deployment", name);
  const path = ParsedArgs.string(args, "path");
  const content = ParsedArgs.string(args, "content");
  if (!Option.isSome(path) || !Option.isSome(content))
    return invalid("--path and --content are required.");
  const pod = KubePod.fromDeployment(d)[0];
  if (!pod) return invalid("Deployment has no consuming Pods.");
  const error =
    ImagePull.error(ctx.world, cluster, d.image) || KubeRuntime.error(ctx.world, d, pod.name);
  if (error) return Result.err(CommandFailure.invalidState(error));
  const mount = d.volumeMounts.find((m) => !m.subPath && path.value.startsWith(`${m.mountPath}/`));
  const volume = d.volumes.find(
    (v) => v.name === mount?.name && v.source === "persistentvolumeclaim",
  );
  if (!mount || !volume) return invalid("Path must be inside a mounted PVC directory.");
  if (mount.readOnly || volume.sourceReadOnly) return invalid("PVC mount is read-only.");
  const relative = path.value.slice(mount.mountPath.length + 1);
  if (!KubeVolumes.relativePath(relative))
    return invalid("Use a safe mounted file path without . or .. segments.");
  const pv = KubeStorage.volume(ctx.world, d, volume.resource);
  if (!pv) return invalid("PVC is not Bound.");
  if (pv.files.some((f) => f.path.startsWith(`${relative}/`) || relative.startsWith(`${f.path}/`)))
    return invalid("File path conflicts with an existing file/directory.");
  const value = btoa(
    Array.from(new TextEncoder().encode(content.value), (n) => String.fromCharCode(n)).join(""),
  );
  const files = [
    ...pv.files.filter((f) => f.path !== relative),
    { path: relative, value },
  ].toSorted((a, b) => a.path.localeCompare(b.path));
  if (files.length > 100 || files.reduce((n, f) => n + KubeBinary.size(f.value), 0) > 1048576)
    return invalid("Simulated PV files are limited to 100 files and 1 MiB total.");
  return finish(
    { ...ctx.world, kubePvs: ctx.world.kubePvs.map((p) => (p === pv ? { ...p, files } : p)) },
    `Application wrote ${KubeBinary.size(value)} bytes to ${path.value} on ${pv.name}.`,
  );
};
