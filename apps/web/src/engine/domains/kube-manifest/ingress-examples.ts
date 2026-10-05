const deployment = (name: string, probe = false) => ({
  apiVersion: "apps/v1",
  kind: "Deployment",
  metadata: { name },
  spec: {
    replicas: 2,
    selector: { matchLabels: { app: name } },
    template: {
      metadata: { labels: { app: name } },
      spec: {
        containers: [
          {
            name,
            image: "nginx:1",
            ...(probe
              ? {
                  readinessProbe: {
                    httpGet: { path: "/ready", port: 8080 },
                    successThreshold: 1,
                    failureThreshold: 1,
                  },
                }
              : {}),
          },
        ],
      },
    },
  },
});
const service = (name: string, selector = name) => ({
  apiVersion: "v1",
  kind: "Service",
  metadata: { name },
  spec: {
    type: "NodePort",
    selector: { app: selector },
    ports: [{ port: 80, targetPort: 8080 }],
  },
});
const path = (path: string, name: string, pathType = "Prefix", port = 80) => ({
  path,
  pathType,
  backend: { service: { name, port: { number: port } } },
});
const ingress = (name: string, paths: unknown[]) => ({
  apiVersion: "networking.k8s.io/v1",
  kind: "Ingress",
  metadata: {
    name,
    labels: { lesson: "ingress" },
    annotations: { "kubernetes.io/ingress.class": "gce" },
  },
  spec: { rules: [{ host: "app.example.test", http: { paths } }] },
});
const json = (v: unknown): string => JSON.stringify(v, null, 2);
export const KubeIngressExamples: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "kubernetes-ingress": {
    "ingress-workloads.yaml": [
      deployment("web"),
      deployment("api"),
      deployment("health"),
      service("web"),
      service("api"),
      service("health"),
    ]
      .map(json)
      .join("\n---\n"),
    "ingress-routes.json": json(
      ingress("app-entry", [
        path("/", "web"),
        path("/api", "wrong-api"),
        path("/api/health", "health", "Exact"),
      ]),
    ),
    "ingress-recovery.yaml": [deployment("recovery", true), service("recovery", "wrong-recovery")]
      .map(json)
      .join("\n---\n"),
    "ingress-broken.json": json(ingress("recovery-entry", [path("/", "recovery", "Prefix", 8080)])),
  },
};
