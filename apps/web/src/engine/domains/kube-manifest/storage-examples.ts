export const KubeStorageExamples = {
  "kubernetes-storage": {
    "archive-class.yaml": `apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: archive
provisioner: pd.csi.storage.gke.io
parameters:
  type: pd-balanced
reclaimPolicy: Retain
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
`,
    "storage-claim.yaml": `apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: app-data
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: archive
  resources:
    requests:
      storage: 1Gi
`,
    "storage-web.yaml": `apiVersion: apps/v1
kind: Deployment
metadata:
  name: storage-web
spec:
  replicas: 1
  selector:
    matchLabels:
      app: storage-web
  template:
    metadata:
      labels:
        app: storage-web
    spec:
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: app-data
      containers:
        - name: storage-web
          image: nginx:1
          volumeMounts:
            - name: data
              mountPath: /data
`,
  },
} as const;
