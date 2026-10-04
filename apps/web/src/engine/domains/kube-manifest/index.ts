import { isAlias, parseAllDocuments, visit } from "yaml";
import { KubeConfig as Configuration, type KubeConfig } from "@/engine/domains/kube-config";
import { Result } from "@/utils/Result";

import { type HpaManifest, parseHpa } from "./hpa";
import { fail, fields, record } from "./validation";
import { parseWorkload, type WorkloadManifest } from "./workloads";

export type ConfigManifest = Readonly<{
  kind: KubeConfig["kind"];
  name: string;
  data: KubeConfig["data"];
}>;
export type KubeManifest = ConfigManifest | WorkloadManifest | HpaManifest;
const strings = (value: unknown, field: string): [string, string][] =>
  Object.entries(value === undefined ? {} : record(value, field)).map(([key, value]) => {
    if (typeof value !== "string")
      return fail(`${field} values must be strings; quote numbers and booleans.`);
    return [key, value];
  });
const decode = (value: string): string => {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    return fail("Secret data must contain valid base64.");
  try {
    const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail("Only UTF-8 Secret data is supported on gcloud-sim.");
  }
};
const parseResource = (value: unknown): KubeManifest => {
  const r = record(value, "manifest");
  if (r.kind === "HorizontalPodAutoscaler") return parseHpa(r);
  if (r.kind === "Deployment" || r.kind === "Service") return parseWorkload(r);
  if (r.apiVersion !== "v1" || (r.kind !== "ConfigMap" && r.kind !== "Secret"))
    return fail(
      "Virtual manifests support ConfigMap, Secret, apps/v1 Deployment, v1 Service and autoscaling/v2 HorizontalPodAutoscaler.",
    );
  const secret = r.kind === "Secret";
  fields(
    r,
    secret
      ? ["apiVersion", "kind", "metadata", "data", "stringData", "type"]
      : ["apiVersion", "kind", "metadata", "data"],
    "manifest",
  );
  const meta = record(r.metadata, "metadata");
  fields(meta, ["name", "namespace"], "metadata");
  if (meta.namespace !== undefined && meta.namespace !== "default")
    return fail("Only namespace default is supported on gcloud-sim.");
  if (typeof meta.name !== "string") return fail("metadata.name must be a string.");
  if (secret && r.type !== undefined && r.type !== "Opaque")
    return fail("Only Opaque Secrets are supported on gcloud-sim.");
  const data = new Map(strings(r.data, "data").map(([k, v]) => [k, secret ? decode(v) : v]));
  if (secret) for (const [k, v] of strings(r.stringData, "stringData")) data.set(k, v);
  const config = Configuration.validate({
    projectId: "",
    cluster: "",
    kind: secret ? "secret" : "configmap",
    name: meta.name,
    data: Array.from(data, ([key, value]) => ({ key, value })).toSorted((a, b) =>
      a.key.localeCompare(b.key),
    ),
    lastAppliedKeys: [],
    createdAt: "",
  });
  if (!Result.isOk(config)) return fail(config.error);
  return { kind: config.value.kind, name: config.value.name, data: config.value.data };
};
export const KubeManifest = {
  path(path: string): string | undefined {
    const normalized = path.replace(/^\.\//, "");
    const parts = normalized.split("/");
    if (normalized.length > 300 || parts.length > 10 || !/\.(yaml|yml|json)$/.test(normalized))
      return undefined;
    if (
      parts.some(
        (p) =>
          !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/.test(p) ||
          ["__proto__", "prototype", "constructor"].includes(p),
      )
    )
      return undefined;
    return normalized;
  },
  validFiles(files: Readonly<Record<string, string>>): boolean {
    return (
      Object.keys(files).length <= 32 &&
      Object.entries(files).every(
        ([path, text]) => KubeManifest.path(path) === path && text.length <= 64000,
      )
    );
  },
  parse(source: string): Result<readonly KubeManifest[], string> {
    try {
      if (source.length > 64000) return fail("Manifest exceeds 64,000 characters.");
      const docs = parseAllDocuments(source, {
        version: "1.1",
        schema: "yaml-1.1",
        uniqueKeys: true,
        prettyErrors: false,
        stringKeys: true,
      });
      if (!docs.length || docs.length > 32)
        return fail("Use 1 to 32 supported Kubernetes manifests.");
      const resources = docs.map((doc) => {
        if (doc.errors.length || doc.warnings.length)
          return fail("Invalid YAML/JSON manifest (duplicate keys, syntax or tags).");
        visit(doc, (_key, node) => {
          if (isAlias(node) || (node && typeof node === "object" && "tag" in node && node.tag))
            fail("YAML aliases and explicit tags are not supported.");
        });
        return parseResource(doc.toJS({ maxAliasCount: 0 }));
      });
      if (new Set(resources.map((r) => `${r.kind}/${r.name}`)).size !== resources.length)
        return fail("Duplicate resource in manifest file.");
      return Result.ok(resources);
    } catch (e) {
      return Result.err(e instanceof Error ? e.message : "Invalid manifest.");
    }
  },
} as const;

const shopDeployment = (track: string, image: string) => `apiVersion: apps/v1
kind: Deployment
metadata:
  name: shop-${track}
  labels:
    team: storefront
spec:
  replicas: 2
  selector:
    matchLabels:
      app: shop
      track: ${track}
  template:
    metadata:
      labels:
        app: shop
        track: ${track}
    spec:
      containers:
        - name: shop-${track}
          image: ${image}
`;

export const KubeManifestExamples: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "kubernetes-readiness": {
    "ready-web.yaml": `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ready-web
spec:
  replicas: 2
  selector:
    matchLabels:
      app: ready-web
  template:
    metadata:
      labels:
        app: ready-web
    spec:
      containers:
        - name: ready-web
          image: nginx:1
          readinessProbe:
            httpGet:
              path: /ready
              port: 8080
            successThreshold: 2
            failureThreshold: 2
`,
    "ready-service.yaml": `apiVersion: v1
kind: Service
metadata:
  name: ready-service
spec:
  selector:
    app: ready-web
  ports:
    - port: 80
      targetPort: 8080
`,
  },
  "kubernetes-hpa": {
    "autoscale-web.yaml": `apiVersion: apps/v1
kind: Deployment
metadata:
  name: autoscale-web
spec:
  selector:
    matchLabels:
      app: autoscale-web
  template:
    metadata:
      labels:
        app: autoscale-web
    spec:
      containers:
        - name: autoscale-web
          image: nginx:1
          resources:
            requests:
              cpu: 250m
            limits:
              cpu: "1"
`,
    "autoscale-hpa.yaml": `apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: autoscale-web
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: autoscale-web
  minReplicas: 1
  maxReplicas: 3
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 80
`,
  },
  "kubernetes-resources": {
    "resource-web.yaml": `apiVersion: apps/v1
kind: Deployment
metadata:
  name: resource-web
spec:
  replicas: 2
  selector:
    matchLabels:
      app: resource-web
  template:
    metadata:
      labels:
        app: resource-web
    spec:
      containers:
        - name: resource-web
          image: nginx:1
          resources:
            requests:
              cpu: 500m
              memory: 128Mi
            limits:
              cpu: 250m
              memory: 256Mi
`,
  },
  "kubernetes-labels": {
    "shop-blue.yaml": shopDeployment("blue", "nginx:1"),
    "shop-green.yaml": shopDeployment("green", "nginx:2"),
    "shop-service.yaml": `apiVersion: v1
kind: Service
metadata:
  name: shop
  labels:
    team: storefront
spec:
  type: LoadBalancer
  selector:
    app: shop
    track: blue
  ports:
    - port: 80
      targetPort: 80
`,
  },
  "kubernetes-workload": {
    "web-deployment.yaml": `apiVersion: apps/v1
kind: Deployment
metadata:
  name: manifest-web
spec:
  replicas: 2
  selector:
    matchLabels:
      app: manifest-web
  template:
    metadata:
      labels:
        app: manifest-web
    spec:
      containers:
        - name: manifest-web
          image: nginx:1
`,
    "web-service.yaml": `apiVersion: v1
kind: Service
metadata:
  name: manifest-svc
spec:
  type: LoadBalancer
  selector:
    app: wrong-app
  ports:
    - port: 80
      targetPort: 80
`,
  },
  "kubernetes-config": {
    "app-config.yaml": `apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  APP_MODE: staging
  LOG_LEVEL: info
`,
    "app-secret.yaml": `apiVersion: v1
kind: Secret
metadata:
  name: app-secret
type: Opaque
stringData:
  API_TOKEN: demo-token
`,
  },
};
