/** 公開CLIと通常の画面操作だけで準備できる撮影シナリオ。廃止した演習は含めない。 */
export const VIEWPORTS = [
  {
    name: "desktop",
    width: 1440,
    height: 1600,
    maxHeight: 2000,
  },
  {
    name: "mobile",
    width: 430,
    height: 1200,
    maxHeight: 2600,
  },
];

export const FROZEN_TIME = Date.UTC(2026, 0, 1, 12, 0, 0);

export const SCENARIOS = [
  {
    name: "observe-channel-unverified",
    label: "監視: 通知チャネルの有効/検証状態",
    steps: [
      {
        wait: 800,
      },
      {
        type: "gcloud services enable monitoring.googleapis.com logging.googleapis.com",
      },
      {
        type: "gcloud monitoring channels create --display-name=oncall --type=email --channel-labels=email_address=oncall@example.com",
      },
      {
        click: "channels: oncall",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "observe-analytics-bucket",
    label: "Logging: 保持とAnalyticsアップグレード",
    steps: [
      {
        wait: 800,
      },
      {
        type: "gcloud services enable monitoring.googleapis.com logging.googleapis.com",
      },
      {
        type: "gcloud logging buckets create archive --location=us-central1 --retention-days=7 --enable-analytics",
      },
      {
        click: "buckets: us-central1/archive",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "admin-quota-pending",
    label: "クォータ: 申請値32と承認値24を分けて表示",
    steps: [
      {
        wait: 800,
      },
      {
        type: "gcloud services enable orgpolicy.googleapis.com cloudidentity.googleapis.com cloudidentityscim.googleapis.com cloudquotas.googleapis.com billingbudgets.googleapis.com bigquery.googleapis.com",
      },
      {
        type: "gcloud quotas preferences create --preference-id=admin-cpus --service=compute.googleapis.com --quota-id=CpusPerProjectPerRegion --preferred-value=32 --dimensions=region=us-central1 --email=owner@example.com",
      },
      {
        click: "CPUクォータ: us-central1",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "lb-cdn-bucket",
    label: "LB: cdn-bucket",
    steps: [
      {
        wait: 800,
      },
      {
        type: "gcloud storage buckets create gs://lb-static-data --location=us-central1",
      },
      {
        type: "gcloud storage buckets add-iam-policy-binding gs://lb-static-data --member=allUsers --role=roles/storage.objectViewer",
      },
      {
        type: "gcloud compute backend-buckets create static-backend --global --gcs-bucket-name=lb-static-data --enable-cdn --cache-mode=CACHE_ALL_STATIC",
      },
      {
        type: "gcloud compute url-maps create static-map --global --default-backend-bucket=static-backend",
      },
      {
        type: "gcloud compute target-http-proxies create static-proxy --global --url-map=static-map",
      },
      {
        type: "gcloud compute forwarding-rules create static-front --global --load-balancing-scheme=EXTERNAL_MANAGED --target-http-proxy=static-proxy --ports=80 --network-tier=PREMIUM",
      },
      {
        click: "backendBuckets: static-backend",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "mission-gke-nodepool-upgrade",
    label: "ミッション: 制御プレーンとノードプールを別々に更新する",
    steps: [
      {
        wait: 800,
      },
      {
        click: "ミッション",
      },
      {
        fill: ["ミッション分類", "practice"],
      },
      {
        click: "運用の維持0/53 クリア",
      },
      {
        click: "制御プレーンとノードプールを別々に更新する未着手",
      },
      {
        click: "開始",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "gke-nodepool-upgrade-apps",
    label: "GKE: 制御プレーンとappsの独立した版",
    steps: [
      {
        wait: 800,
      },
      {
        type: "gcloud services enable container.googleapis.com",
      },
      {
        type: "gcloud container clusters create ops-gke --zone=us-central1-a --num-nodes=2",
      },
      {
        type: "gcloud container node-pools create apps --cluster=ops-gke --zone=us-central1-a --machine-type=e2-standard-4 --disk-size=200 --num-nodes=1",
      },
      {
        type: "gcloud container clusters upgrade ops-gke --zone=us-central1-a --master --quiet",
      },
      {
        type: "gcloud container clusters upgrade ops-gke --zone=us-central1-a --node-pool=apps --quiet",
      },
      {
        type: "gcloud container node-pools list --cluster=ops-gke --zone=us-central1-a",
      },
      {
        click: "ops-gke を展開する",
      },
      {
        click: "pool: apps",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "gke-nodepool-upgrade-default-pool",
    label: "GKE: 制御プレーンとdefault-poolの独立した版",
    steps: [
      {
        wait: 800,
      },
      {
        type: "gcloud services enable container.googleapis.com",
      },
      {
        type: "gcloud container clusters create ops-gke --zone=us-central1-a --num-nodes=2",
      },
      {
        type: "gcloud container node-pools create apps --cluster=ops-gke --zone=us-central1-a --machine-type=e2-standard-4 --disk-size=200 --num-nodes=1",
      },
      {
        type: "gcloud container clusters upgrade ops-gke --zone=us-central1-a --master --quiet",
      },
      {
        type: "gcloud container clusters upgrade ops-gke --zone=us-central1-a --node-pool=apps --quiet",
      },
      {
        type: "gcloud container node-pools list --cluster=ops-gke --zone=us-central1-a",
      },
      {
        click: "ops-gke を展開する",
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
    name: "gke-nodepool-deleted-default",
    label: "GKE: 既定プールの削除を一覧とツリーへ反映",
    steps: [
      {
        wait: 800,
      },
      {
        type: "gcloud services enable container.googleapis.com",
      },
      {
        type: "gcloud container clusters create ops-gke --zone=us-central1-a --num-nodes=2",
      },
      {
        type: "gcloud container node-pools create apps --cluster=ops-gke --zone=us-central1-a --machine-type=e2-standard-4 --disk-size=200 --num-nodes=1",
      },
      {
        type: "gcloud container node-pools delete default-pool --cluster=ops-gke --zone=us-central1-a --quiet",
      },
      {
        type: "gcloud container node-pools list --cluster=ops-gke --zone=us-central1-a",
      },
      {
        click: "ops-gke を展開する",
      },
      {
        click: "pool: apps",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "gke-network-policy-cluster",
    label: "GKE: StandardのNetworkPolicy強制状態",
    steps: [
      {
        wait: 800,
      },
      {
        type: "gcloud services enable container.googleapis.com",
      },
      {
        type: "gcloud container clusters create policy-standard --region=us-central1 --enable-network-policy",
      },
      {
        click: "policy-standard",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "mission-gke-volumes",
    label: "ミッション: 設定ファイルのマウント障害を直す",
    steps: [
      {
        wait: 800,
      },
      {
        click: "ミッション",
      },
      {
        fill: ["ミッション分類", "practice"],
      },
      {
        click: "運用の維持0/53 クリア",
      },
      {
        click: "設定ファイルのマウント障害を直す未着手",
      },
      {
        click: "開始",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "mission-gke-volume-refresh",
    label: "ミッション: マウントと環境変数の更新差を確認する",
    steps: [
      {
        wait: 800,
      },
      {
        click: "ミッション",
      },
      {
        fill: ["ミッション分類", "practice"],
      },
      {
        click: "運用の維持0/53 クリア",
      },
      {
        click: "マウントと環境変数の更新差を確認する未着手",
      },
      {
        click: "開始",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "mission-gke-binary-data",
    label: "ミッション: バイナリ設定と環境変数の分離",
    steps: [
      {
        wait: 800,
      },
      {
        click: "ミッション",
      },
      {
        fill: ["ミッション分類", "practice"],
      },
      {
        click: "運用の維持0/53 クリア",
      },
      {
        click: "バイナリ設定と環境変数の参照を分ける未着手",
      },
      {
        click: "開始",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "mission-gke-immutable",
    label: "ミッション: 変更不可の設定を再作成して反映",
    steps: [
      {
        wait: 800,
      },
      {
        click: "ミッション",
      },
      {
        fill: ["ミッション分類", "practice"],
      },
      {
        click: "運用の維持0/53 クリア",
      },
      {
        click: "変更できない設定を作り直してPodへ反映する未着手",
      },
      {
        click: "開始",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "mission-gke-config-labels",
    label: "ミッション: ConfigMap・Secretのラベル分類",
    steps: [
      {
        wait: 800,
      },
      {
        click: "ミッション",
      },
      {
        fill: ["ミッション分類", "practice"],
      },
      {
        click: "運用の維持0/53 クリア",
      },
      {
        click: "ラベルでConfigMap・Secretを分類する未着手",
      },
      {
        click: "開始",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "mission-gke-context",
    label: "ミッション: コンテキストの既定namespace切り替え",
    steps: [
      {
        wait: 800,
      },
      {
        click: "ミッション",
      },
      {
        fill: ["ミッション分類", "practice"],
      },
      {
        click: "運用の維持0/53 クリア",
      },
      {
        click: "コンテキストの既定namespaceを切り替える未着手",
      },
      {
        click: "開始",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "gke-context-namespace",
    label: "GKE: 既定namespace・同名Deployment・コンテキスト一覧",
    steps: [
      {
        wait: 800,
      },
      {
        type: "gcloud services enable container.googleapis.com",
      },
      {
        type: "gcloud container clusters create context-gke --zone=us-central1-a",
      },
      {
        type: "kubectl create namespace staging",
      },
      {
        type: "kubectl create namespace production",
      },
      {
        type: "kubectl create deployment web --image=nginx:1 -n staging",
      },
      {
        type: "kubectl create deployment web --image=nginx:1 -n production",
      },
      {
        type: "kubectl config set-context --current --namespace=staging",
      },
      {
        type: "kubectl set image deployment/web web=nginx:2",
      },
      {
        type: "kubectl scale deployment/web --replicas=2",
      },
      {
        type: "kubectl get deployments -A",
      },
      {
        type: "kubectl config get-contexts",
      },
      {
        click: "context-gke を展開する",
      },
      {
        click: "namespace: staging を展開する",
      },
      {
        click: "deploy: web",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "mission-gke-namespace",
    label: "ミッション: namespaceで検証と本番を分離",
    steps: [
      {
        wait: 800,
      },
      {
        click: "ミッション",
      },
      {
        fill: ["ミッション分類", "practice"],
      },
      {
        click: "運用の維持0/53 クリア",
      },
      {
        click: "namespaceで検証環境と本番環境を分ける未着手",
      },
      {
        click: "開始",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "mission-gke-qos",
    label: "ミッション: PodのQoSを比較する",
    steps: [
      {
        wait: 800,
      },
      {
        click: "ミッション",
      },
      {
        fill: ["ミッション分類", "practice"],
      },
      {
        click: "運用の維持0/53 クリア",
      },
      {
        click: "requestsとlimitsからPodのQoSを比較する未着手",
      },
      {
        click: "開始",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "gke-qos-properties",
    label: "GKE: Guaranteed PodのQoSとresources",
    steps: [
      {
        wait: 800,
      },
      {
        type: "gcloud services enable container.googleapis.com",
      },
      {
        type: "gcloud container clusters create qos-gke --zone=us-central1-a",
      },
      {
        type: "kubectl create deployment qos-guaranteed --image=nginx:1",
      },
      {
        type: "kubectl set resources deployment/qos-guaranteed --limits=cpu=500m,memory=256Mi",
      },
      {
        type: "kubectl get pods -o yaml",
      },
      {
        click: "qos-gke を展開する",
      },
      {
        click: "deploy: qos-guaranteed",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "mission-gke-resources",
    label: "ミッション: CPU・メモリの必要量と上限",
    steps: [
      {
        wait: 800,
      },
      {
        click: "ミッション",
      },
      {
        fill: ["ミッション分類", "practice"],
      },
      {
        click: "運用の維持0/53 クリア",
      },
      {
        click: "CPU・メモリの必要量と上限を設定する未着手",
      },
      {
        click: "開始",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "gke-resource-properties",
    label: "GKE: CPU・メモリの設定と履歴",
    steps: [
      {
        wait: 800,
      },
      {
        type: "gcloud services enable container.googleapis.com",
      },
      {
        type: "gcloud container clusters create-auto resources-gke --region=us-central1",
      },
      {
        type: "kubectl create deployment resource-web --image=nginx:1 --replicas=2",
      },
      {
        type: "kubectl set resources deployment/resource-web --requests=cpu=250m,memory=128Mi --limits=cpu=500m,memory=256Mi",
      },
      {
        type: "kubectl get deployment resource-web -o yaml",
      },
      {
        click: "resources-gke を展開する",
      },
      {
        click: "deploy: resource-web",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "mission-gke-labels",
    label: "ミッション: 複数ラベルで公開先を切り替え",
    steps: [
      {
        wait: 800,
      },
      {
        click: "ミッション",
      },
      {
        fill: ["ミッション分類", "practice"],
      },
      {
        click: "運用の維持0/53 クリア",
      },
      {
        click: "ラベルでServiceの公開先を切り替える未着手",
      },
      {
        click: "開始",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "mission-gke-workload",
    label: "ミッション: マニフェスト更新とService接続先",
    steps: [
      {
        wait: 800,
      },
      {
        click: "ミッション",
      },
      {
        fill: ["ミッション分類", "practice"],
      },
      {
        click: "運用の維持0/53 クリア",
      },
      {
        click: "マニフェストでアプリを更新しServiceの接続先を直す未着手",
      },
      {
        click: "開始",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "mission-gke-manifest",
    label: "ミッション: 設定ファイルをapplyして反映",
    steps: [
      {
        wait: 800,
      },
      {
        click: "ミッション",
      },
      {
        fill: ["ミッション分類", "practice"],
      },
      {
        click: "運用の維持0/53 クリア",
      },
      {
        click: "設定ファイルをapplyしてPodへ反映する未着手",
      },
      {
        click: "開始",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "gke-env-properties",
    label: "GKE: 環境変数と更新履歴",
    steps: [
      {
        wait: 800,
      },
      {
        type: "gcloud services enable container.googleapis.com",
      },
      {
        type: "gcloud container clusters create-auto config-gke --region=us-central1",
      },
      {
        type: "kubectl create deployment config-web --image=nginx:1 --replicas=2",
      },
      {
        type: "kubectl create configmap app-config --from-literal=APP_MODE=production",
      },
      {
        type: "kubectl create secret generic app-secret --from-literal=API_TOKEN=demo-token",
      },
      {
        type: "kubectl set env deployment/config-web --from=configmap/app-config",
      },
      {
        type: "kubectl set env deployment/config-web --from=secret/app-secret",
      },
      {
        type: "kubectl set env deployment/config-web LOG_LEVEL=info",
      },
      {
        type: "kubectl rollout restart deployment/config-web",
      },
      {
        click: "config-gke を展開する",
      },
      {
        click: "deploy: config-web",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "gke-secret-properties",
    label: "GKE: Secretの値を隠したプロパティ",
    steps: [
      {
        wait: 800,
      },
      {
        type: "gcloud services enable container.googleapis.com",
      },
      {
        type: "gcloud container clusters create-auto config-gke --region=us-central1",
      },
      {
        type: "kubectl create deployment config-web --image=nginx:1 --replicas=2",
      },
      {
        type: "kubectl create configmap app-config --from-literal=APP_MODE=production",
      },
      {
        type: "kubectl create secret generic app-secret --from-literal=API_TOKEN=demo-token",
      },
      {
        type: "kubectl set env deployment/config-web --from=configmap/app-config",
      },
      {
        type: "kubectl set env deployment/config-web --from=secret/app-secret",
      },
      {
        type: "kubectl set env deployment/config-web LOG_LEVEL=info",
      },
      {
        type: "kubectl rollout restart deployment/config-web",
      },
      {
        click: "config-gke を展開する",
      },
      {
        type: "kubectl label secret app-secret app=web environment=production",
      },
      {
        click: "secret: app-secret",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "mission-gke-config",
    label: "ミッション: ConfigMap変更を再起動で反映",
    steps: [
      {
        wait: 800,
      },
      {
        click: "ミッション",
      },
      {
        fill: ["ミッション分類", "practice"],
      },
      {
        click: "運用の維持0/53 クリア",
      },
      {
        click: "ConfigMapの変更をPodの再起動で反映する未着手",
      },
      {
        click: "開始",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "mission-gke-rollback",
    label: "ミッション: GKE更新失敗からの復旧",
    steps: [
      {
        wait: 800,
      },
      {
        click: "ミッション",
      },
      {
        fill: ["ミッション分類", "practice"],
      },
      {
        click: "運用の維持0/53 クリア",
      },
      {
        click: "失敗したGKEの更新をロールバックする未着手",
      },
      {
        click: "開始",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "mission-cleanup",
    label: "ミッション: コンテナ教材の片付け",
    steps: [
      {
        wait: 800,
      },
      {
        click: "ミッション",
      },
      {
        fill: ["ミッション分類", "practice"],
      },
      {
        click: "運用の維持0/53 クリア",
      },
      {
        click: "残すイメージを守りながらコンテナ教材を片付ける未着手",
      },
      {
        click: "開始",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "mission-categories",
    label: "ミッション: カテゴリ選択",
    steps: [
      {
        wait: 800,
      },
      {
        click: "ミッション",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "mission-list",
    label: "ミッション: カテゴリ内の一覧",
    steps: [
      {
        wait: 800,
      },
      {
        click: "ミッション",
      },
      {
        fill: ["ミッション分類", "practice"],
      },
      {
        click: "環境セットアップ0/3 クリア",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "mission-steps",
    label: "ミッション: 選んだ1件の手順",
    steps: [
      {
        wait: 800,
      },
      {
        click: "ミッション",
      },
      {
        fill: ["ミッション分類", "practice"],
      },
      {
        click: "環境セットアップ0/3 クリア",
      },
      {
        click: "本番用の configuration を用意する未着手",
      },
      {
        click: "開始",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "home",
    label: "CLI 画面（初期 World）",
    steps: [
      {
        wait: 800,
      },
    ],
  },
  {
    name: "settings",
    label: "設定ダイアログ",
    steps: [
      {
        wait: 800,
      },
      {
        click: "設定",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "console-vm-list",
    label: "Console: VM インスタンス一覧（VM を 2 台作った状態）",
    steps: [
      {
        wait: 800,
      },
      {
        type: "gcloud compute instances create web-1 --zone=asia-northeast1-a --tags=http-server",
      },
      {
        type: "gcloud compute instances create batch-1 --zone=asia-northeast1-b --no-address",
      },
      {
        type: "gcloud compute instances stop batch-1 --zone=asia-northeast1-b",
      },
      {
        wait: 300,
      },
      {
        click: "Console",
      },
      {
        wait: 300,
      },
      {
        click: "VM インスタンス",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "console-mission-stop",
    label: "Console: ミッションパネルと画面操作の手順",
    steps: [
      {
        wait: 800,
      },
      {
        click: "Console",
      },
      {
        wait: 300,
      },
      {
        click: "ミッション",
      },
      {
        click: "3. クラウド ソリューションの正常な運用0/1 クリア",
      },
      {
        click: "Consoleで VM を停止するConsole未着手",
      },
      {
        click: "開始",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "console-vm-create",
    label: "Console: インスタンスを作成（名前とタグを入れた状態）",
    steps: [
      {
        wait: 800,
      },
      {
        click: "Console",
      },
      {
        wait: 300,
      },
      {
        click: "＋ インスタンスを作成",
      },
      {
        fill: ["名前", "web-2"],
      },
      {
        click: "ネットワーキング",
      },
      {
        fill: ["ネットワーク タグ", "http-server"],
      },
      {
        click: "マシンの構成",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "console-iam",
    label: "Console: IAM（継承されたロールを含む）",
    steps: [
      {
        wait: 800,
      },
      {
        type: "gcloud resource-manager folders add-iam-policy-binding 284100000001 --member=user:dev@example.com --role=roles/compute.instanceAdmin.v1",
      },
      {
        wait: 300,
      },
      {
        click: "Console",
      },
      {
        wait: 300,
      },
      {
        click: "すべてのプロダクト",
      },
      {
        click: "IAM",
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
        fill: ["ミッション分類", "practice"],
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
        wait: 300,
      },
    ],
  },
  {
    name: "configuration-file-editor",
    label: "設定ファイル: テンプレートの読み込みと通常の編集画面",
    steps: [
      {
        wait: 800,
      },
      {
        click: "ファイル",
      },
      {
        click: "テンプレートを読み込む",
      },
      {
        wait: 300,
      },
    ],
  },
  {
    name: "terraform-network-state",
    label: "Terraform: ファイル画面と正式CLIで構築したstate",
    steps: [
      {
        wait: 800,
      },
      {
        click: "ファイル",
      },
      {
        click: "テンプレートを読み込む",
      },
      {
        click: "プロパティ",
      },
      {
        type: "gcloud auth application-default login",
      },
      {
        type: "terraform init",
      },
      {
        type: "terraform apply -auto-approve",
      },
      {
        click: "State: google_compute_network.lab",
      },
      {
        wait: 300,
      },
    ],
  },
];
