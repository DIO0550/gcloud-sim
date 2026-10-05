import { isAlias, parseAllDocuments, visit } from "yaml";
import { KubeConfig as Configuration, type KubeConfig } from "@/engine/domains/kube-config";
import { KubeLabels } from "@/engine/domains/kube-labels";
import { KubeNamespace } from "@/engine/domains/kube-namespace";
import { Result } from "@/utils/Result";
import { type HpaManifest, parseHpa } from "./hpa";
import { fail, fields, namespace, record } from "./validation";
import { parseWorkload, type WorkloadManifest } from "./workloads";

export type ConfigManifest = Readonly<{
  kind: KubeConfig["kind"];
  name: string;
  namespace: string | undefined;
  data: KubeConfig["data"];
  labels: KubeLabels;
  immutable: boolean | undefined;
}>;
export type NamespaceManifest = Readonly<{ kind: "namespace"; name: string; namespace: undefined }>;
export type KubeManifest = NamespaceManifest | ConfigManifest | WorkloadManifest | HpaManifest;
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
  if (r.kind === "Namespace") {
    fields(r, ["apiVersion", "kind", "metadata"], "Namespace manifest");
    const meta = record(r.metadata, "metadata");
    fields(meta, ["name"], "Namespace metadata");
    if (r.apiVersion !== "v1" || !KubeNamespace.valid(meta.name))
      return fail("Invalid v1 Namespace name.");
    return { kind: "namespace", name: meta.name, namespace: undefined };
  }
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
      ? ["apiVersion", "kind", "metadata", "data", "stringData", "type", "immutable"]
      : ["apiVersion", "kind", "metadata", "data", "immutable"],
    "manifest",
  );
  if (r.immutable !== undefined && typeof r.immutable !== "boolean")
    return fail("immutable must be a boolean.");

  const meta = record(r.metadata, "metadata");
  fields(meta, ["name", "namespace", "labels"], "metadata");
  const labels = KubeLabels.parse(meta.labels === undefined ? {} : meta.labels);
  if (!Result.isOk(labels)) return fail(labels.error);
  const ns = namespace(meta.namespace);
  if (typeof meta.name !== "string") return fail("metadata.name must be a string.");
  if (secret && r.type !== undefined && r.type !== "Opaque")
    return fail("Only Opaque Secrets are supported on gcloud-sim.");
  const data = new Map(strings(r.data, "data").map(([k, v]) => [k, secret ? decode(v) : v]));
  if (secret) for (const [k, v] of strings(r.stringData, "stringData")) data.set(k, v);
  const config = Configuration.validate({
    projectId: "",
    cluster: "",
    namespace: ns ?? "default",
    kind: secret ? "secret" : "configmap",
    name: meta.name,
    immutable: r.immutable === true,
    labels: labels.value,
    lastAppliedLabelKeys: [],
    data: Array.from(data, ([key, value]) => ({ key, value })).toSorted((a, b) =>
      a.key.localeCompare(b.key),
    ),
    lastAppliedKeys: [],
    createdAt: "",
  });
  if (!Result.isOk(config)) return fail(config.error);
  return {
    kind: config.value.kind,
    name: config.value.name,
    namespace: ns,
    data: config.value.data,
    labels: config.value.labels,
    immutable: typeof r.immutable === "boolean" ? r.immutable : undefined,
  };
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
      if (
        new Set(resources.map((r) => `${r.namespace ?? "<current>"}/${r.kind}/${r.name}`)).size !==
        resources.length
      )
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
  "kubernetes-immutable": {
    "frozen-settings.yaml": `apiVersion: v1
kind: ConfigMap
metadata:
  name: frozen-settings
  labels:
    app: frozen-web
immutable: true
data:
  MODE: staging
`,
    "frozen-credentials.yaml": `apiVersion: v1
kind: Secret
metadata:
  name: frozen-credentials
  labels:
    app: frozen-web
type: Opaque
immutable: true
stringData:
  TOKEN: demo-token-v1
`,
    "frozen-web.yaml": `apiVersion: apps/v1
kind: Deployment
metadata:
  name: frozen-web
spec:
  replicas: 2
  selector:
    matchLabels:
      app: frozen-web
  template:
    metadata:
      labels:
        app: frozen-web
    spec:
      containers:
        - name: frozen-web
          image: nginx:1
          env:
            - name: MODE
              valueFrom:
                configMapKeyRef:
                  name: frozen-settings
                  key: MODE
            - name: TOKEN
              valueFrom:
                secretKeyRef:
                  name: frozen-credentials
                  key: TOKEN
`,
  },
  "kubernetes-config-labels": {
    "labeled-configs.yaml": `apiVersion: v1
kind: ConfigMap
metadata:
  name: settings-dev
data:
  MODE: staging
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: settings-prod
  labels:
    environment: staging
    temporary: cleanup
data:
  MODE: production
---
apiVersion: v1
kind: Secret
metadata:
  name: credentials
type: Opaque
stringData:
  TOKEN: demo-token
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 1
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: nginx:1
          env:
            - name: MODE
              valueFrom:
                configMapKeyRef:
                  name: settings-prod
                  key: MODE
            - name: TOKEN
              valueFrom:
                secretKeyRef:
                  name: credentials
                  key: TOKEN
`,
  },
  "kubernetes-startup": {
    "slow-web.yaml": `apiVersion: apps/v1
kind: Deployment
metadata:
  name: slow-web
spec:
  replicas: 2
  selector:
    matchLabels:
      app: slow-web
  template:
    metadata:
      labels:
        app: slow-web
    spec:
      containers:
        - name: slow-web
          image: nginx:1
          readinessProbe:
            httpGet:
              path: /ready
              port: 8080
            successThreshold: 1
            failureThreshold: 1
          startupProbe:
            httpGet:
              path: /healthz
              port: 8080
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /healthz
              port: 8080
            failureThreshold: 1
`,
    "slow-service.yaml": `apiVersion: v1
kind: Service
metadata:
  name: slow-service
spec:
  selector:
    app: slow-web
  ports:
    - port: 80
      targetPort: 8080
`,
  },
  "kubernetes-liveness": {
    "live-web.yaml": `apiVersion: apps/v1
kind: Deployment
metadata:
  name: live-web
spec:
  replicas: 2
  selector:
    matchLabels:
      app: live-web
  template:
    metadata:
      labels:
        app: live-web
    spec:
      containers:
        - name: live-web
          image: nginx:1
          readinessProbe:
            httpGet:
              path: /ready
              port: 8080
            successThreshold: 1
            failureThreshold: 1
          livenessProbe:
            httpGet:
              path: /healthz
              port: 8080
            failureThreshold: 2
`,
    "live-service.yaml": `apiVersion: v1
kind: Service
metadata:
  name: live-service
spec:
  selector:
    app: live-web
  ports:
    - port: 80
      targetPort: 8080
`,
  },
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
  "kubernetes-namespace": {
    "namespaces.yaml": `apiVersion: v1
kind: Namespace
metadata:
  name: staging
---
apiVersion: v1
kind: Namespace
metadata:
  name: production
`,
    "staging.yaml": `apiVersion: v1
kind: ConfigMap
metadata:
  name: settings
  namespace: staging
data:
  MODE: staging
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: staging
spec:
  replicas: 1
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: nginx:1
          env:
            - name: MODE
              valueFrom:
                configMapKeyRef:
                  name: settings
                  key: MODE
---
apiVersion: v1
kind: Service
metadata:
  name: web-service
  namespace: staging
spec:
  selector:
    app: web
  ports:
    - port: 80
      targetPort: 80
`,
    "production.yaml": `apiVersion: v1
kind: ConfigMap
metadata:
  name: settings
  namespace: production
data:
  MODE: production
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: production
spec:
  replicas: 1
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: nginx:1
          env:
            - name: MODE
              valueFrom:
                configMapKeyRef:
                  name: settings
                  key: MODE
---
apiVersion: v1
kind: Service
metadata:
  name: web-service
  namespace: production
spec:
  selector:
    app: web
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
