export const StatefulExamples = {
  "kubernetes-statefulset": {
    "stateful-service.yaml": `apiVersion: v1
kind: Service
metadata:
  name: notes-peers
spec:
  clusterIP: None
  selector:
    app: notes
  ports:
    - port: 8080
      targetPort: 8080
`,
    "stateful-notes.yaml": `apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: notes
spec:
  serviceName: notes-peers
  podManagementPolicy: Parallel
  replicas: 2
  selector:
    matchLabels:
      app: notes
  template:
    metadata:
      labels:
        app: notes
    spec:
      containers:
        - name: notes
          image: nginx:1
          volumeMounts:
            - name: data
              mountPath: /data
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes:
          - ReadWriteOnce
        storageClassName: standard-rwo
        resources:
          requests:
            storage: 1Gi
`,
  },
} as const;
