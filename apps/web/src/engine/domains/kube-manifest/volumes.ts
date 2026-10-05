import { type KubeVolume, type KubeVolumeMount, KubeVolumes } from "@/engine/domains/kube-volume";
import { fail, fields, record } from "./validation";

const array = (value: unknown, label: string): unknown[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return fail(`${label} must be an array.`);
  return value;
};
const text = (value: unknown, label: string): string => {
  if (typeof value !== "string") return fail(`${label} must be a string.`);
  return value;
};
const flag = (value: unknown, label: string): boolean => {
  if (value === undefined) return false;
  if (typeof value !== "boolean") return fail(`${label} must be a boolean.`);
  return value;
};
export const parseVolumes = (
  value: unknown,
  mounted: unknown,
): { volumes: readonly KubeVolume[]; volumeMounts: readonly KubeVolumeMount[] } => {
  const volumes = array(value, "volumes").map((entry): KubeVolume => {
    const v = record(entry, "volume");
    fields(v, ["name", "configMap", "secret"], "volume");
    if ((v.configMap === undefined) === (v.secret === undefined))
      return fail("Volume requires exactly one configMap or secret source.");
    const secret = v.secret !== undefined;
    const source = record(secret ? v.secret : v.configMap, "volume source");
    fields(source, [secret ? "secretName" : "name", "optional", "items"], "volume source");
    return {
      name: text(v.name, "volume.name"),
      source: secret ? "secret" : "configmap",
      resource: text(secret ? source.secretName : source.name, "volume resource"),
      optional: flag(source.optional, "optional"),
      items: array(source.items, "items").map((entry) => {
        const item = record(entry, "volume item");
        fields(item, ["key", "path"], "volume item");
        return { key: text(item.key, "item.key"), path: text(item.path, "item.path") };
      }),
    };
  });
  const volumeMounts = array(mounted, "volumeMounts").map((entry): KubeVolumeMount => {
    const m = record(entry, "volumeMount");
    fields(m, ["name", "mountPath", "subPath", "readOnly"], "volumeMount");
    return {
      name: text(m.name, "mount.name"),
      mountPath: text(m.mountPath, "mountPath"),
      subPath: m.subPath === undefined ? "" : text(m.subPath, "subPath"),
      readOnly: flag(m.readOnly, "readOnly"),
    };
  });
  if (!KubeVolumes.validate(volumes, volumeMounts))
    return fail(
      "Invalid configuration volumes or volumeMounts (unique names, safe paths and non-overlapping mounts required).",
    );
  return { volumes, volumeMounts };
};
