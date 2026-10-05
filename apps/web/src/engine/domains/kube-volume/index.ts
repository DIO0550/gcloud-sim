import type { KubeConfig } from "@/engine/domains/kube-config";
import { KubeBinary } from "@/engine/domains/kube-config/binary";
import { KubeStorage } from "@/engine/domains/kube-storage";
import type { KubeDeployment } from "@/engine/domains/kubernetes";
import type { World } from "@/engine/domains/world";
import type { JsonRecord } from "@/types/Json";
import { Result } from "@/utils/Result";

export type KubeVolume = Readonly<{
  name: string;
  source: "configmap" | "secret" | "persistentvolumeclaim";
  sourceReadOnly?: boolean;
  resource: string;
  optional: boolean;
  items: readonly Readonly<{ key: string; path: string }>[];
}>;
export type KubeVolumeMount = Readonly<{
  name: string;
  mountPath: string;
  subPath: string;
  readOnly: boolean;
}>;
export type PodFiles = Readonly<{
  podName: string;
  files: readonly Readonly<{ path: string; value: string }>[];
}>;
const nameValid = (s: string) => /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/.test(s);
const relativePath = (s: string) =>
  s.length > 0 &&
  s.length <= 1024 &&
  s
    .split("/")
    .every(
      (part) =>
        part.length > 0 &&
        part !== "." &&
        part !== ".." &&
        Array.from(part).every(
          (c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127 && c !== "\\",
        ),
    );
const absolutePath = (s: string) => s.startsWith("/") && relativePath(s.slice(1));
const encode = (s: string) =>
  btoa(Array.from(new TextEncoder().encode(s), (n) => String.fromCharCode(n)).join(""));
const overlaps = (a: string, b: string) =>
  a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

const canonical = (value: string): boolean => {
  const parsed = KubeBinary.parse(value);
  return Result.isOk(parsed) && parsed.value === value && KubeBinary.size(value) <= 1048576;
};

export const KubeVolumes = {
  relativePath,
  validate(volumes: readonly KubeVolume[], mounts: readonly KubeVolumeMount[]): boolean {
    if (
      volumes.length > 20 ||
      mounts.length > 20 ||
      new Set(volumes.map((v) => v.name)).size !== volumes.length
    )
      return false;
    if (
      volumes.some(
        (v) =>
          !nameValid(v.name) ||
          !nameValid(v.resource) ||
          !["configmap", "secret", "persistentvolumeclaim"].includes(v.source) ||
          (v.source === "persistentvolumeclaim" &&
            (v.optional || v.items.length > 0 || typeof v.sourceReadOnly !== "boolean")) ||
          (v.source !== "persistentvolumeclaim" && v.sourceReadOnly !== undefined) ||
          typeof v.optional !== "boolean" ||
          v.items.length > 100 ||
          new Set(v.items.map((i) => i.key)).size !== v.items.length ||
          v.items.some(
            (i, index) =>
              !/^[a-zA-Z0-9._-]{1,253}$/.test(i.key) ||
              !relativePath(i.path) ||
              v.items.slice(0, index).some((other) => overlaps(other.path, i.path)),
          ),
      )
    )
      return false;
    return mounts.every(
      (m, index) =>
        volumes.some((v) => v.name === m.name) &&
        !(
          m.subPath &&
          volumes.some((v) => v.name === m.name && v.source === "persistentvolumeclaim")
        ) &&
        absolutePath(m.mountPath) &&
        typeof m.readOnly === "boolean" &&
        (m.subPath === "" || relativePath(m.subPath)) &&
        !mounts.slice(0, index).some((other) => overlaps(other.mountPath, m.mountPath)),
    );
  },
  equal(
    a: Pick<KubeDeployment, "volumes" | "volumeMounts">,
    b: Pick<KubeDeployment, "volumes" | "volumeMounts">,
  ): boolean {
    return (
      JSON.stringify(a.volumes) === JSON.stringify(b.volumes) &&
      JSON.stringify(a.volumeMounts) === JSON.stringify(b.volumeMounts)
    );
  },
  fields(volumes: readonly KubeVolume[]): JsonRecord {
    if (!volumes.length) return {};
    return {
      volumes: volumes.map((v) => ({
        name: v.name,
        ...(v.source === "persistentvolumeclaim"
          ? {
              persistentVolumeClaim: { claimName: v.resource, readOnly: v.sourceReadOnly ?? false },
            }
          : {
              [v.source === "configmap" ? "configMap" : "secret"]: {
                [v.source === "configmap" ? "name" : "secretName"]: v.resource,
                optional: v.optional,
                ...(v.items.length ? { items: v.items } : {}),
              },
            }),
      })),
    };
  },
  mountFields(mounts: readonly KubeVolumeMount[]): JsonRecord {
    if (!mounts.length) return {};
    return {
      volumeMounts: mounts.map((m) => ({
        name: m.name,
        mountPath: m.mountPath,
        readOnly: m.readOnly,
        ...(m.subPath ? { subPath: m.subPath } : {}),
      })),
    };
  },
  /** Resolve a simulated projection. Existing mounts survive failed source refreshes. */
  resolve(
    configs: readonly KubeConfig[],
    d: KubeDeployment,
    podName: string,
    storage?: Pick<World, "kubePvcs" | "kubePvs">,
  ): Result<PodFiles, string> {
    const cached = d.podFiles.find((p) => p.podName === podName);
    const projected = new Map<string, readonly { path: string; value: string }[]>();
    // Persistent data must stay live even when configuration projection refresh fails.
    for (const v of d.volumes.filter((v) => v.source === "persistentvolumeclaim")) {
      const pv = storage && KubeStorage.volume(storage, d, v.resource);
      if (!pv)
        return Result.err(
          `ContainerCreating: FailedMount: persistentvolumeclaim/${v.resource} is missing or Pending`,
        );
      projected.set(v.name, pv.files);
    }
    const persistentMounts = d.volumeMounts.filter((m) => projected.has(m.name));
    const fail = (message: string): Result<PodFiles, string> => {
      if (!cached) return Result.err(`ContainerCreating: FailedMount: ${message}`);
      if (!persistentMounts.length) return Result.ok(cached);
      const configurationFiles = cached.files.filter(
        (f) => !persistentMounts.some((m) => f.path.startsWith(`${m.mountPath}/`)),
      );
      const persistentFiles = persistentMounts.flatMap((m) =>
        (projected.get(m.name) ?? []).map((f) => ({
          path: `${m.mountPath}/${f.path}`,
          value: f.value,
        })),
      );
      return Result.ok({ podName, files: [...configurationFiles, ...persistentFiles] });
    };
    for (const v of d.volumes) {
      if (v.source === "persistentvolumeclaim") continue;
      const config = configs.find(
        (c) =>
          c.projectId === d.projectId &&
          c.cluster === d.cluster &&
          c.namespace === d.namespace &&
          c.kind === v.source &&
          c.name === v.resource,
      );
      if (!config && !v.optional) return fail(`${v.source}/${v.resource} not found`);
      const data = [
        ...(config?.data ?? []).map((e) => ({ key: e.key, value: encode(e.value) })),
        ...(config?.binaryData ?? []),
      ];
      const files: { path: string; value: string }[] = [];
      const items = v.items.length ? v.items : data.map((e) => ({ key: e.key, path: e.key }));
      for (const item of items) {
        const entry = data.find((e) => e.key === item.key);
        if (!entry && !v.optional)
          return fail(`${v.source}/${v.resource} key ${item.key} not found`);
        if (entry) files.push({ path: item.path, value: entry.value });
      }
      if (files.some((f) => !relativePath(f.path)))
        return fail(`volume ${v.name} contains an invalid file path`);
      if (files.some((f, i) => files.slice(0, i).some((other) => overlaps(f.path, other.path))))
        return fail(`volume ${v.name} contains conflicting file paths`);
      projected.set(v.name, files);
    }
    const files: { path: string; value: string }[] = [];
    for (const m of d.volumeMounts) {
      if (m.subPath) {
        const previous = cached?.files.find((f) => f.path === m.mountPath);
        if (previous) {
          files.push(previous);
          continue;
        }
        const file = projected.get(m.name)?.find((f) => f.path === m.subPath);
        if (!file) return fail(`volume ${m.name} subPath ${m.subPath} not found`);
        files.push({ path: m.mountPath, value: file.value });
        continue;
      }
      for (const f of projected.get(m.name) ?? [])
        files.push({ path: `${m.mountPath}/${f.path}`, value: f.value });
    }
    return Result.ok({ podName, files });
  },
  validFiles(d: KubeDeployment, podNames: readonly string[]): boolean {
    return (
      new Set(d.podFiles.map((p) => p.podName)).size === d.podFiles.length &&
      d.podFiles.every(
        (p) =>
          podNames.includes(p.podName) &&
          p.files.length <= 2000 &&
          new Set(p.files.map((f) => f.path)).size === p.files.length &&
          p.files.every(
            (f) =>
              canonical(f.value) &&
              d.volumeMounts.some((m) =>
                m.subPath
                  ? f.path === m.mountPath
                  : f.path.startsWith(`${m.mountPath}/`) &&
                    relativePath(f.path.slice(m.mountPath.length + 1)),
              ),
          ),
      )
    );
  },
  content(file: { value: string }): Result<string, string> {
    try {
      return Result.ok(
        new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
          Uint8Array.from(atob(file.value), (c) => c.charCodeAt(0)),
        ),
      );
    } catch {
      return Result.err("File contains non-UTF-8 bytes; use exec -- base64 PATH to inspect it.");
    }
  },
} as const;
