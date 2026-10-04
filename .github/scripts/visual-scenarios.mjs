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
export const SCENARIOS = [
  {
    name: "mission-gke-manifest",
    label: "ミッション: 設定ファイルをapplyして反映",
    steps: [
      { wait: 800 },
      { click: "ミッション 0/42" },
      { click: "運用の維持0/16 クリア" },
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
    steps: [...configSteps, { click: "secret: app-secret" }, { wait: 300 }],
  },
  {
    name: "mission-gke-config",
    label: "ミッション: ConfigMap変更を再起動で反映",
    steps: [
      { wait: 800 },
      { click: "ミッション 0/42" },
      { click: "運用の維持0/16 クリア" },
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
      { click: "ミッション 0/42" },
      { click: "運用の維持0/16 クリア" },
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
      { click: "ミッション 0/42" },
      { click: "運用の維持0/16 クリア" },
      { click: "残すイメージを守りながらコンテナ教材を片付ける未着手" },
      { click: "開始" },
      { click: "ヒント（0/4）" },
      { wait: 300 },
    ],
  },
  {
    name: "mission-categories",
    label: "ミッション: カテゴリ選択",
    steps: [{ wait: 800 }, { click: "ミッション 0/42" }, { wait: 300 }],
  },
  {
    name: "mission-list",
    label: "ミッション: カテゴリ内の一覧",
    steps: [
      { wait: 800 },
      { click: "ミッション 0/42" },
      { click: "環境セットアップ0/3 クリア" },
      { wait: 300 },
    ],
  },
  {
    name: "mission-steps",
    label: "ミッション: 選んだ1件の手順",
    steps: [
      { wait: 800 },
      { click: "ミッション 0/42" },
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
];
