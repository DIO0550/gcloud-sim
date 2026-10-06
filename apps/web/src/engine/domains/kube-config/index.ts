import { KubeLabels } from "@/engine/domains/kube-labels";
import { KubeNamespace } from "@/engine/domains/kube-namespace";
import { KubeVolumes } from "@/engine/domains/kube-volume";
import { type KubeDeployment, KubeName, KubePod } from "@/engine/domains/kubernetes";
import type { World } from "@/engine/domains/world";
import type { JsonRecord } from "@/types/Json";
import { Result } from "@/utils/Result";
import { KubeBinary } from "./binary";

export type KubeConfig = Readonly<{
  projectId: string;
  cluster: string;
  namespace: string;
  kind: "configmap" | "secret";
  name: string;
  immutable: boolean;
  labels: KubeLabels;
  /** Metadata label keys managed by the last simulated client-side apply. */
  lastAppliedLabelKeys: readonly string[];
  data: readonly Readonly<{ key: string; value: string }>[];
  /** ConfigMap-only bytes, stored as canonical base64. */
  binaryData: readonly Readonly<{ key: string; value: string }>[];
  /** Keys managed by the last simulated client-side apply. */
  lastAppliedKeys: readonly string[];
  /** binaryData ownership is separate from text data ownership. */
  lastAppliedBinaryKeys: readonly string[];
  createdAt: string;
}>;
export type KubeEnv = Readonly<{
  name: string;
  source: "literal" | "configmap" | "secret";
  value: string;
  resource: string;
  key: string;
}>;
export type PodEnvironment = Readonly<{
  podName: string;
  values: readonly Readonly<{ name: string; value: string }>[];
}>;
const validKey = (key: string) => /^[a-zA-Z0-9._-]+$/.test(key) && key.length <= 253;
const validEnvName = (name: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
const equalEntries = (a: KubeConfig["data"], b: KubeConfig["data"]): boolean =>
  a.length === b.length &&
  a.every((entry) => b.some((other) => other.key === entry.key && other.value === entry.value));

export const KubeConfig = {
  validate(c: KubeConfig): Result<KubeConfig, string> {
    if (!KubeNamespace.valid(c.namespace)) return Result.err("Invalid Kubernetes namespace.");
    if (!Result.isOk(KubeName.parse(c.name))) return Result.err("Invalid configuration name.");
    if (typeof c.immutable !== "boolean") return Result.err("immutable must be a boolean.");

    const labels = KubeLabels.parse(c.labels);
    if (!Result.isOk(labels)) return Result.err(labels.error);
    if (
      new Set(c.lastAppliedLabelKeys).size !== c.lastAppliedLabelKeys.length ||
      !Result.isOk(
        KubeLabels.parse(Object.fromEntries(c.lastAppliedLabelKeys.map((key) => [key, ""]))),
      )
    )
      return Result.err("Invalid last-applied label keys.");
    if (
      [c.lastAppliedKeys, c.lastAppliedBinaryKeys].some(
        (keys) =>
          keys.length > 100 ||
          new Set(keys).size !== keys.length ||
          keys.some((key) => !validKey(key)),
      )
    )
      return Result.err("Invalid last-applied configuration keys.");
    if (c.kind === "secret" && (c.binaryData.length || c.lastAppliedBinaryKeys.length))
      return Result.err("binaryData is only supported on ConfigMaps.");

    const entries = [...c.data, ...c.binaryData];
    if (entries.length > 100 || new Set(entries.map((e) => e.key)).size !== entries.length)
      return Result.err("Configuration keys must be unique (maximum 100 on gcloud-sim).");

    for (const entry of c.binaryData) {
      const parsed = KubeBinary.parse(entry.value);
      if (!Result.isOk(parsed) || parsed.value !== entry.value)
        return Result.err("binaryData must contain canonical base64.");
    }

    const size =
      c.data.reduce((sum, entry) => sum + new TextEncoder().encode(entry.value).length, 0) +
      c.binaryData.reduce((sum, entry) => sum + KubeBinary.size(entry.value), 0);
    if (entries.some((e) => !validKey(e.key)) || size > 1048576)
      return Result.err("Invalid configuration key or data exceeds 1 MiB.");
    return Result.ok(c);
  },
  update(current: KubeConfig, next: KubeConfig): Result<KubeConfig, string> {
    if (!current.immutable) return Result.ok(next);
    if (!next.immutable)
      return Result.err(
        `${current.kind}/${current.name}: immutable cannot be unset; delete and recreate the resource.`,
      );

    if (!equalEntries(current.data, next.data))
      return Result.err(
        `${current.kind}/${current.name}: data is immutable; delete and recreate the resource.`,
      );

    if (!equalEntries(current.binaryData, next.binaryData))
      return Result.err(
        `${current.kind}/${current.name}: binaryData is immutable; delete and recreate the resource.`,
      );
    return Result.ok(next);
  },
  toRecord(c: KubeConfig, describe = false): JsonRecord {
    const data = Object.fromEntries(
      c.data.map((e) => {
        if (c.kind !== "secret") return [e.key, e.value];
        if (describe) return [e.key, `${new TextEncoder().encode(e.value).length} bytes`];
        return [
          e.key,
          btoa(
            Array.from(new TextEncoder().encode(e.value), (n) => String.fromCharCode(n)).join(""),
          ),
        ];
      }),
    );
    return {
      apiVersion: "v1",
      kind: c.kind === "secret" ? "Secret" : "ConfigMap",
      metadata: {
        name: c.name,
        namespace: c.namespace,
        labels: c.labels,
        creationTimestamp: c.createdAt,
      },
      ...(c.kind === "secret" ? { type: "Opaque" } : {}),
      immutable: c.immutable,
      data,
      ...(c.kind === "configmap" && c.binaryData.length
        ? {
            binaryData: Object.fromEntries(
              c.binaryData.map((e) => [
                e.key,
                describe ? `${KubeBinary.size(e.value)} bytes` : e.value,
              ]),
            ),
          }
        : {}),
    };
  },
} as const;
export const KubeEnv = {
  validName: validEnvName,
  validate(env: readonly KubeEnv[]): boolean {
    if (env.length > 100 || new Set(env.map((e) => e.name)).size !== env.length) return false;
    return env.every(
      (e) =>
        validEnvName(e.name) &&
        (e.source === "literal"
          ? e.resource === "" && e.key === ""
          : e.value === "" && Result.isOk(KubeName.parse(e.resource)) && validKey(e.key)),
    );
  },
  toRecord(e: KubeEnv): JsonRecord {
    if (e.source === "literal") return { name: e.name, value: e.value };
    const field = e.source === "secret" ? "secretKeyRef" : "configMapKeyRef";
    return { name: e.name, valueFrom: { [field]: { name: e.resource, key: e.key } } };
  },
  display(e: KubeEnv): string {
    return e.source === "literal" ? e.value : `${e.source}/${e.resource} key:${e.key}`;
  },
} as const;

/** Successful starts keep their environment; only new/waiting Pods resolve references again. */
type RuntimeSource = readonly KubeConfig[] | Pick<World, "kubeConfigs" | "kubePvcs" | "kubePvs">;
const configsOf = (source: RuntimeSource) =>
  "kubeConfigs" in source ? source.kubeConfigs : source;
const storageOf = (source: RuntimeSource) => ("kubeConfigs" in source ? source : undefined);
export const KubeRuntime = {
  environment(
    source: RuntimeSource,
    d: KubeDeployment,
    podName: string,
  ): Result<PodEnvironment, string> {
    const mounted = KubeVolumes.resolve(configsOf(source), d, podName, storageOf(source));
    if (!Result.isOk(mounted)) return Result.err(mounted.error);
    const cached = d.podEnvironments.find((p) => p.podName === podName);
    if (cached) return Result.ok(cached);
    const values: { name: string; value: string }[] = [];
    for (const e of d.env) {
      if (e.source === "literal") {
        values.push({ name: e.name, value: e.value });
        continue;
      }
      const config = configsOf(source).find(
        (c) =>
          c.projectId === d.projectId &&
          c.cluster === d.cluster &&
          c.namespace === d.namespace &&
          c.kind === e.source &&
          c.name === e.resource,
      );
      const value = config?.data.find((k) => k.key === e.key);
      if (!value)
        return Result.err(
          `CreateContainerConfigError: ${e.source}/${e.resource} key ${e.key} not found`,
        );
      values.push({ name: e.name, value: value.value });
    }
    return Result.ok({ podName, values });
  },
  reconcile<T extends KubeDeployment>(source: RuntimeSource, d: T): T {
    const podEnvironments = KubePod.fromDeployment(d).flatMap((p) => {
      const env = KubeRuntime.environment(source, d, p.name);
      return Result.isOk(env) ? [env.value] : [];
    });
    const podFiles = KubePod.fromDeployment(d).flatMap((p) => {
      const files = KubeVolumes.resolve(configsOf(source), d, p.name, storageOf(source));
      return d.volumes.length > 0 &&
        Result.isOk(files) &&
        (podEnvironments.some((e) => e.podName === p.name) ||
          d.podFiles.some((saved) => saved.podName === p.name))
        ? [files.value]
        : [];
    });
    return { ...d, podEnvironments, podFiles };
  },
  error(source: RuntimeSource, d: KubeDeployment, podName: string): string {
    const env = KubeRuntime.environment(source, d, podName);
    return Result.isOk(env) ? "" : env.error;
  },
} as const;
