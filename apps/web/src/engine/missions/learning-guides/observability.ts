import { CommonSteps } from "./common";
import type { MissionGuide } from "./model";

export const ObservabilityGuides = {
  "m-observe-001": {
    introduction:
      "まずエラーログを選ぶフィルタを決め、選ばれたログを件数として監視するカウンタ指標を作ります。",
    steps: [
      {
        title: "操作するプロジェクトとAPIを準備する",
        explanation:
          "最初に操作する本人と対象プロジェクトを固定します。以降のコマンドで対象を省略しても、ここで選んだ環境に作用します。",
        actions: [
          {
            kind: "command",
            text: "gcloud config set account owner@example.com",
          },
          {
            kind: "command",
            text: "gcloud config set project ace-dev-01",
          },
          {
            kind: "command",
            text: "gcloud services enable logging.googleapis.com",
          },
        ],
        points: [
          {
            term: "configuration",
            description:
              "gcloudの接続先や既定値をまとめた設定です。set accountは操作主体、set projectは対象を選びます。",
          },
          {
            term: "services enable",
            description:
              "サービスのAPIをプロジェクトで利用可能にします。IAMの権限付与とは別の操作です。",
          },
        ],
        expected:
          "アカウントはowner@example.com、プロジェクトはace-dev-01です。APIの有効化が成功してから次へ進みます。",
      },
      {
        title: "ERROR以上のログを数える指標を作る",
        explanation: "エラーとそれより重大なログに対象を絞ります。",
        actions: [
          {
            kind: "command",
            text: "gcloud logging metrics create user_errors --log-filter='severity>=ERROR'",
          },
        ],
        points: [
          {
            term: "--log-filter",
            description: "どのログを指標の対象にするかを指定します。",
          },
          {
            term: "severity>=ERROR",
            description:
              "重大度がERROR以上のログを選びます。引用符で囲み、フィルタ全体を1つの引数として渡します。",
          },
        ],
        expected: "user_errorsが作成されます。",
      },
      {
        title: "フィルタと指標の型を確認する",
        explanation: "名前が合うだけでなく、集計対象とカウンタの型を確認します。",
        actions: [
          {
            kind: "command",
            text: "gcloud logging metrics describe user_errors",
          },
        ],
        points: [
          {
            term: "metricDescriptor",
            description:
              "指標の型や値の種類を表す定義です。この演習ではログ件数を数えるカウンタを確認します。",
          },
        ],
        expected:
          "filterがseverity>=ERRORで、件数を数える指標の定義があります。実ログの取り込みは再現しません。",
      },
    ],
    takeaway:
      "ログベース指標はログを数値として集計するための設定です。アラートの通知条件は別途設定します。",
  },
  "m-observe-002": {
    introduction:
      "Webサイトの生存確認を想定し、HTTPS、対象パス、間隔を設定します。教材では実際のサイトへ通信しません。",
    steps: [
      CommonSteps.prepareMonitoring,
      {
        title: "HTTPSの確認条件を設定する",
        explanation: "example.comの/healthzを5分間隔で確認する設定を作ります。",
        actions: [
          {
            kind: "command",
            text: "gcloud monitoring uptime create public-web --resource-type=uptime-url --resource-labels=host=example.com,project_id=ace-dev-01 --protocol=https --path=/healthz --period=5",
          },
        ],
        points: [
          {
            term: "--resource-labels",
            description:
              "ホストと所属プロジェクトをキーと値で渡します。hostにURL全体を書きません。",
          },
          {
            term: "--protocol=httpsと--path",
            description: "HTTPSで接続し、ホストの/healthzを対象とします。",
          },
          {
            term: "--period=5",
            description: "このコマンドでは分単位の間隔を指定します。",
          },
        ],
        expected: "public-webが作成されます。",
      },
      {
        title: "保存された監視条件を確認する",
        explanation: "一覧をJSONで表示し、対象と周期を照合します。",
        actions: [
          {
            kind: "command",
            text: "gcloud monitoring uptime list --format=json",
          },
        ],
        points: [
          {
            term: "--format=json",
            description: "省略された列だけでなく、設定全体を構造化された形式で確認します。",
          },
        ],
        expected:
          "displayNameがpublic-web、HTTPSの443番、pathが/healthz、周期が300秒に対応する設定です。",
      },
    ],
    takeaway: "ホスト名とURLパスは別の設定です。プロトコルや間隔を含む監視条件を確認します。",
  },
  "m-observe-003": {
    introduction:
      "CPU使用率を表示するダッシュボードのJSONを検証し、保存しない検証と実際の作成を比較します。",
    steps: [
      CommonSteps.prepareMonitoring,
      {
        title: "設定ファイルを検証する",
        explanation:
          "教材に用意されたcpu-dashboard.jsonを使い、まず保存せずに設定の形式を確認します。",
        actions: [
          {
            kind: "command",
            text: "gcloud monitoring dashboards create --config-from-file=cpu-dashboard.json --validate-only",
          },
        ],
        points: [
          {
            term: "--config-from-file",
            description: "ダッシュボードのタイトル・チャートなどを書いたJSONを読み込みます。",
          },
          {
            term: "--validate-only",
            description: "検証だけを行い、ダッシュボードを保存しません。",
          },
        ],
        expected: "検証に成功しますが、この時点ではダッシュボードはありません。",
      },
      {
        title: "同じファイルで実際に作成する",
        explanation: "検証用フラグを外して保存し、一覧で確認します。",
        actions: [
          {
            kind: "command",
            text: "gcloud monitoring dashboards create --config-from-file=cpu-dashboard.json",
          },
          {
            kind: "command",
            text: "gcloud monitoring dashboards list --format=json",
          },
        ],
        points: [
          {
            term: "VM CPUとCPU指標",
            description:
              "タイトルだけでなく、compute.googleapis.com/instance/cpu/utilizationを表示するチャートか確認します。",
          },
        ],
        expected: "VM CPUのダッシュボードが保存され、CPU指標のチャートが含まれています。",
      },
    ],
    takeaway: "validate-onlyが成功してもリソースは作成されません。構成検証と反映を区別します。",
  },
  "m-observe-004": {
    introduction:
      "CPU使用率のしきい値だけでなく、その状態が続く時間も指定してアラートの条件を作ります。",
    steps: [
      CommonSteps.prepareMonitoring,
      {
        title: "CPU高負荷が5分続く条件を作る",
        explanation: "対象をVMのCPU指標に絞り、瞬間的な上昇だけでは条件を満たさないようにします。",
        actions: [
          {
            kind: "command",
            text: "gcloud monitoring policies create --display-name='CPU high' --condition-display-name='CPU > 80%' --condition-filter='metric.type=\"compute.googleapis.com/instance/cpu/utilization\" AND resource.type=\"gce_instance\"' --if='> 0.8' --duration=300s",
          },
        ],
        points: [
          {
            term: "--condition-filter",
            description:
              "監視する指標とリソース種別を選びます。ANDで両条件を満たす対象へ絞ります。",
          },
          {
            term: "--if='> 0.8'",
            description: "CPU使用率が80%を超える条件です。",
          },
          {
            term: "--duration=300s",
            description: "その状態が300秒続くことを要求します。",
          },
        ],
        expected: "CPU highが有効なポリシーとして作成されます。",
      },
      {
        title: "有効状態と条件を確認する",
        explanation: "無効なポリシーを作っていないか、設定を一覧で確認します。",
        actions: [
          {
            kind: "command",
            text: "gcloud monitoring policies list --format=json",
          },
        ],
        points: [
          {
            term: "enabled",
            description:
              "アラートポリシーを有効にする設定です。--no-enabledを付けた場合は監視条件として使われません。",
          },
        ],
        expected:
          "CPU highがenabledで、しきい値0.8、継続時間300sです。実際の通知配送は行いません。",
      },
    ],
    takeaway: "80%は0.8、5分は300sです。条件、継続時間、有効状態を分けて確認します。",
  },
  "m-observe-005": {
    introduction:
      "ログの転送先を作ってシンクを接続し、転送処理そのものの主体へ書き込み権限を与えます。",
    steps: [
      {
        title: "操作するプロジェクトとAPIを準備する",
        explanation:
          "最初に操作する本人と対象プロジェクトを固定します。以降のコマンドで対象を省略しても、ここで選んだ環境に作用します。",
        actions: [
          {
            kind: "command",
            text: "gcloud config set account owner@example.com",
          },
          {
            kind: "command",
            text: "gcloud config set project ace-dev-01",
          },
          {
            kind: "command",
            text: "gcloud services enable logging.googleapis.com storage.googleapis.com",
          },
        ],
        points: [
          {
            term: "configuration",
            description:
              "gcloudの接続先や既定値をまとめた設定です。set accountは操作主体、set projectは対象を選びます。",
          },
          {
            term: "services enable",
            description:
              "サービスのAPIをプロジェクトで利用可能にします。IAMの権限付与とは別の操作です。",
          },
        ],
        expected:
          "アカウントはowner@example.com、プロジェクトはace-dev-01です。APIの有効化が成功してから次へ進みます。",
      },
      {
        title: "転送先と対象ログを指定する",
        explanation: "先にバケットを作り、そのバケットへERROR以上のログを送るシンクを定義します。",
        actions: [
          {
            kind: "command",
            text: "gcloud storage buckets create gs://ace-audit-logs --location=asia-northeast1",
          },
          {
            kind: "command",
            text: "gcloud logging sinks create audit-export storage.googleapis.com/ace-audit-logs --log-filter='severity>=ERROR'",
          },
        ],
        points: [
          {
            term: "シンク",
            description: "選んだログの転送先を指定する設定です。",
          },
          {
            term: "storage.googleapis.com/…",
            description: "Loggingシンクの転送先表記です。storage cpのgs://…とは形式が異なります。",
          },
        ],
        expected: "audit-exportの転送先がace-audit-logsになります。",
      },
      {
        title: "転送処理の主体を調べる",
        explanation: "次に付与する相手を、シンクの出力から読み取ります。",
        actions: [
          {
            kind: "command",
            text: "gcloud logging sinks describe audit-export --format='value(writerIdentity)'",
            capture: {
              name: "WRITER_IDENTITY",
              pattern: "(serviceAccount:[^\\s]+)",
            },
          },
        ],
        points: [
          {
            term: "writerIdentity",
            description:
              "このシンクが転送先へ書き込むときの主体です。操作中のownerへ権限を付けても代用できません。",
          },
        ],
        expected:
          "serviceAccount:で始まる値が表示されます。次の<WRITER_IDENTITY>へ、接頭辞を含む値全体を入れてください。",
      },
      {
        title: "書き込みだけを許可して確認する",
        explanation: "取得した主体へ、転送先バケットのオブジェクト作成権限を与えます。",
        actions: [
          {
            kind: "command",
            text: "gcloud storage buckets add-iam-policy-binding gs://ace-audit-logs --member=<WRITER_IDENTITY> --role=roles/storage.objectCreator",
          },
          {
            kind: "command",
            text: "gcloud storage buckets get-iam-policy gs://ace-audit-logs",
          },
        ],
        points: [
          {
            term: "roles/storage.objectCreator",
            description:
              "新しいオブジェクトの作成を許可します。既存データの削除なども許すAdminより範囲を絞ります。",
          },
          {
            term: "<WRITER_IDENTITY>",
            description: "前の出力を手動で置き換える箇所です。山括弧自体は入力しません。",
          },
        ],
        expected:
          "シンクのwriterIdentityにstorage.objectCreatorが付き、ミッションがクリアになります。",
      },
    ],
    takeaway:
      "シンクの設定と転送先へのIAM権限の両方が必要です。権限を付ける相手はシンクのwriterIdentityです。",
  },
} satisfies Readonly<Record<string, MissionGuide>>;
