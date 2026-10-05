const workload = (name: string, namespace?: string) => `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${name}
${namespace ? `  namespace: ${namespace}\n` : ""}spec:
  replicas: 1
  selector:
    matchLabels:
      app: ${name}
  template:
    metadata:
      labels:
        app: ${name}
    spec:
      containers:
        - name: ${name}
          image: nginx:1
`;
const policy = (name: string, spec: unknown, namespace?: string) =>
  JSON.stringify(
    {
      apiVersion: "networking.k8s.io/v1",
      kind: "NetworkPolicy",
      metadata: { name, ...(namespace ? { namespace } : {}) },
      spec,
    },
    null,
    2,
  );
const deny = (name: string, app: string, direction: "Ingress" | "Egress", namespace?: string) =>
  policy(name, { podSelector: { matchLabels: { app } }, policyTypes: [direction] }, namespace);
const allow = (
  name: string,
  app: string,
  direction: "Ingress" | "Egress",
  remote: string,
  namespace?: string,
  remoteNamespace?: string,
) =>
  policy(
    name,
    {
      podSelector: { matchLabels: { app } },
      policyTypes: [direction],
      [direction.toLowerCase()]: [
        {
          [direction === "Ingress" ? "from" : "to"]: [
            {
              podSelector: { matchLabels: { app: remote } },
              ...(remoteNamespace
                ? {
                    namespaceSelector: {
                      matchLabels: { "kubernetes.io/metadata.name": remoteNamespace },
                    },
                  }
                : {}),
            },
          ],
          ports: [{ protocol: "TCP", port: 8080 }],
        },
      ],
    },
    namespace,
  );

export const KubeNetworkExamples: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "kubernetes-network-policy": {
    "network-workloads.yaml": ["client", "backend", "intruder"]
      .map((n) => workload(n))
      .join("---\n"),
    "deny-ingress.json": deny("deny-backend", "backend", "Ingress"),
    "allow-ingress.json": allow("allow-client", "backend", "Ingress", "wrong-client"),
    "deny-egress.json": deny("deny-client", "client", "Egress"),
    "allow-egress.json": allow("allow-backend", "client", "Egress", "wrong-backend"),
    "network-namespaces.yaml": ["client-ns", "data-ns", "other-ns"]
      .map((n) => `apiVersion: v1\nkind: Namespace\nmetadata:\n  name: ${n}\n`)
      .join("---\n"),
    "cross-workloads.yaml": [
      workload("client", "client-ns"),
      workload("client", "other-ns"),
      workload("backend", "data-ns"),
      workload("intruder", "data-ns"),
    ].join("---\n"),
    "cross-deny.yaml": `${deny("deny-backend", "backend", "Ingress", "data-ns")}\n---\n${deny("deny-client", "client", "Egress", "client-ns")}\n`,
    "cross-ingress.json": allow(
      "allow-client",
      "backend",
      "Ingress",
      "wrong-client",
      "data-ns",
      "client-ns",
    ),
    "cross-egress.json": allow(
      "allow-backend",
      "client",
      "Egress",
      "wrong-backend",
      "client-ns",
      "data-ns",
    ),
  },
};
