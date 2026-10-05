export const KubeVolumeExamples = {
  "kubernetes-volumes": {
    "volume-settings.yaml": `apiVersion: v1
kind: ConfigMap
metadata:
  name: volume-settings
data:
  app.conf: production
binaryData:
  asset.bin: AP+AAQ==
`,
    "volume-credentials.yaml": `apiVersion: v1
kind: Secret
metadata:
  name: volume-credentials
type: Opaque
stringData:
  TOKEN: demo-volume-token
`,
    "volume-web.yaml": `apiVersion: apps/v1
kind: Deployment
metadata:
  name: volume-web
spec:
  replicas: 2
  selector:
    matchLabels:
      app: volume-web
  template:
    metadata:
      labels:
        app: volume-web
    spec:
      volumes:
        - name: settings
          configMap:
            name: volume-settings
            items:
              - key: missing.conf
                path: app.conf
              - key: asset.bin
                path: assets/asset.bin
        - name: credentials
          secret:
            secretName: volume-credentials
      containers:
        - name: volume-web
          image: nginx:1
          volumeMounts:
            - name: settings
              mountPath: /etc/app
              readOnly: true
            - name: credentials
              mountPath: /etc/credentials
              readOnly: true
`,
  },
  "kubernetes-volume-refresh": {
    "reload-settings.yaml": `apiVersion: v1
kind: ConfigMap
metadata:
  name: reload-settings
data:
  MODE: staging
`,
    "reload-web.yaml": `apiVersion: apps/v1
kind: Deployment
metadata:
  name: reload-web
spec:
  replicas: 2
  selector:
    matchLabels:
      app: reload-web
  template:
    metadata:
      labels:
        app: reload-web
    spec:
      volumes:
        - name: settings
          configMap:
            name: reload-settings
      containers:
        - name: reload-web
          image: nginx:1
          env:
            - name: MODE
              valueFrom:
                configMapKeyRef:
                  name: reload-settings
                  key: MODE
          volumeMounts:
            - name: settings
              mountPath: /etc/config
              readOnly: true
            - name: settings
              mountPath: /etc/mode.conf
              subPath: MODE
              readOnly: true
`,
  },
} as const;
