import { type KubeDeployment, KubeName, KubePod } from "@/engine/domains/kubernetes";
import type { JsonRecord } from "@/types/Json";
import { Result } from "@/utils/Result";

export type KubeConfig = Readonly<{
  projectId: string;
  cluster: string;
  kind: "configmap" | "secret";
  name: string;
  data: readonly Readonly<{ key: string; value: string }>[];
  /** Keys managed by the last simulated client-side apply. */
  lastAppliedKeys: readonly string[];
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
export const KubeConfig = {
  validate(c: KubeConfig): Result<KubeConfig, string> {
    if (!Result.isOk(KubeName.parse(c.name))) return Result.err("Invalid configuration name.");
    if (
      c.lastAppliedKeys.length > 100 ||
      new Set(c.lastAppliedKeys).size !== c.lastAppliedKeys.length ||
      c.lastAppliedKeys.some((key) => !validKey(key))
    )
      return Result.err("Invalid last-applied configuration keys.");
    if (c.data.length > 100 || new Set(c.data.map((e) => e.key)).size !== c.data.length)
      return Result.err("Configuration keys must be unique (maximum 100 on gcloud-sim).");
    if (
      c.data.some((e) => !validKey(e.key)) ||
      new TextEncoder().encode(JSON.stringify(c.data)).length > 1048576
    )
      return Result.err("Invalid configuration key or data exceeds 1 MiB.");
    return Result.ok(c);
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
      metadata: { name: c.name, namespace: "default", creationTimestamp: c.createdAt },
      ...(c.kind === "secret" ? { type: "Opaque" } : {}),
      data,
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
export const KubeRuntime = {
  environment(
    configs: readonly KubeConfig[],
    d: KubeDeployment,
    podName: string,
  ): Result<PodEnvironment, string> {
    const cached = d.podEnvironments.find((p) => p.podName === podName);
    if (cached) return Result.ok(cached);
    const values: { name: string; value: string }[] = [];
    for (const e of d.env) {
      if (e.source === "literal") {
        values.push({ name: e.name, value: e.value });
        continue;
      }
      const config = configs.find(
        (c) =>
          c.projectId === d.projectId &&
          c.cluster === d.cluster &&
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
  reconcile(configs: readonly KubeConfig[], d: KubeDeployment): KubeDeployment {
    const podEnvironments = KubePod.fromDeployment(d).flatMap((p) => {
      const env = KubeRuntime.environment(configs, d, p.name);
      return Result.isOk(env) ? [env.value] : [];
    });
    return { ...d, podEnvironments };
  },
  error(configs: readonly KubeConfig[], d: KubeDeployment, podName: string): string {
    const env = KubeRuntime.environment(configs, d, podName);
    return Result.isOk(env) ? "" : env.error;
  },
} as const;
