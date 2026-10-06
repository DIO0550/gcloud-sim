const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const deployment = (
  name: string,
  containers: readonly object[],
  replicas = 1,
  serviceAccountName = "default",
) => ({
  apiVersion: "apps/v1",
  kind: "Deployment",
  metadata: { name },
  spec: {
    replicas,
    selector: { matchLabels: { app: name } },
    template: { metadata: { labels: { app: name } }, spec: { serviceAccountName, containers } },
  },
});
const service = (name: string) => ({
  apiVersion: "v1",
  kind: "Service",
  metadata: { name },
  spec: { selector: { app: name }, ports: [{ port: 8080, targetPort: 8080 }] },
});
const probe = { httpGet: { path: "/ready", port: 8080 }, failureThreshold: 1, successThreshold: 1 };
const env = (value: string) => [{ name: "ROLE", value }];
const vpa = (mode: "Initial" | "Recreate") =>
  json({
    apiVersion: "autoscaling.k8s.io/v1",
    kind: "VerticalPodAutoscaler",
    metadata: { name: "rightsize" },
    spec: {
      targetRef: { apiVersion: "apps/v1", kind: "Deployment", name: "rightsize-app" },
      updatePolicy: { updateMode: mode },
      resourcePolicy: {
        containerPolicies: [{ containerName: "tuner", controlledValues: "RequestsOnly" }],
      },
    },
  });

export const GkeFinalExamples = {
  "kubernetes-gke-final": {
    "multi-app.json": json(
      deployment(
        "multi-app",
        [
          {
            name: "app",
            image: "nginx:1",
            env: env("frontend"),
            resources: { requests: { cpu: "250m", memory: "64Mi" } },
            readinessProbe: probe,
          },
          {
            name: "agent",
            image: "busybox:1",
            env: env("metrics"),
            resources: { requests: { cpu: "50m", memory: "32Mi" } },
            readinessProbe: probe,
            livenessProbe: probe,
          },
        ],
        2,
      ),
    ),
    "multi-service.json": json(service("multi-app")),
    "identity-account.json": json({
      apiVersion: "v1",
      kind: "ServiceAccount",
      metadata: { name: "bucket-reader" },
    }),
    "identity-app.json": json(
      deployment("identity-app", [{ name: "reader", image: "nginx:1" }], 1, "bucket-reader"),
    ),
    "rightsize-app.json": json(
      deployment(
        "rightsize-app",
        [
          {
            name: "tuner",
            image: "nginx:1",
            resources: { requests: { cpu: "1", memory: "512Mi" } },
          },
        ],
        2,
      ),
    ),
    "rightsize-vpa.json": json({
      apiVersion: "autoscaling.k8s.io/v1",
      kind: "VerticalPodAutoscaler",
      metadata: { name: "rightsize" },
      spec: {
        targetRef: { apiVersion: "apps/v1", kind: "Deployment", name: "rightsize-app" },
        updatePolicy: { updateMode: "Off" },
        resourcePolicy: { containerPolicies: [{ containerName: "tuner" }] },
      },
    }),
    "autopilot-default.json": json(deployment("default-app", [{ name: "app", image: "nginx:1" }])),
    "rightsize-initial.json": vpa("Initial"),
    "rightsize-recreate.json": vpa("Recreate"),
    "autopilot-small.json": json(
      deployment("small-app", [
        {
          name: "app",
          image: "nginx:1",
          resources: {
            requests: { cpu: "30m", memory: "32Mi" },
            limits: { cpu: "30m", memory: "32Mi" },
          },
        },
      ]),
    ),
    "regional-app.json": json(deployment("regional-app", [{ name: "app", image: "nginx:1" }], 3)),
    "regional-service.json": json(service("regional-app")),
  },
} as const;
