import type { JsonRecord } from "@/types/Json";
import { Option } from "@/utils/Option";

/**
 * ローカルファイルの代わり（計画 #6）。中身が結果を決めるコマンド（`app deploy` / `kubectl apply -f` /
 * `deployment-manager deployments create --config` / `gsutil lifecycle set` /
 * `auth activate-service-account --key-file`）は、ここに置いた固定のサンプルだけを受け付ける。
 * 無い名前は本物と同じ `No such file or directory` になる。
 */
export type SampleFile =
  | Readonly<{ name: "cpu-dashboard.json"; kind: "monitoring-dashboard"; config: JsonRecord }>
  | Readonly<{ name: "app.yaml"; kind: "app-yaml"; runtime: string; service: string }>
  | Readonly<{
      name: "deployment.yaml";
      kind: "kube-deployment";
      deployment: string;
      image: string;
      replicas: number;
    }>
  | Readonly<{
      name: "service.yaml";
      kind: "kube-service";
      service: string;
      targetDeployment: string;
      type: "LoadBalancer";
      port: number;
      targetPort: number;
    }>
  | Readonly<{
      name: "config.yaml";
      kind: "dm-config";
      resources: readonly Readonly<{ name: string; type: string; zone: string }>[];
    }>
  | Readonly<{
      name: "lifecycle.json" | "lifecycle-nearline.json";
      kind: "lifecycle";
      rules: readonly Readonly<{
        action: Readonly<{ type: "Delete" } | { type: "SetStorageClass"; storageClass: string }>;
        condition: Readonly<{ age: number }>;
      }>[];
    }>
  | Readonly<{ name: "key.json"; kind: "sa-key"; clientEmail: string }>;

export type SampleFileName = SampleFile["name"];

/** `key.json` が指すサービスアカウント。初期 World の `web-sa` と同じ。 */
export const SampleKeyAccount = "web-sa@ace-dev-01.iam.gserviceaccount.com";

const Files: readonly SampleFile[] = [
  {
    name: "cpu-dashboard.json",
    kind: "monitoring-dashboard",
    config: {
      displayName: "VM CPU",
      gridLayout: {
        columns: 1,
        widgets: [
          {
            title: "CPU utilization",
            xyChart: {
              dataSets: [
                {
                  timeSeriesQuery: {
                    timeSeriesFilter: {
                      filter:
                        'metric.type="compute.googleapis.com/instance/cpu/utilization" AND resource.type="gce_instance"',
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    },
  },
  { name: "app.yaml", kind: "app-yaml", runtime: "python312", service: "default" },
  {
    name: "deployment.yaml",
    kind: "kube-deployment",
    deployment: "web",
    image: "nginx:1.27",
    replicas: 2,
  },
  {
    name: "service.yaml",
    kind: "kube-service",
    service: "web",
    targetDeployment: "web",
    type: "LoadBalancer",
    port: 80,
    targetPort: 80,
  },
  {
    name: "config.yaml",
    kind: "dm-config",
    resources: [{ name: "dm-vm", type: "compute.v1.instance", zone: "asia-northeast1-a" }],
  },
  {
    name: "lifecycle.json",
    kind: "lifecycle",
    rules: [{ action: { type: "Delete" }, condition: { age: 365 } }],
  },
  {
    name: "lifecycle-nearline.json",
    kind: "lifecycle",
    rules: [
      { action: { type: "SetStorageClass", storageClass: "NEARLINE" }, condition: { age: 30 } },
    ],
  },
  { name: "key.json", kind: "sa-key", clientEmail: SampleKeyAccount },
];

export const SampleFile = {
  /**
   * パスからサンプルを引く。`./deployment.yaml` / `~/deployment.yaml` のようにディレクトリが
   * 付いていても末尾の名前で引く。
   *
   * @param path ユーザーが打ったパス
   * @returns 名前が一致するサンプル。無ければ `none`
   */
  find(path: string): Option<SampleFile> {
    const name = path.split("/").at(-1) ?? path;
    return Option.fromNullable(Files.find((f) => f.name === name));
  },

  /** `--help` と docs に載せる一覧。 */
  names(): readonly SampleFileName[] {
    return Files.map((f) => f.name);
  },
} as const;
