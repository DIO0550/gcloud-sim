import { ADMIN_SCENARIOS } from "./admin-scenarios.mjs";
import { LB_SCENARIOS } from "./load-balancing-scenarios.mjs";
import { OBSERVABILITY_SCENARIOS } from "./observability-scenarios.mjs";
import { TERRAFORM_SCENARIOS } from "./terraform-scenarios.mjs";

/**
 * 撮影する画面の一覧。
 *
 * 見た目の差分（VRT）は、ここに並べた「画面 × 幅」の枚数だけ撮る。画面を足したいときは
 * SCENARIOS に 1 つ足すだけでよく、ワークフロー側は触らない。
 *
 * 撮影を安定させるために 2 つ仕込んである。
 * - 時刻を固定する（capture 側で Date を差し替える）。実時刻から作る表示が撮るたびに
 *   変わると、毎回差分として出てしまうため
 * - 撮る前に localStorage を空にし、storage に書いたものだけを置く。画面の操作で
 *   作ると時間がかかる状態は、ここに直接置く
 */

/**
 * 撮影する幅。height は「この高さの画面で開いたとき」を表す。
 * 撮るのはページ全体だが、maxHeight までで切る（縦に長い画面を全部撮ると、
 * 1 枚が大きくなりすぎてレビューでも保存でも扱いにくいため）。
 */
export const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 1600, maxHeight: 2000 },
  { name: "mobile", width: 430, height: 1200, maxHeight: 2600 },
];

/** 撮影時に固定する時刻。UTC でも JST でも同じ日付になる時刻を選んである。 */
export const FROZEN_TIME = Date.UTC(2026, 0, 1, 12, 0, 0);

/**
 * 画面ごとの手順。
 *
 * storage に { キー: 値 } を書くと、撮る前に localStorage へ JSON で置く。
 *
 * steps に書けるもの:
 * - { click: "ボタンの文字" }        文字またはaria-labelがちょうど一致するボタンを押す
 * - { type: "gcloud ..." }           端末に 1 行打って Enter する（Console の画面に出すリソースを作る）
 * - { fill: ["ラベル", "値"] }       そのラベルの入力欄に値を入れる
 * - { wait: 400 }                    ミリ秒待つ
 */
const configSteps = [
  { wait: 800 },
  { type: "gcloud services enable container.googleapis.com" },
  { type: "gcloud container clusters create-auto config-gke --region=us-central1" },
  { type: "kubectl create deployment config-web --image=nginx:1 --replicas=2" },
  { type: "kubectl create configmap app-config --from-literal=APP_MODE=production" },
  { type: "kubectl create secret generic app-secret --from-literal=API_TOKEN=demo-token" },
  { type: "kubectl set env deployment/config-web --from=configmap/app-config" },
  { type: "kubectl set env deployment/config-web --from=secret/app-secret" },
  { type: "kubectl set env deployment/config-web LOG_LEVEL=info" },
  { type: "kubectl rollout restart deployment/config-web" },
  { click: "config-gke を展開する" },
];
const networkSteps = (standard = false) => [
  { wait: 800 },
  { type: "gcloud services enable container.googleapis.com" },
  {
    type: `gcloud container clusters ${standard ? "create" : "create-auto"} policy-gke --region=us-central1`,
  },
  { type: "sim files load kubernetes-network-policy" },
  { type: "kubectl apply -f network-workloads.yaml" },
  { type: "kubectl apply -f deny-ingress.json" },
  { type: "kubectl apply -f deny-egress.json" },
];
const ingressSteps = (recovery = false) => [
  { wait: 800 },
  { type: "gcloud services enable container.googleapis.com" },
  {
    type: `gcloud container clusters create-auto ${recovery ? "ingress-fix-gke" : "ingress-gke"} --region=us-central1`,
  },
  { type: "sim files load kubernetes-ingress" },
  { type: `kubectl apply -f ${recovery ? "ingress-recovery.yaml" : "ingress-workloads.yaml"}` },
  { type: `kubectl apply -f ${recovery ? "ingress-broken.json" : "ingress-routes.json"}` },
];
const nodePoolSteps = [
  { wait: 800 },
  { type: "gcloud services enable container.googleapis.com" },
  { type: "gcloud container clusters create ops-gke --zone=us-central1-a --num-nodes=2" },
  {
    type: "gcloud container node-pools create apps --cluster=ops-gke --zone=us-central1-a --machine-type=e2-standard-4 --disk-size=200 --num-nodes=1",
  },
];
const privateSteps = [
  { wait: 800 },
  { type: "gcloud services enable container.googleapis.com" },
  {
    type: "gcloud container clusters create private-gke --region=us-central1 --enable-private-nodes --enable-ip-alias --master-ipv4-cidr=172.16.0.0/28",
  },
];
const securePrivate = {
  type: "gcloud container clusters update private-gke --region=us-central1 --enable-private-endpoint --enable-master-authorized-networks --master-authorized-networks=10.128.0.5/32 --enable-authorized-networks-on-private-endpoint",
};
const statefulSteps = [
  { wait: 800 },
  { type: "gcloud services enable container.googleapis.com" },
  { type: "gcloud container clusters create-auto stateful-gke --region=us-central1" },
  { type: "sim files load kubernetes-statefulset" },
  { type: "kubectl apply -f stateful-service.yaml" },
  { type: "kubectl apply -f stateful-notes.yaml" },
  { click: "stateful-gke を展開する" },
];
const statefulDataSteps = [
  { type: "sim kubernetes write-file pod/notes-0 --path=/data/note.txt --content=first-note" },
  { type: "sim kubernetes write-file pod/notes-1 --path=/data/note.txt --content=second-note" },
];
export const SCENARIOS = [
  ...TERRAFORM_SCENARIOS,
  ...OBSERVABILITY_SCENARIOS,
  {
    name: "container-release-evidence",
    label: "コンテナ: ローカル検証履歴と未完了の片付け",
    steps: [
      { wait: 800 },
      { type: "docker build -t release-local:v1 ./hello-web" },
      { type: "docker run -d --name release-local -p 8080:8080 release-local:v1" },
      { type: "sim container-release validate-local" },
      { click: "公開検証: ace-release" },
      { wait: 300 },
    ],
  },
  ...ADMIN_SCENARIOS,
  ...LB_SCENARIOS,
  {
    name: "gke-statefulset-initial",
    label: "GKE: StatefulSetの固定Pod名と個別PVC",
    steps: [
      ...statefulSteps,
      { type: "kubectl get pods" },
      { type: "kubectl get pvc" },
      { click: "sts: notes" },
      { wait: 300 },
    ],
  },
  {
    name: "gke-statefulset-pod-recovered",
    label: "GKE: 同じPod名とPVCで復旧",
    steps: [
      ...statefulSteps,
      ...statefulDataSteps,
      { type: "kubectl delete pod notes-0" },
      { type: "kubectl exec notes-0 -- cat /data/note.txt" },
      { type: "kubectl exec notes-1 -- cat /data/note.txt" },
      { click: "sts: notes" },
      { wait: 300 },
    ],
  },
  {
    name: "gke-statefulset-scale-down",
    label: "GKE: スケールダウン後もPVCを保持",
    steps: [
      ...statefulSteps,
      ...statefulDataSteps,
      { type: "kubectl scale sts/notes --replicas=1" },
      { type: "kubectl get pods" },
      { type: "kubectl get pvc" },
      { click: "sts: notes" },
      { wait: 300 },
    ],
  },
  {
    name: "gke-statefulset-scale-recovered",
    label: "GKE: スケール後に同じPVCとPVを再利用",
    steps: [
      ...statefulSteps,
      ...statefulDataSteps,
      { type: "kubectl scale sts/notes --replicas=1" },
      { type: "kubectl scale sts/notes --replicas=2" },
      { type: "kubectl exec notes-1 -- cat /data/note.txt" },
      { click: "sts: notes" },
      { wait: 300 },
    ],
  },
  {
    name: "gke-statefulset-active-pvc",
    label: "GKE: 連番PVCのStatefulSet利用元",
    steps: [...statefulSteps, ...statefulDataSteps, { click: "pvc: data-notes-0" }, { wait: 300 }],
  },
  {
    name: "gke-statefulset-retained-pvc",
    label: "GKE: Podを減らした後の保持PVC",
    steps: [
      ...statefulSteps,
      ...statefulDataSteps,
      { type: "kubectl scale sts/notes --replicas=1" },
      { click: "pvc: data-notes-1" },
      { wait: 300 },
    ],
  },
  {
    name: "gke-statefulset-headless",
    label: "GKE: headless Serviceの接続先",
    steps: [...statefulSteps, { click: "svc: notes-peers" }, { wait: 300 }],
  },
  ...[
    ["pod", "StatefulSetのPodを同じPVCで復旧する"],
    ["scale", "StatefulSetのスケール後にPVCを再利用する"],
  ].map(([name, title]) => ({
    name: `mission-gke-statefulset-${name}`,
    label: `ミッション: ${title}`,
    steps: [
      { wait: 800 },
      { click: "ミッション" },
      { click: "運用の維持0/53 クリア" },
      { click: `${title}未着手` },
      { click: "開始" },
      { click: "ヒント（0/5）" },
      { wait: 300 },
    ],
  })),

  ...[
    ["private", "private制御プレーンへの接続条件を確認する"],
    ["authorized", "公開endpointの許可CIDRを直して接続を確認する"],
  ].map(([name, title]) => ({
    name: `mission-gke-control-plane-${name}`,
    label: `ミッション: ${title}`,
    steps: [
      { wait: 800 },
      { click: "ミッション" },
      { click: "アクセスとセキュリティ0/11 クリア" },
      { click: `${title}未着手` },
      { click: "開始" },
      { click: "ヒント（0/5）" },
      { wait: 300 },
    ],
  })),
  ...[
    ["allowed", "private", "10.128.0.5", "内部endpointの限定CIDRを許可"],
    ["source-denied", "private", "10.128.0.6", "内部endpointの許可範囲外を拒否"],
    ["public-disabled", "public", "203.0.113.20", "公開endpointを無効にして拒否"],
  ].map(([name, endpoint, source, label]) => ({
    name: `gke-control-plane-${name}`,
    label: `GKE: ${label}`,
    steps: [
      ...privateSteps,
      securePrivate,
      {
        type: "gcloud container clusters get-credentials private-gke --region=us-central1 --internal-ip",
      },
      {
        type: `sim gke check-control-plane private-gke --region=us-central1 --endpoint=${endpoint} --source-ip=${source}${endpoint === "private" ? " --source-network=default" : ""}`,
      },
      { click: "private-gke" },
      { wait: 300 },
    ],
  })),
  {
    name: "gke-control-plane-private-nodes-public",
    label: "GKE: privateノードでも公開endpointは有効",
    steps: [
      ...privateSteps,
      {
        type: "sim gke check-control-plane private-gke --region=us-central1 --endpoint=public --source-ip=203.0.113.20",
      },
      { click: "private-gke" },
      { wait: 300 },
    ],
  },
  ...[
    ["denied", "203.0.113.0/28"],
    ["recovered", "203.0.113.16/28"],
  ].map(([name, cidr]) => ({
    name: `gke-control-plane-public-cidr-${name}`,
    label: `GKE: 公開endpoint許可CIDR ${cidr}`,
    steps: [
      ...privateSteps,
      {
        type: `gcloud container clusters update private-gke --region=us-central1 --enable-master-authorized-networks --master-authorized-networks=${cidr}`,
      },
      {
        type: "sim gke check-control-plane private-gke --region=us-central1 --endpoint=public --source-ip=203.0.113.20",
      },
      { click: "private-gke" },
      { wait: 300 },
    ],
  })),
  ...[
    ["upgrade", "制御プレーンとノードプールを別々に更新する"],
    ["autoscaling", "ノード自動スケールの上限と管理設定を確認する"],
  ].map(([name, title]) => ({
    name: `mission-gke-nodepool-${name}`,
    label: `ミッション: ${title}`,
    steps: [
      { wait: 800 },
      { click: "ミッション" },
      { click: "運用の維持0/53 クリア" },
      { click: `${title}未着手` },
      { click: "開始" },
      { click: "ヒント（0/5）" },
      { wait: 300 },
    ],
  })),
  ...["apps", "default-pool"].map((name) => ({
    name: `gke-nodepool-upgrade-${name}`,
    label: `GKE: 制御プレーンと${name}の独立した版`,
    steps: [
      ...nodePoolSteps,
      { type: "gcloud container clusters upgrade ops-gke --zone=us-central1-a --master --quiet" },
      {
        type: "gcloud container clusters upgrade ops-gke --zone=us-central1-a --node-pool=apps --quiet",
      },
      { type: "gcloud container node-pools list --cluster=ops-gke --zone=us-central1-a" },
      { click: "ops-gke を展開する" },
      { click: `pool: ${name}` },
      { wait: 300 },
    ],
  })),
  {
    name: "gke-nodepool-autoscaling",
    label: "GKE: 必要ノード数10を上限4へ制限",
    steps: [
      ...nodePoolSteps,
      {
        type: "gcloud container node-pools update apps --cluster=ops-gke --zone=us-central1-a --enable-autoscaling --min-nodes=1 --max-nodes=4",
      },
      {
        type: "sim gke autoscale-nodes apps --cluster=ops-gke --zone=us-central1-a --required-nodes=10",
      },
      { click: "ops-gke を展開する" },
      { click: "pool: apps" },
      { wait: 300 },
    ],
  },
  {
    name: "gke-nodepool-deleted-default",
    label: "GKE: 既定プールの削除を一覧とツリーへ反映",
    steps: [
      ...nodePoolSteps,
      {
        type: "gcloud container node-pools delete default-pool --cluster=ops-gke --zone=us-central1-a --quiet",
      },
      { type: "gcloud container node-pools list --cluster=ops-gke --zone=us-central1-a" },
      { click: "ops-gke を展開する" },
      { click: "pool: apps" },
      { wait: 300 },
    ],
  },

  ...[
    ["routes", "Ingressでホストとパスを振り分ける", "デプロイと実装0/16 クリア"],
    ["recovery", "IngressからReadyなService接続先を復旧する", "運用の維持0/53 クリア"],
  ].map(([name, title, category]) => ({
    name: `mission-gke-ingress-${name}`,
    label: `ミッション: ${title}`,
    steps: [
      { wait: 800 },
      { click: "ミッション" },
      { click: category },
      { click: `${title}未着手` },
      { click: "開始" },
      { click: "ヒント（0/5）" },
      { wait: 300 },
    ],
  })),
  {
    name: "gke-ingress-routes",
    label: "GKE: Ingressのホスト・Prefix・Exactルート",
    steps: [
      ...ingressSteps(),
      { type: "sim files replace ingress-routes.json --search=wrong-api --replacement=api" },
      { type: "kubectl apply -f ingress-routes.json" },
      { type: "sim kubernetes request app-entry --host=app.example.test --path=/api/health" },
      { click: "ingress-gke を展開する" },
      { click: "ing: app-entry" },
      { wait: 300 },
    ],
  },
  {
    name: "gke-ingress-missing",
    label: "GKE: IngressのService参照切れ",
    steps: [
      ...ingressSteps(),
      { type: "sim kubernetes request app-entry --host=app.example.test --path=/api/users" },
      { click: "ingress-gke を展開する" },
      { click: "ing: app-entry" },
      { wait: 300 },
    ],
  },
  {
    name: "gke-ingress-port",
    label: "GKE: IngressのService port誤設定",
    steps: [
      ...ingressSteps(true),
      { type: "sim kubernetes request recovery-entry --host=app.example.test --path=/" },
      { click: "ingress-fix-gke を展開する" },
      { click: "ing: recovery-entry" },
      { wait: 300 },
    ],
  },
  {
    name: "gke-ingress-readiness",
    label: "GKE: Ingressからのreadiness待ち",
    steps: [
      ...ingressSteps(true),
      { type: "sim files replace ingress-broken.json --search=8080 --replacement=80" },
      { type: "kubectl apply -f ingress-broken.json" },
      {
        type: "sim files replace ingress-recovery.yaml --search=wrong-recovery --replacement=recovery",
      },
      { type: "kubectl apply -f ingress-recovery.yaml" },
      { type: "sim kubernetes request recovery-entry --host=app.example.test --path=/" },
      { click: "ingress-fix-gke を展開する" },
      { click: "ing: recovery-entry" },
      { wait: 300 },
    ],
  },
  {
    name: "gke-ingress-namespace",
    label: "GKE: namespace内で解決するIngress",
    steps: [
      ...ingressSteps(),
      { type: "kubectl create namespace staging" },
      { type: "sim files replace ingress-routes.json --search=wrong-api --replacement=api" },
      { type: "kubectl apply -f ingress-workloads.yaml -n staging" },
      { type: "kubectl apply -f ingress-routes.json -n staging" },
      { type: "kubectl delete ing app-entry" },
      { type: "sim kubernetes request app-entry -n staging --host=app.example.test --path=/api" },
      { click: "ingress-gke を展開する" },
      { click: "namespace: staging を展開する" },
      { click: "ing: app-entry" },
      { wait: 300 },
    ],
  },

  ...[
    ["network-policy", "NetworkPolicyで必要なPod通信だけを許可する"],
    ["namespace-network-policy", "namespaceとPodラベルで通信先を絞る"],
  ].map(([name, title]) => ({
    name: `mission-gke-${name}`,
    label: `ミッション: ${title}`,
    steps: [
      { wait: 800 },
      { click: "ミッション" },
      { click: "アクセスとセキュリティ0/11 クリア" },
      { click: `${title}未着手` },
      { click: "開始" },
      { click: "ヒント（0/5）" },
      { wait: 300 },
    ],
  })),
  {
    name: "gke-network-policy-denied",
    label: "GKE: 既定遮断と選択されたPod",
    steps: [
      ...networkSteps(),
      { type: "sim kubernetes connect client --to=backend --port=8080" },
      { click: "policy-gke を展開する" },
      { click: "netpol: deny-backend" },
      { wait: 300 },
    ],
  },
  {
    name: "gke-network-policy-allowed",
    label: "GKE: 両方向の許可とTCPポート",
    steps: [
      ...networkSteps(),
      { type: "sim files replace allow-ingress.json --search=wrong-client --replacement=client" },
      { type: "kubectl apply -f allow-ingress.json" },
      { type: "sim files replace allow-egress.json --search=wrong-backend --replacement=backend" },
      { type: "kubectl apply -f allow-egress.json" },
      { type: "sim kubernetes connect client --to=backend --port=8080" },
      { click: "policy-gke を展開する" },
      { click: "netpol: allow-client" },
      { wait: 300 },
    ],
  },
  {
    name: "gke-network-policy-namespace",
    label: "GKE: namespaceとPod条件のAND",
    steps: [
      { wait: 800 },
      { type: "gcloud services enable container.googleapis.com" },
      { type: "gcloud container clusters create-auto policy-ns-gke --region=us-central1" },
      { type: "sim files load kubernetes-network-policy" },
      { type: "kubectl apply -f network-namespaces.yaml" },
      { type: "kubectl apply -f cross-workloads.yaml" },
      { type: "kubectl apply -f cross-deny.yaml" },
      { type: "sim files replace cross-ingress.json --search=wrong-client --replacement=client" },
      { type: "kubectl apply -f cross-ingress.json" },
      { type: "kubectl describe netpol allow-client -n data-ns" },
      { click: "policy-ns-gke を展開する" },
      { click: "namespace: data-ns を展開する" },
      { click: "netpol: allow-client" },
      { wait: 300 },
    ],
  },
  {
    name: "gke-network-policy-disabled",
    label: "GKE: Standardの強制無効",
    steps: [
      ...networkSteps(true),
      { type: "sim kubernetes connect client --to=backend --port=8080" },
      { click: "policy-gke を展開する" },
      { click: "netpol: deny-backend" },
      { wait: 300 },
    ],
  },
  {
    name: "gke-network-policy-cluster",
    label: "GKE: StandardのNetworkPolicy強制状態",
    steps: [
      { wait: 800 },
      { type: "gcloud services enable container.googleapis.com" },
      {
        type: "gcloud container clusters create policy-standard --region=us-central1 --enable-network-policy",
      },
      { click: "policy-standard" },
      { wait: 300 },
    ],
  },
  ...[
    ["storage", "PVCを割り当てて再起動後もデータを保つ", 6],
    ["retain", "PVC削除後にRetainでデータを残す", 5],
  ].map(([name, title, hints]) => ({
    name: `mission-gke-${name}`,
    label: `ミッション: ${title}`,
    steps: [
      { wait: 800 },
      { click: "ミッション" },
      { click: "運用の維持0/53 クリア" },
      { click: `${title}未着手` },
      { click: "開始" },
      { click: `ヒント（0/${hints}）` },
      { wait: 300 },
    ],
  })),
  {
    name: "gke-pvc-pending",
    label: "GKE: PVCの待機と欠落StorageClass",
    steps: [
      { wait: 800 },
      { type: "gcloud services enable container.googleapis.com" },
      { type: "gcloud container clusters create-auto storage-gke --region=us-central1" },
      { type: "sim files load kubernetes-storage" },
      { type: "kubectl apply -f storage-claim.yaml" },
      { type: "kubectl apply -f storage-web.yaml" },
      { type: "kubectl get pods" },
      { type: "kubectl describe pvc app-data" },
      { click: "storage-gke を展開する" },
      { click: "pvc: app-data" },
      { wait: 300 },
    ],
  },
  {
    name: "gke-pvc-bound",
    label: "GKE: PVCの容量拡張とデータ保持",
    steps: [
      { wait: 800 },
      { type: "gcloud services enable container.googleapis.com" },
      { type: "gcloud container clusters create-auto storage-gke --region=us-central1" },
      { type: "sim files load kubernetes-storage" },
      { type: "kubectl apply -f archive-class.yaml" },
      { type: "kubectl apply -f storage-claim.yaml" },
      { type: "kubectl apply -f storage-web.yaml" },
      { type: "sim files replace storage-claim.yaml --search=1Gi --replacement=2Gi" },
      { type: "kubectl apply -f storage-claim.yaml" },
      {
        type: "sim kubernetes write-file storage-web --path=/data/message.txt --content=survives-restart",
      },
      { type: "kubectl rollout restart deployment/storage-web" },
      { type: "kubectl exec deployment/storage-web -- cat /data/message.txt" },
      { click: "storage-gke を展開する" },
      { click: "pvc: app-data" },
      { wait: 300 },
    ],
  },
  {
    name: "gke-storageclass-properties",
    label: "GKE: StorageClassの保持方針と遅延割り当て",
    steps: [
      { wait: 800 },
      { type: "gcloud services enable container.googleapis.com" },
      { type: "gcloud container clusters create-auto storage-gke --region=us-central1" },
      { type: "sim files load kubernetes-storage" },
      { type: "kubectl apply -f archive-class.yaml" },
      { click: "storage-gke を展開する" },
      { click: "sc: archive" },
      { wait: 300 },
    ],
  },
  {
    name: "gke-pv-retained",
    label: "GKE: PVC削除後のReleased PVとデータ保持",
    steps: [
      { wait: 800 },
      { type: "gcloud services enable container.googleapis.com" },
      { type: "gcloud container clusters create-auto retain-gke --region=us-central1" },
      { type: "sim files load kubernetes-storage" },
      { type: "kubectl apply -f archive-class.yaml" },
      { type: "kubectl apply -f storage-claim.yaml" },
      { type: "kubectl apply -f storage-web.yaml" },
      { type: "sim kubernetes write-file storage-web --path=/data/message.txt --content=keep-me" },
      { type: "kubectl delete pvc app-data" },
      { type: "kubectl get pvc" },
      { type: "kubectl scale deployment/storage-web --replicas=0" },
      { type: "kubectl get pv" },
      { click: "retain-gke を展開する" },
      { click: "pv: pvc-sim-10" },
      { wait: 300 },
    ],
  },

  ...[
    ["volumes", "設定ファイルのマウント障害を直す"],
    ["volume-refresh", "マウントと環境変数の更新差を確認する"],
  ].map(([name, title]) => ({
    name: `mission-gke-${name}`,
    label: `ミッション: ${title}`,
    steps: [
      { wait: 800 },
      { click: "ミッション" },
      { click: "運用の維持0/53 クリア" },
      { click: `${title}未着手` },
      { click: "開始" },
      { click: "ヒント（0/5）" },
      { wait: 300 },
    ],
  })),
  {
    name: "gke-volumes-properties",
    label: "GKE: ConfigMap・Secretのファイルマウント",
    steps: [
      { wait: 800 },
      { type: "gcloud services enable container.googleapis.com" },
      { type: "gcloud container clusters create-auto volume-gke --region=us-central1" },
      { type: "sim files load kubernetes-volumes" },
      { type: "kubectl apply -f volume-settings.yaml" },
      { type: "kubectl apply -f volume-credentials.yaml" },
      { type: "kubectl apply -f volume-web.yaml" },
      {
        type: "sim files replace volume-web.yaml --search='key: missing.conf' --replacement='key: app.conf'",
      },
      { type: "kubectl apply -f volume-web.yaml" },
      { type: "kubectl exec deployment/volume-web -- cat /etc/app/app.conf" },
      { click: "volume-gke を展開する" },
      { click: "deploy: volume-web" },
      { wait: 300 },
    ],
  },
  {
    name: "gke-volume-refresh-properties",
    label: "GKE: subPathと通常マウントの更新差",
    steps: [
      { wait: 800 },
      { type: "gcloud services enable container.googleapis.com" },
      { type: "gcloud container clusters create-auto reload-gke --region=us-central1" },
      { type: "sim files load kubernetes-volume-refresh" },
      { type: "kubectl apply -f reload-settings.yaml" },
      { type: "kubectl apply -f reload-web.yaml" },
      {
        type: "sim files replace reload-settings.yaml --search='MODE: staging' --replacement='MODE: production'",
      },
      { type: "kubectl apply -f reload-settings.yaml" },
      { type: "kubectl exec deployment/reload-web -- cat /etc/config/MODE" },
      { type: "kubectl exec deployment/reload-web -- cat /etc/mode.conf" },
      { click: "reload-gke を展開する" },
      { click: "deploy: reload-web" },
      { wait: 300 },
    ],
  },

  {
    name: "mission-gke-binary-data",
    label: "ミッション: バイナリ設定と環境変数の分離",
    steps: [
      { wait: 800 },
      { click: "ミッション" },
      { click: "運用の維持0/53 クリア" },
      { click: "バイナリ設定と環境変数の参照を分ける未着手" },
      { click: "開始" },
      { click: "ヒント（0/5）" },
      { wait: 300 },
    ],
  },
  {
    name: "gke-binary-data-properties",
    label: "GKE: テキストとバイナリの保存・表示と環境変数の起動エラー",
    steps: [
      { wait: 800 },
      { type: "gcloud services enable container.googleapis.com" },
      { type: "gcloud container clusters create-auto binary-gke --region=us-central1" },
      { type: "sim files load kubernetes-binary-data" },
      { type: "kubectl apply -f asset-settings.yaml" },
      { type: "kubectl apply -f asset-web.yaml" },
      { type: "kubectl get pods" },
      { type: "kubectl get cm asset-settings -o yaml" },
      { type: "kubectl describe cm asset-settings" },
      { click: "binary-gke を展開する" },
      { click: "configmap: asset-settings" },
      { wait: 300 },
    ],
  },
  {
    name: "mission-gke-immutable",
    label: "ミッション: 変更不可の設定を再作成して反映",
    steps: [
      { wait: 800 },
      { click: "ミッション" },
      { click: "運用の維持0/53 クリア" },
      { click: "変更できない設定を作り直してPodへ反映する未着手" },
      { click: "開始" },
      { click: "ヒント（0/6）" },
      { wait: 300 },
    ],
  },
  {
    name: "gke-immutable-properties",
    label: "GKE: 変更不可の設定とデータ更新の拒否",
    steps: [
      { wait: 800 },
      { type: "gcloud services enable container.googleapis.com" },
      { type: "gcloud container clusters create-auto immutable-gke --region=us-central1" },
      { type: "sim files load kubernetes-immutable" },
      { type: "kubectl apply -f frozen-settings.yaml" },
      { type: "kubectl apply -f frozen-credentials.yaml" },
      { type: "kubectl apply -f frozen-web.yaml" },
      { type: "sim files replace frozen-settings.yaml --search=staging --replacement=production" },
      { type: "kubectl apply -f frozen-settings.yaml" },
      { type: "kubectl label cm frozen-settings team=platform" },
      { type: "kubectl get cm frozen-settings -o yaml" },
      { click: "immutable-gke を展開する" },
      { click: "configmap: frozen-settings" },
      { wait: 300 },
    ],
  },
  {
    name: "mission-gke-config-labels",
    label: "ミッション: ConfigMap・Secretのラベル分類",
    steps: [
      { wait: 800 },
      { click: "ミッション" },
      { click: "運用の維持0/53 クリア" },
      { click: "ラベルでConfigMap・Secretを分類する未着手" },
      { click: "開始" },
      { click: "ヒント（0/5）" },
      { wait: 300 },
    ],
  },
  {
    name: "gke-config-label-properties",
    label: "GKE: 設定ラベルと本番用の絞り込み",
    steps: [
      { wait: 800 },
      { type: "gcloud services enable container.googleapis.com" },
      { type: "gcloud container clusters create-auto labels-gke --region=us-central1" },
      { type: "sim files load kubernetes-config-labels" },
      { type: "kubectl apply -f labeled-configs.yaml" },
      { type: "kubectl label cm settings-dev app=web environment=staging" },
      { type: "kubectl label cm settings-prod app=web environment=production --overwrite" },
      { type: "kubectl label cm settings-prod temporary-" },
      { type: "kubectl label secret credentials app=web environment=production" },
      { type: "kubectl get cm -l app=web,environment=production" },
      { type: "kubectl get secrets -l environment=production" },
      { click: "labels-gke を展開する" },
      { click: "configmap: settings-prod" },
      { wait: 300 },
    ],
  },
  {
    name: "mission-gke-context",
    label: "ミッション: コンテキストの既定namespace切り替え",
    steps: [
      { wait: 800 },
      { click: "ミッション" },
      { click: "運用の維持0/53 クリア" },
      { click: "コンテキストの既定namespaceを切り替える未着手" },
      { click: "開始" },
      { click: "ヒント（0/6）" },
      { wait: 300 },
    ],
  },
  {
    name: "gke-context-namespace",
    label: "GKE: 既定namespace・同名Deployment・コンテキスト一覧",
    steps: [
      { wait: 800 },
      { type: "gcloud services enable container.googleapis.com" },
      { type: "gcloud container clusters create context-gke --zone=us-central1-a" },
      { type: "kubectl create namespace staging" },
      { type: "kubectl create namespace production" },
      { type: "kubectl create deployment web --image=nginx:1 -n staging" },
      { type: "kubectl create deployment web --image=nginx:1 -n production" },
      { type: "kubectl config set-context --current --namespace=staging" },
      { type: "kubectl set image deployment/web web=nginx:2" },
      { type: "kubectl scale deployment/web --replicas=2" },
      { type: "kubectl get deployments -A" },
      { type: "kubectl config get-contexts" },
      { click: "context-gke を展開する" },
      { click: "namespace: staging を展開する" },
      { click: "deploy: web" },
      { wait: 300 },
    ],
  },
  {
    name: "mission-gke-namespace",
    label: "ミッション: namespaceで検証と本番を分離",
    steps: [
      { wait: 800 },
      { click: "ミッション" },
      { click: "運用の維持0/53 クリア" },
      { click: "namespaceで検証環境と本番環境を分ける未着手" },
      { click: "開始" },
      { click: "ヒント（0/6）" },
      { wait: 300 },
    ],
  },
  {
    name: "gke-namespace-properties",
    label: "GKE: 同名Deploymentをnamespace別に表示",
    steps: [
      { wait: 800 },
      { type: "gcloud services enable container.googleapis.com" },
      { type: "gcloud container clusters create namespace-gke --zone=us-central1-a" },
      { type: "sim files load kubernetes-namespace" },
      { type: "kubectl apply -f namespaces.yaml" },
      { type: "kubectl apply -f staging.yaml" },
      { type: "kubectl apply -f production.yaml" },
      { type: "kubectl set image deployment/web web=nginx:2 -n staging" },
      { type: "kubectl scale deployment/web --replicas=3 -n staging" },
      { type: "kubectl get deployments -A" },
      { click: "namespace-gke を展開する" },
      { click: "namespace: staging を展開する" },
      { click: "deploy: web" },
      { wait: 300 },
    ],
  },
  {
    name: "mission-gke-startup",
    label: "ミッション: startupでコンテナ再起動",
    steps: [
      { wait: 800 },
      { click: "ミッション" },
      { click: "運用の維持0/53 クリア" },
      { click: "起動確認が済んだPodだけをServiceへ接続する未着手" },
      { click: "開始" },
      { click: "ヒント（0/6）" },
      { wait: 300 },
    ],
  },
  {
    name: "gke-startup-properties",
    label: "GKE: 起動確認が成功するまでprobeを待機するPod",
    steps: [
      { wait: 800 },
      { type: "gcloud services enable container.googleapis.com" },
      { type: "gcloud container clusters create startup-gke --zone=us-central1-a" },
      { type: "sim files load kubernetes-startup" },
      { type: "kubectl apply -f slow-web.yaml" },
      { type: "kubectl apply -f slow-service.yaml" },
      { type: "sim kubernetes probe slow-web --kind=startup --status-code=503" },
      { type: "sim kubernetes probe slow-web --kind=startup --status-code=503" },
      { type: "kubectl get pods" },
      { click: "startup-gke を展開する" },
      { click: "deploy: slow-web" },
      { wait: 300 },
    ],
  },
  {
    name: "mission-gke-liveness",
    label: "ミッション: livenessでコンテナ再起動",
    steps: [
      { wait: 800 },
      { click: "ミッション" },
      { click: "運用の維持0/53 クリア" },
      { click: "liveness失敗でコンテナを再起動して復旧する未着手" },
      { click: "開始" },
      { click: "ヒント（0/6）" },
      { wait: 300 },
    ],
  },
  {
    name: "gke-liveness-properties",
    label: "GKE: コンテナ再起動後にreadinessを再評価するPod",
    steps: [
      { wait: 800 },
      { type: "gcloud services enable container.googleapis.com" },
      { type: "gcloud container clusters create liveness-gke --zone=us-central1-a" },
      { type: "sim files load kubernetes-liveness" },
      { type: "kubectl apply -f live-web.yaml" },
      { type: "kubectl apply -f live-service.yaml" },
      { type: "sim kubernetes probe live-web --status-code=200" },
      { type: "sim kubernetes probe live-web --kind=liveness --status-code=503" },
      { type: "sim kubernetes probe live-web --kind=liveness --status-code=503" },
      { type: "kubectl get pods" },
      { click: "liveness-gke を展開する" },
      { click: "deploy: live-web" },
      { wait: 300 },
    ],
  },
  {
    name: "mission-gke-readiness",
    label: "ミッション: 未準備PodをServiceから外す",
    steps: [
      { wait: 800 },
      { click: "ミッション" },
      { click: "運用の維持0/53 クリア" },
      { click: "未準備のPodをServiceの接続先から外す未着手" },
      { click: "開始" },
      { click: "ヒント（0/6）" },
      { wait: 300 },
    ],
  },
  {
    name: "gke-readiness-properties",
    label: "GKE: Runningのままreadinessが失敗したPod",
    steps: [
      { wait: 800 },
      { type: "gcloud services enable container.googleapis.com" },
      { type: "gcloud container clusters create readiness-gke --zone=us-central1-a" },
      { type: "sim files load kubernetes-readiness" },
      { type: "kubectl apply -f ready-web.yaml" },
      { type: "kubectl apply -f ready-service.yaml" },
      { type: "sim kubernetes probe ready-web --status-code=200" },
      { type: "sim kubernetes probe ready-web --status-code=200" },
      { type: "sim kubernetes probe ready-web --status-code=503" },
      { type: "sim kubernetes probe ready-web --status-code=503" },
      { type: "kubectl get pods" },
      { click: "readiness-gke を展開する" },
      { click: "deploy: ready-web" },
      { wait: 300 },
    ],
  },
  {
    name: "mission-gke-qos",
    label: "ミッション: PodのQoSを比較する",
    steps: [
      { wait: 800 },
      { click: "ミッション" },
      { click: "運用の維持0/53 クリア" },
      { click: "requestsとlimitsからPodのQoSを比較する未着手" },
      { click: "開始" },
      { click: "ヒント（0/5）" },
      { wait: 300 },
    ],
  },
  {
    name: "gke-qos-properties",
    label: "GKE: Guaranteed PodのQoSとresources",
    steps: [
      { wait: 800 },
      { type: "gcloud services enable container.googleapis.com" },
      { type: "gcloud container clusters create qos-gke --zone=us-central1-a" },
      { type: "kubectl create deployment qos-guaranteed --image=nginx:1" },
      { type: "kubectl set resources deployment/qos-guaranteed --limits=cpu=500m,memory=256Mi" },
      { type: "kubectl get pods -o yaml" },
      { click: "qos-gke を展開する" },
      { click: "deploy: qos-guaranteed" },
      { wait: 300 },
    ],
  },
  {
    name: "mission-gke-hpa-manifest",
    label: "ミッション: HPA設定ファイルの変更と再評価",
    steps: [
      { wait: 800 },
      { click: "ミッション" },
      { click: "運用の維持0/53 クリア" },
      { click: "HPAの設定ファイルを変更して再評価する未着手" },
      { click: "開始" },
      { click: "ヒント（0/6）" },
      { wait: 300 },
    ],
  },
  {
    name: "gke-hpa-manifest-properties",
    label: "GKE: HPAファイル変更後の未評価状態",
    steps: [
      { wait: 800 },
      { type: "gcloud services enable container.googleapis.com" },
      { type: "gcloud container clusters create-auto hpa-manifest-gke --region=us-central1" },
      { type: "sim files load kubernetes-hpa" },
      { type: "kubectl apply -f autoscale-web.yaml" },
      { type: "kubectl apply -f autoscale-hpa.yaml" },
      { type: "sim kubernetes reconcile autoscale-web --cpu=1" },
      {
        type: "sim files replace autoscale-hpa.yaml --search='maxReplicas: 3' --replacement='maxReplicas: 6'",
      },
      {
        type: "sim files replace autoscale-hpa.yaml --search='averageUtilization: 80' --replacement='averageUtilization: 50'",
      },
      { type: "kubectl apply -f autoscale-hpa.yaml" },
      { click: "hpa-manifest-gke を展開する" },
      { click: "hpa: autoscale-web" },
      { wait: 300 },
    ],
  },
  {
    name: "mission-gke-hpa",
    label: "ミッション: CPU使用率によるPodの増加",
    steps: [
      { wait: 800 },
      { click: "ミッション" },
      { click: "運用の維持0/53 クリア" },
      { click: "CPU使用率に合わせてPodを増やす未着手" },
      { click: "開始" },
      { click: "ヒント（0/5）" },
      { wait: 300 },
    ],
  },
  {
    name: "gke-hpa-properties",
    label: "GKE: HPAの設定と教材評価",
    steps: [
      { wait: 800 },
      { type: "gcloud services enable container.googleapis.com" },
      { type: "gcloud container clusters create-auto hpa-gke --region=us-central1" },
      { type: "kubectl create deployment hpa-web --image=nginx:1 --replicas=2" },
      { type: "kubectl set resources deployment/hpa-web --requests=cpu=250m" },
      { type: "kubectl autoscale deployment/hpa-web --min=1 --max=5 --cpu-percent=50" },
      { type: "sim kubernetes reconcile hpa-web --cpu=250m" },
      { click: "hpa-gke を展開する" },
      { click: "hpa: hpa-web" },
      { wait: 300 },
    ],
  },
  {
    name: "mission-gke-resources",
    label: "ミッション: CPU・メモリの必要量と上限",
    steps: [
      { wait: 800 },
      { click: "ミッション" },
      { click: "運用の維持0/53 クリア" },
      { click: "CPU・メモリの必要量と上限を設定する未着手" },
      { click: "開始" },
      { click: "ヒント（0/5）" },
      { wait: 300 },
    ],
  },
  {
    name: "gke-resource-properties",
    label: "GKE: CPU・メモリの設定と履歴",
    steps: [
      { wait: 800 },
      { type: "gcloud services enable container.googleapis.com" },
      { type: "gcloud container clusters create-auto resources-gke --region=us-central1" },
      { type: "kubectl create deployment resource-web --image=nginx:1 --replicas=2" },
      {
        type: "kubectl set resources deployment/resource-web --requests=cpu=250m,memory=128Mi --limits=cpu=500m,memory=256Mi",
      },
      { type: "kubectl get deployment resource-web -o yaml" },
      { click: "resources-gke を展開する" },
      { click: "deploy: resource-web" },
      { wait: 300 },
    ],
  },
  {
    name: "mission-gke-labels",
    label: "ミッション: 複数ラベルで公開先を切り替え",
    steps: [
      { wait: 800 },
      { click: "ミッション" },
      { click: "運用の維持0/53 クリア" },
      { click: "ラベルでServiceの公開先を切り替える未着手" },
      { click: "開始" },
      { click: "ヒント（0/5）" },
      { wait: 300 },
    ],
  },
  {
    name: "gke-label-routing",
    label: "GKE: greenへの公開先切り替え",
    steps: [
      { wait: 800 },
      { type: "gcloud services enable container.googleapis.com" },
      { type: "gcloud container clusters create-auto labels-gke --region=us-central1" },
      { type: "sim files load kubernetes-labels" },
      { type: "kubectl apply -f shop-blue.yaml" },
      { type: "kubectl apply -f shop-green.yaml" },
      { type: "kubectl apply -f shop-service.yaml" },
      { type: "sim files replace shop-service.yaml --search=blue --replacement=green" },
      { type: "kubectl apply -f shop-service.yaml" },
      { type: "kubectl get pods -l app=shop,track=green" },
      { click: "labels-gke を展開する" },
      { click: "svc: shop" },
      { wait: 300 },
    ],
  },
  {
    name: "mission-gke-workload",
    label: "ミッション: マニフェスト更新とService接続先",
    steps: [
      { wait: 800 },
      { click: "ミッション" },
      { click: "運用の維持0/53 クリア" },
      { click: "マニフェストでアプリを更新しServiceの接続先を直す未着手" },
      { click: "開始" },
      { click: "ヒント（0/5）" },
      { wait: 300 },
    ],
  },
  {
    name: "gke-service-routing",
    label: "GKE: Serviceのselectorと接続先",
    steps: [
      { wait: 800 },
      { type: "gcloud services enable container.googleapis.com" },
      { type: "gcloud container clusters create-auto manifest-gke --region=us-central1" },
      { type: "sim files load kubernetes-workload" },
      { type: "kubectl apply -f web-deployment.yaml" },
      { type: "sim files replace web-service.yaml --search=wrong-app --replacement=manifest-web" },
      { type: "kubectl apply -f web-service.yaml" },
      { click: "manifest-gke を展開する" },
      { click: "svc: manifest-svc" },
      { wait: 300 },
    ],
  },
  {
    name: "mission-gke-manifest",
    label: "ミッション: 設定ファイルをapplyして反映",
    steps: [
      { wait: 800 },
      { click: "ミッション" },
      { click: "運用の維持0/53 クリア" },
      { click: "設定ファイルをapplyしてPodへ反映する未着手" },
      { click: "開始" },
      { click: "ヒント（0/5）" },
      { wait: 300 },
    ],
  },
  {
    name: "gke-env-properties",
    label: "GKE: 環境変数と更新履歴",
    steps: [...configSteps, { click: "deploy: config-web" }, { wait: 300 }],
  },
  {
    name: "gke-secret-properties",
    label: "GKE: Secretの値を隠したプロパティ",
    steps: [
      ...configSteps,
      { type: "kubectl label secret app-secret app=web environment=production" },
      { click: "secret: app-secret" },
      { wait: 300 },
    ],
  },
  {
    name: "mission-gke-config",
    label: "ミッション: ConfigMap変更を再起動で反映",
    steps: [
      { wait: 800 },
      { click: "ミッション" },
      { click: "運用の維持0/53 クリア" },
      { click: "ConfigMapの変更をPodの再起動で反映する未着手" },
      { click: "開始" },
      { click: "ヒント（0/5）" },
      { wait: 300 },
    ],
  },
  {
    name: "mission-gke-rollback",
    label: "ミッション: GKE更新失敗からの復旧",
    steps: [
      { wait: 800 },
      { click: "ミッション" },
      { click: "運用の維持0/53 クリア" },
      { click: "失敗したGKEの更新をロールバックする未着手" },
      { click: "開始" },
      { click: "ヒント（0/7）" },
      { wait: 300 },
    ],
  },
  {
    name: "mission-cleanup",
    label: "ミッション: コンテナ教材の片付け",
    steps: [
      { wait: 800 },
      { click: "ミッション" },
      { click: "運用の維持0/53 クリア" },
      { click: "残すイメージを守りながらコンテナ教材を片付ける未着手" },
      { click: "開始" },
      { click: "ヒント（0/4）" },
      { wait: 300 },
    ],
  },
  {
    name: "mission-categories",
    label: "ミッション: カテゴリ選択",
    steps: [{ wait: 800 }, { click: "ミッション" }, { wait: 300 }],
  },
  {
    name: "mission-list",
    label: "ミッション: カテゴリ内の一覧",
    steps: [
      { wait: 800 },
      { click: "ミッション" },
      { click: "環境セットアップ0/3 クリア" },
      { wait: 300 },
    ],
  },
  {
    name: "mission-steps",
    label: "ミッション: 選んだ1件の手順",
    steps: [
      { wait: 800 },
      { click: "ミッション" },
      { click: "環境セットアップ0/3 クリア" },
      { click: "本番用の configuration を用意する未着手" },
      { click: "開始" },
      { click: "ヒント（0/2）" },
      { wait: 300 },
    ],
  },
  {
    name: "home",
    label: "CLI 画面（初期 World）",
    steps: [{ wait: 800 }],
  },
  {
    name: "settings",
    label: "設定ダイアログ",
    steps: [{ wait: 800 }, { click: "設定" }, { wait: 300 }],
  },
  {
    name: "console-vm-list",
    label: "Console: VM インスタンス一覧（VM を 2 台作った状態）",
    steps: [
      { wait: 800 },
      { type: "gcloud compute instances create web-1 --zone=asia-northeast1-a --tags=http-server" },
      { type: "gcloud compute instances create batch-1 --zone=asia-northeast1-b --no-address" },
      { type: "gcloud compute instances stop batch-1 --zone=asia-northeast1-b" },
      { wait: 300 },
      { click: "Console" },
      { wait: 300 },
      { click: "VM インスタンス" },
      { wait: 300 },
    ],
  },
  {
    name: "console-vm-create",
    label: "Console: インスタンスを作成（名前とタグを入れた状態）",
    steps: [
      { wait: 800 },
      { click: "Console" },
      { wait: 300 },
      { click: "＋ インスタンスを作成" },
      { fill: ["名前", "web-2"] },
      { fill: ["ネットワーク タグ", "http-server"] },
      { wait: 300 },
    ],
  },
  {
    name: "console-iam",
    label: "Console: IAM（継承されたロールを含む）",
    steps: [
      { wait: 800 },
      {
        type: "gcloud resource-manager folders add-iam-policy-binding 284100000001 --member=user:dev@example.com --role=roles/compute.instanceAdmin.v1",
      },
      { wait: 300 },
      { click: "Console" },
      { wait: 300 },
      { click: "IAM" },
      { click: "＋ アクセス権を付与" },
      { wait: 300 },
    ],
  },
  {
    name: "mission-gke-final-multi-ready",
    label: "ミッション: 複数コンテナのReadyと接続先を確認する",
    steps: [
      {
        wait: 800,
      },
      {
        click: "ミッション",
      },
      {
        click: "運用の維持0/53 クリア",
      },
      {
        click: "複数コンテナのReadyと接続先を確認する未着手",
      },
      {
        click: "開始",
      },
      {
        click: "ヒント（0/4）",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "mission-gke-final-multi-restart",
    label: "ミッション: 補助コンテナだけを再起動して復旧する",
    steps: [
      {
        wait: 800,
      },
      {
        click: "ミッション",
      },
      {
        click: "運用の維持0/53 クリア",
      },
      {
        click: "補助コンテナだけを再起動して復旧する未着手",
      },
      {
        click: "開始",
      },
      {
        click: "ヒント（0/5）",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "mission-gke-final-workload-identity",
    label: "ミッション: Workload Identityで鍵なしの閲覧権限を設定する",
    steps: [
      {
        wait: 800,
      },
      {
        click: "ミッション",
      },
      {
        click: "アクセスとセキュリティ0/11 クリア",
      },
      {
        click: "Workload Identityで鍵なしの閲覧権限を設定する未着手",
      },
      {
        click: "開始",
      },
      {
        click: "ヒント（0/6）",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "mission-gke-final-metadata",
    label: "ミッション: Standardのメタデータ設定を復旧してID連携する",
    steps: [
      {
        wait: 800,
      },
      {
        click: "ミッション",
      },
      {
        click: "アクセスとセキュリティ0/11 クリア",
      },
      {
        click: "Standardのメタデータ設定を復旧してID連携する未着手",
      },
      {
        click: "開始",
      },
      {
        click: "ヒント（0/6）",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "mission-gke-final-vpa-off",
    label: "ミッション: VPAの推奨値を確認してrequestsを調整する",
    steps: [
      {
        wait: 800,
      },
      {
        click: "ミッション",
      },
      {
        click: "運用の維持0/53 クリア",
      },
      {
        click: "VPAの推奨値を確認してrequestsを調整する未着手",
      },
      {
        click: "開始",
      },
      {
        click: "ヒント（0/4）",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "mission-gke-final-autopilot-admission",
    label: "ミッション: Autopilotの既定値と最小リソース補正を確認する",
    steps: [
      {
        wait: 800,
      },
      {
        click: "ミッション",
      },
      {
        click: "運用の維持0/53 クリア",
      },
      {
        click: "Autopilotの既定値と最小リソース補正を確認する未着手",
      },
      {
        click: "開始",
      },
      {
        click: "ヒント（0/4）",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "mission-gke-final-regional",
    label: "ミッション: regionalクラスタの配置とレプリカ数を確認する",
    steps: [
      {
        wait: 800,
      },
      {
        click: "ミッション",
      },
      {
        click: "運用の維持0/53 クリア",
      },
      {
        click: "regionalクラスタの配置とレプリカ数を確認する未着手",
      },
      {
        click: "開始",
      },
      {
        click: "ヒント（0/4）",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "mission-gke-final-vpa-initial",
    label: "ミッション: VPA Initialを新しいPodだけに適用する",
    steps: [
      {
        wait: 800,
      },
      {
        click: "ミッション",
      },
      {
        click: "運用の維持0/53 クリア",
      },
      {
        click: "VPA Initialを新しいPodだけに適用する未着手",
      },
      {
        click: "開始",
      },
      {
        click: "ヒント（0/4）",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "mission-gke-final-vpa-recreate",
    label: "ミッション: VPA Recreateで垂直スケールする",
    steps: [
      {
        wait: 800,
      },
      {
        click: "ミッション",
      },
      {
        click: "運用の維持0/53 クリア",
      },
      {
        click: "VPA Recreateで垂直スケールする未着手",
      },
      {
        click: "開始",
      },
      {
        click: "ヒント（0/4）",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "gke-final-multi-partial",
    label: "GKE: 複数コンテナの部分Ready",
    steps: [
      {
        wait: 800,
      },
      {
        type: "gcloud services enable container.googleapis.com",
      },
      {
        type: "gcloud container clusters create final-gke --zone=us-central1-a --enable-vertical-pod-autoscaling",
      },
      {
        type: "sim files load kubernetes-gke-final",
      },
      {
        type: "kubectl apply -f multi-app.json",
      },
      {
        type: "kubectl apply -f multi-service.json",
      },
      {
        type: "sim kubernetes probe multi-app -c app --status-code=200",
      },
      {
        click: "final-gke を展開する",
      },
      {
        click: "deploy: multi-app",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "gke-final-multi-ready",
    label: "GKE: 全コンテナReadyと独立した環境",
    steps: [
      {
        wait: 800,
      },
      {
        type: "gcloud services enable container.googleapis.com",
      },
      {
        type: "gcloud container clusters create final-gke --zone=us-central1-a --enable-vertical-pod-autoscaling",
      },
      {
        type: "sim files load kubernetes-gke-final",
      },
      {
        type: "kubectl apply -f multi-app.json",
      },
      {
        type: "kubectl apply -f multi-service.json",
      },
      {
        type: "sim kubernetes probe multi-app -c app --status-code=200",
      },
      {
        type: "sim kubernetes probe multi-app -c agent --status-code=200",
      },
      {
        click: "final-gke を展開する",
      },
      {
        click: "deploy: multi-app",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "gke-final-multi-restarted",
    label: "GKE: 補助コンテナだけ再起動",
    steps: [
      {
        wait: 800,
      },
      {
        type: "gcloud services enable container.googleapis.com",
      },
      {
        type: "gcloud container clusters create final-gke --zone=us-central1-a --enable-vertical-pod-autoscaling",
      },
      {
        type: "sim files load kubernetes-gke-final",
      },
      {
        type: "kubectl apply -f multi-app.json",
      },
      {
        type: "kubectl apply -f multi-service.json",
      },
      {
        type: "sim kubernetes probe multi-app -c app --status-code=200",
      },
      {
        type: "sim kubernetes probe multi-app -c agent --status-code=200",
      },
      {
        type: "sim kubernetes probe multi-app -c agent --kind=liveness --status-code=500",
      },
      {
        click: "final-gke を展開する",
      },
      {
        click: "deploy: multi-app",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "gke-final-vpa-off",
    label: "GKE: VPA offのtemplate・Pod・推奨値",
    steps: [
      {
        wait: 800,
      },
      {
        type: "gcloud services enable container.googleapis.com",
      },
      {
        type: "gcloud container clusters create final-gke --zone=us-central1-a --enable-vertical-pod-autoscaling",
      },
      {
        type: "sim files load kubernetes-gke-final",
      },
      {
        type: "kubectl apply -f rightsize-app.json",
      },
      {
        type: "kubectl apply -f rightsize-vpa.json",
      },
      {
        type: "sim kubernetes recommend-vpa rightsize --cpu=250m --memory=100Mi",
      },
      {
        click: "final-gke を展開する",
      },
      {
        click: "vpa: rightsize",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "gke-final-vpa-initial",
    label: "GKE: VPA initialのtemplate・Pod・推奨値",
    steps: [
      {
        wait: 800,
      },
      {
        type: "gcloud services enable container.googleapis.com",
      },
      {
        type: "gcloud container clusters create final-gke --zone=us-central1-a --enable-vertical-pod-autoscaling",
      },
      {
        type: "sim files load kubernetes-gke-final",
      },
      {
        type: "kubectl apply -f rightsize-app.json",
      },
      {
        type: "kubectl apply -f rightsize-initial.json",
      },
      {
        type: "sim kubernetes recommend-vpa rightsize --cpu=250m --memory=100Mi",
      },
      {
        type: "kubectl scale deployment/rightsize-app --replicas=3",
      },
      {
        click: "final-gke を展開する",
      },
      {
        click: "vpa: rightsize",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "gke-final-vpa-recreate",
    label: "GKE: VPA recreateのtemplate・Pod・推奨値",
    steps: [
      {
        wait: 800,
      },
      {
        type: "gcloud services enable container.googleapis.com",
      },
      {
        type: "gcloud container clusters create final-gke --zone=us-central1-a --enable-vertical-pod-autoscaling",
      },
      {
        type: "sim files load kubernetes-gke-final",
      },
      {
        type: "kubectl apply -f rightsize-app.json",
      },
      {
        type: "kubectl apply -f rightsize-recreate.json",
      },
      {
        type: "sim kubernetes recommend-vpa rightsize --cpu=250m --memory=100Mi",
      },
      {
        click: "final-gke を展開する",
      },
      {
        click: "vpa: rightsize",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "gke-final-identity",
    label: "GKE: KSA/IAM連携と閲覧のみ許可",
    steps: [
      {
        wait: 800,
      },
      {
        type: "gcloud services enable container.googleapis.com",
      },
      {
        type: "gcloud container clusters create final-gke --zone=us-central1-a --enable-vertical-pod-autoscaling",
      },
      {
        type: "sim files load kubernetes-gke-final",
      },
      {
        type: "gcloud container clusters update final-gke --zone=us-central1-a --workload-pool=ace-dev-01.svc.id.goog",
      },
      {
        type: "gcloud container node-pools update default-pool --cluster=final-gke --zone=us-central1-a --workload-metadata=GKE_METADATA",
      },
      {
        type: "gcloud services enable iamcredentials.googleapis.com",
      },
      {
        type: "gcloud iam service-accounts create lesson-reader",
      },
      {
        type: "gcloud storage buckets create gs://ace-workload-data --location=us-central1",
      },
      {
        type: "kubectl apply -f identity-account.json",
      },
      {
        type: "kubectl apply -f identity-app.json",
      },
      {
        type: "gcloud iam service-accounts add-iam-policy-binding lesson-reader@ace-dev-01.iam.gserviceaccount.com --role=roles/iam.workloadIdentityUser --member='serviceAccount:ace-dev-01.svc.id.goog[default/bucket-reader]'",
      },
      {
        type: "kubectl annotate sa bucket-reader iam.gke.io/gcp-service-account=lesson-reader@ace-dev-01.iam.gserviceaccount.com",
      },
      {
        type: "gcloud storage buckets add-iam-policy-binding gs://ace-workload-data --member=serviceAccount:lesson-reader@ace-dev-01.iam.gserviceaccount.com --role=roles/storage.objectViewer",
      },
      {
        type: "sim kubernetes check-access identity-app --bucket=ace-workload-data --permission=storage.objects.list",
      },
      {
        type: "sim kubernetes check-access identity-app --bucket=ace-workload-data --permission=storage.objects.delete",
      },
      {
        click: "final-gke を展開する",
      },
      {
        click: "serviceaccount: bucket-reader",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "gke-final-metadata",
    label: "GKE: Standard poolのGKE_METADATA",
    steps: [
      {
        wait: 800,
      },
      {
        type: "gcloud services enable container.googleapis.com",
      },
      {
        type: "gcloud container clusters create final-gke --zone=us-central1-a --enable-vertical-pod-autoscaling",
      },
      {
        type: "sim files load kubernetes-gke-final",
      },
      {
        type: "gcloud container clusters update final-gke --zone=us-central1-a --workload-pool=ace-dev-01.svc.id.goog",
      },
      {
        type: "gcloud container node-pools update default-pool --cluster=final-gke --zone=us-central1-a --workload-metadata=GKE_METADATA",
      },
      {
        click: "final-gke を展開する",
      },
      {
        click: "pool: default-pool",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "gke-final-regional",
    label: "GKE: regionalのzoneと総ノード数",
    steps: [
      {
        wait: 800,
      },
      {
        type: "gcloud services enable container.googleapis.com",
      },
      {
        type: "gcloud container clusters create final-gke --region=us-central1 --num-nodes=1",
      },
      {
        type: "sim files load kubernetes-gke-final",
      },
      {
        type: "kubectl apply -f regional-app.json",
      },
      {
        type: "kubectl apply -f regional-service.json",
      },
      {
        type: "kubectl get nodes",
      },
      {
        click: "final-gke を展開する",
      },
      {
        click: "final-gke",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "gke-final-autopilot",
    label: "GKE: Autopilotの最小requests/limits補正",
    steps: [
      {
        wait: 800,
      },
      {
        type: "gcloud services enable container.googleapis.com",
      },
      {
        type: "gcloud container clusters create-auto final-gke --region=us-central1",
      },
      {
        type: "sim files load kubernetes-gke-final",
      },
      {
        type: "kubectl apply -f autopilot-small.json",
      },
      {
        type: "sim kubernetes admit-autopilot small-app",
      },
      {
        type: "kubectl get deployment small-app -o json",
      },
      {
        click: "final-gke を展開する",
      },
      {
        click: "deploy: small-app",
      },
      {
        wait: 300,
      },
    ],
  },
];
