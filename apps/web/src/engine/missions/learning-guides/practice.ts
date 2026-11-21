import type { MissionGuide } from "./model";

const vm = (zone: string, name: string) => `projects/ace-dev-01/zones/${zone}/instances/${name}`;

/** Qwiklabs 型の演習（practice-labs.ts）の学習手順。 */
export const PracticeGuides: Readonly<Record<string, MissionGuide>> = {
  "m-vpc-auto-to-custom": {
    introduction:
      "自動モードの VPC は各リージョンにサブネットを自動で作ります。手軽ですが範囲を選べないので、本番ではカスタムモードへ切り替えて必要なサブネットだけを残すのが定石です。",
    steps: [
      {
        title: "自動モードの VPC を作ってサブネットを確かめる",
        explanation:
          "--subnet-mode=auto で作ると、各リージョンに VPC と同じ名前のサブネットが 1 つずつできます。範囲は default ネットワークと同じ 10.128.0.0/9 の中の /20 です。",
        actions: [
          { kind: "command", text: "gcloud compute networks create autonet --subnet-mode=auto" },
          {
            kind: "command",
            text: 'gcloud compute networks subnets list --filter="network:autonet"',
          },
        ],
        points: [
          {
            term: "--subnet-mode=auto",
            description:
              "リージョンが増えると、そのリージョンにもサブネットが自動で追加されます。範囲は固定なので、default や他の自動モード VPC と重なります。",
          },
          {
            term: "10.128.0.0/20（us-central1）",
            description:
              "自動モードの範囲は全プロジェクトで同じです。重なる VPC どうしはピアリングできません。",
          },
        ],
        expected:
          "autonet が作られ、us-central1 の 10.128.0.0/20、europe-west1 の 10.132.0.0/20 などのサブネットが並びます。",
      },
      {
        title: "自動モードのままではサブネットを消せないことを確かめる",
        explanation:
          "自動で作られたサブネットは、自動モードのあいだは削除できません。不要なリージョンを外したいときはカスタムモードへ切り替えます。",
        actions: [
          {
            kind: "command",
            text: "gcloud compute networks subnets delete autonet --region=europe-west1 --quiet",
            expectFailure: true,
          },
        ],
        points: [
          {
            term: "自動作成のサブネット",
            description:
              "自動モードの VPC が持つサブネットは VPC が管理するので、個別には削除できません。",
          },
        ],
        expected: "Cannot delete an auto-created subnetwork のエラーになります。",
      },
      {
        title: "カスタムモードへ切り替えて不要なサブネットを消す",
        explanation:
          "切り替えは一方向で、カスタムからは自動へ戻せません。既存のサブネットはそのまま残るので、使わないものだけを消します。",
        actions: [
          {
            kind: "command",
            text: "gcloud compute networks update autonet --switch-to-custom-subnet-mode",
          },
          { kind: "command", text: "gcloud compute networks describe autonet" },
          {
            kind: "command",
            text: "gcloud compute networks subnets delete autonet --region=europe-west1 --quiet",
          },
        ],
        points: [
          {
            term: "--switch-to-custom-subnet-mode",
            description:
              "自動モードの VPC をカスタムモードにします。元に戻せません。以後、新しいリージョンにはサブネットが自動で作られません。",
          },
          {
            term: "autoCreateSubnetworks",
            description: "describe のこの値が false ならカスタムモードです。",
          },
        ],
        expected:
          "autoCreateSubnetworks が false になり、europe-west1 のサブネットが削除されます。us-central1 のサブネットは残ります。",
      },
    ],
    takeaway:
      "自動モードは手早く試すため、カスタムモードは範囲を設計するためのものです。自動→カスタムは一方向で、逆には戻せません。",
  },
  "m-vpc-connectivity": {
    introduction:
      "VPC はグローバルなリソースで、同じ VPC ならリージョンが違っても内部 IP で通信できます。一方、別の VPC の VM へは内部 IP のルートがありません。接続テストで両方を確かめます。",
    steps: [
      {
        title: "カスタムモードの VPC に 2 つのリージョンのサブネットを作る",
        explanation:
          "privatenet を作り、us-central1 と europe-west1 にサブネットを追加します。範囲は自由に選べます。",
        actions: [
          { kind: "command", text: "gcloud services enable networkmanagement.googleapis.com" },
          {
            kind: "command",
            text: "gcloud compute networks create privatenet --subnet-mode=custom",
          },
          {
            kind: "command",
            text: "gcloud compute networks subnets create privatesubnet-us --network=privatenet --region=us-central1 --range=172.16.0.0/24",
          },
          {
            kind: "command",
            text: "gcloud compute networks subnets create privatesubnet-eu --network=privatenet --region=europe-west1 --range=172.20.0.0/20",
          },
        ],
        points: [
          {
            term: "networkmanagement.googleapis.com",
            description: "接続テスト（Network Intelligence Center）が使う API です。",
          },
          {
            term: "--range",
            description:
              "カスタムモードではサブネットごとに範囲を指定します。VPC の中で重ならなければ、リージョンをまたいで自由に選べます。",
          },
        ],
        expected: "privatenet に privatesubnet-us と privatesubnet-eu ができます。",
      },
      {
        title: "ファイアウォールを開けて両方のリージョンに VM を置く",
        explanation:
          "新しい VPC には暗黙の「上りはすべて拒否」しかありません。ICMP・SSH・RDP を許可してから VM を作ります。",
        actions: [
          {
            kind: "command",
            text: "gcloud compute firewall-rules create privatenet-allow-icmp-ssh-rdp --network=privatenet --allow=icmp,tcp:22,tcp:3389 --source-ranges=0.0.0.0/0",
          },
          {
            kind: "command",
            text: "gcloud compute instances create privatenet-us-vm --zone=us-central1-c --network=privatenet --subnet=privatesubnet-us",
          },
          {
            kind: "command",
            text: "gcloud compute instances create privatenet-eu-vm --zone=europe-west1-c --network=privatenet --subnet=privatesubnet-eu",
          },
        ],
        points: [
          {
            term: "--network / --subnet",
            description:
              "VM をどの VPC のどのサブネットに置くかを決めます。サブネットはゾーンと同じリージョンのものを選びます。",
          },
          {
            term: "暗黙のルール",
            description:
              "どの VPC にも「上りはすべて拒否」「下りはすべて許可」の暗黙のルール（優先度 65535）があり、削除できません。",
          },
        ],
        expected: "2 台の VM がそれぞれのサブネットの内部 IP で作られます。",
      },
      {
        title: "同じ VPC の別リージョンへ届くことを確かめる",
        explanation:
          "接続テストは実際にパケットを送らず、ルートとファイアウォールの構成から到達性を判定します。",
        actions: [
          {
            kind: "command",
            text: `gcloud network-management connectivity-tests create privatenet-us-to-eu --source-instance=${vm("us-central1-c", "privatenet-us-vm")} --destination-instance=${vm("europe-west1-c", "privatenet-eu-vm")} --protocol=ICMP`,
          },
        ],
        points: [
          {
            term: "REACHABLE",
            description:
              "VPC のルートはグローバルなので、サブネットのリージョンが違っても内部 IP で届きます。",
          },
          {
            term: "--destination-instance",
            description: "宛先を VM で指定すると、その VM の内部 IP への到達性を調べます。",
          },
        ],
        expected: "reachabilityDetails.result が REACHABLE になります。",
      },
      {
        title: "別の VPC の VM には届かないことを確かめる",
        explanation:
          "default ネットワークの VM は別の VPC にいるので、privatenet からはその内部 IP へのルートがありません。",
        actions: [
          {
            kind: "command",
            text: `gcloud network-management connectivity-tests create privatenet-to-default --source-instance=${vm("us-central1-c", "privatenet-us-vm")} --destination-instance=${vm("us-central1-a", "default-us-vm")} --protocol=ICMP`,
          },
          {
            kind: "command",
            text: "gcloud network-management connectivity-tests describe privatenet-to-default",
          },
        ],
        points: [
          {
            term: "NO_ROUTE",
            description:
              "宛先の範囲へのルートが無いために落ちたことを表します。VPC 間を内部 IP でつなぐには VPC ネットワーク ピアリングか Cloud VPN を使います。",
          },
          {
            term: "外部 IP",
            description:
              "外部 IP どうしならインターネット経由で届きます（相手のファイアウォールが送信元を許していれば）。",
          },
        ],
        expected: "result が UNREACHABLE、drop の cause が NO_ROUTE になります。",
      },
    ],
    takeaway:
      "VPC はグローバル、サブネットはリージョン。同じ VPC の中は内部 IP で届き、別の VPC へはピアリングや VPN が無ければ届きません。",
  },
  "m-ssh-iap": {
    introduction:
      "外部 IP を持たない VM にも、IAP の TCP 転送を使えば SSH できます。必要なのは、IAP の送信元範囲を許すファイアウォールと、トンネルとログインの 2 つの権限です。",
    steps: [
      {
        title: "外部 IP の無い VM を作る",
        explanation:
          "専用の VPC とサブネットを作り、--no-address で外部 IP を付けずに VM を作ります。",
        actions: [
          { kind: "command", text: "gcloud compute networks create iap-net --subnet-mode=custom" },
          {
            kind: "command",
            text: "gcloud compute networks subnets create iap-subnet --network=iap-net --region=asia-northeast1 --range=10.30.0.0/24",
          },
          {
            kind: "command",
            text: "gcloud compute instances create iap-vm --zone=asia-northeast1-a --network=iap-net --subnet=iap-subnet --no-address",
          },
        ],
        points: [
          {
            term: "--no-address",
            description: "外部 IP を付けません。インターネットから直接は届かなくなります。",
          },
        ],
        expected: "iap-vm が内部 IP だけで作られます。",
      },
      {
        title: "そのままでは SSH できないことを確かめる",
        explanation:
          "外部 IP が無いので普通の SSH はタイムアウトします。IAP 経由でも、IAP からの接続を許すファイアウォールが無ければ失敗します。",
        actions: [
          {
            kind: "command",
            text: "gcloud compute ssh iap-vm --zone=asia-northeast1-a",
            expectFailure: true,
          },
          {
            kind: "command",
            text: "gcloud compute ssh iap-vm --zone=asia-northeast1-a --tunnel-through-iap",
            expectFailure: true,
          },
        ],
        points: [
          {
            term: "--tunnel-through-iap",
            description:
              "IAP の TCP 転送を使って接続します。外部 IP が無い VM で gcloud が自動で選ぶこともあります。",
          },
          {
            term: "4003: failed to connect to backend",
            description:
              "IAP は認可したが、VM まで届かなかった（ファイアウォールが無い）ことを表します。",
          },
        ],
        expected: "1 つ目はタイムアウト、2 つ目は 4003 のエラーになります。",
      },
      {
        title: "IAP の範囲だけに SSH を開けて権限を付ける",
        explanation:
          "IAP は 35.235.240.0/20 から VM へ接続します。この範囲から tcp:22 だけを許可すれば、0.0.0.0/0 を開けずに済みます。使う人にはトンネルの権限と OS Login の権限を付けます。",
        actions: [
          {
            kind: "command",
            text: "gcloud compute firewall-rules create iap-net-allow-iap-ssh --network=iap-net --allow=tcp:22 --source-ranges=35.235.240.0/20",
          },
          {
            kind: "command",
            text: "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:dev@example.com --role=roles/iap.tunnelResourceAccessor",
          },
          {
            kind: "command",
            text: "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:dev@example.com --role=roles/compute.osLogin",
          },
        ],
        points: [
          {
            term: "35.235.240.0/20",
            description:
              "IAP の TCP 転送が使う送信元の範囲です。ファイアウォールの送信元にはこれだけを入れます。",
          },
          {
            term: "roles/iap.tunnelResourceAccessor",
            description: "IAP-secured Tunnel User。無いと 4033（not authorized）になります。",
          },
          {
            term: "roles/compute.osLogin",
            description:
              "VM にログインする権限です。sudo も要るなら roles/compute.osAdminLogin を付けます。",
          },
        ],
        expected: "ルールが作られ、dev@example.com に 2 つのロールが付きます。",
      },
      {
        title: "dev として IAP 経由で SSH する",
        explanation: "操作する人を dev に切り替え、IAP 経由で接続できることを確かめます。",
        actions: [
          { kind: "command", text: "gcloud config set account dev@example.com" },
          {
            kind: "command",
            text: "gcloud compute ssh iap-vm --zone=asia-northeast1-a --tunnel-through-iap",
          },
        ],
        points: [
          {
            term: "gcloud config set account",
            description: "以降のコマンドを実行するアカウントを切り替えます。",
          },
        ],
        expected: "Connecting to 10.30.0.x と表示され、接続の前提を満たします。",
      },
    ],
    takeaway:
      "外部 IP の無い VM へは IAP の TCP 転送で入ります。ファイアウォールは 35.235.240.0/20 から、権限は IAP-secured Tunnel User と OS Login の 2 つです。",
  },
  "m-logging-audit": {
    introduction:
      "管理アクティビティの監査ログには、誰が・いつ・何に・どの操作をしたかが残ります。gcloud logging read のフィルタで必要なエントリだけに絞り込みます。",
    steps: [
      {
        title: "停止の操作だけを絞り込む",
        explanation:
          "methodName に stop を含むエントリだけを読み、どの VM を誰が止めたかを一覧します。",
        actions: [
          {
            kind: "command",
            text: `gcloud logging read 'protoPayload.methodName:"instances.stop"' --freshness=1d`,
          },
        ],
        points: [
          {
            term: "protoPayload.methodName",
            description: "API の操作名です。VM の停止は v1.compute.instances.stop です。",
          },
          {
            term: "--freshness",
            description: "どれだけ前までのログを読むか。既定は 1d（1 日）です。",
          },
          {
            term: ":（コロン）",
            description: "部分一致です。= なら完全一致になります。",
          },
        ],
        expected:
          "batch-vm を止めた ops-lead@example.com と、api-server を止めた contractor@example.com のエントリが出ます。",
      },
      {
        title: "api-server のエントリを詳しく見る",
        explanation: "対象の VM と操作の両方で絞り、1 件だけを JSON で表示して中身を確かめます。",
        actions: [
          {
            kind: "command",
            text: `gcloud logging read 'protoPayload.resourceName:"instances/api-server" AND protoPayload.methodName:"stop"' --limit=1 --format=json`,
          },
        ],
        points: [
          {
            term: "authenticationInfo.principalEmail",
            description: "操作した人（またはサービスアカウント）です。",
          },
          {
            term: "AND",
            description: "条件をすべて満たすエントリに絞ります。OR・NOT・括弧も使えます。",
          },
        ],
        expected: "principalEmail が contractor@example.com のエントリが 1 件出ます。",
      },
      {
        title: "VM を戻して、止めた人のロールを外す",
        explanation:
          "api-server を起動し直し、ポリシーを確かめてから contractor@example.com のロールだけを外します。運用チームのグループのロールは残します。",
        actions: [
          {
            kind: "command",
            text: "gcloud compute instances start api-server --zone=asia-northeast1-a",
          },
          { kind: "command", text: "gcloud projects get-iam-policy ace-dev-01" },
          {
            kind: "command",
            text: "gcloud projects remove-iam-policy-binding ace-dev-01 --member=user:contractor@example.com --role=roles/compute.instanceAdmin.v1",
          },
        ],
        points: [
          {
            term: "remove-iam-policy-binding",
            description:
              "メンバーとロールの組を 1 つだけ外します。同じロールの他のメンバーは残ります。",
          },
          {
            term: "roles/compute.instanceAdmin.v1",
            description: "VM の作成・削除・起動・停止ができるロールです。",
          },
        ],
        expected:
          "api-server が RUNNING に戻り、contractor@example.com だけがポリシーから外れます。",
      },
    ],
    takeaway:
      "「誰がやったか」は監査ログの principalEmail で分かります。methodName と resourceName で絞り込み、--limit と --format で詳細を確かめます。",
  },
  "m-bq-dry-run": {
    introduction:
      "Cloud Storage の CSV を BigQuery に読み込み、クエリを実行する前にドライランで処理バイト数（オンデマンド料金の元）を見積もります。",
    steps: [
      {
        title: "データセットとテーブルを作る",
        explanation:
          "CSV と同じロケーション（US）にデータセットを作り、列の名前と型を決めたテーブルを用意します。",
        actions: [
          { kind: "command", text: "gcloud services enable bigquery.googleapis.com" },
          { kind: "command", text: "gcloud storage ls gs://ace-dev-01-sales-raw/sales/" },
          { kind: "command", text: "bq mk sales --dataset --location=US" },
          {
            kind: "command",
            text: "bq mk sales.orders --table --location=US --schema=region:STRING,product:STRING,amount:INT64,note:STRING",
          },
        ],
        points: [
          {
            term: "--location=US",
            description:
              "データセットのロケーションは作成後に変えられません。読み込むバケットと合わせます。",
          },
          {
            term: "--schema",
            description: "列名:型 をカンマで並べます。",
          },
        ],
        expected: "sales データセットに空の orders テーブルができます。",
      },
      {
        title: "Cloud Storage の CSV を読み込む",
        explanation: "bq load は読み込みジョブを作り、CSV の行をテーブルに追加します。",
        actions: [
          {
            kind: "command",
            text: "bq load sales.orders gs://ace-dev-01-sales-raw/sales/2026-11.csv --location=US --source_format=CSV --skip_leading_rows=1",
          },
        ],
        points: [
          {
            term: "--skip_leading_rows=1",
            description: "1 行目の見出しを飛ばします。",
          },
          {
            term: "--source_format",
            description: "CSV のほか、NEWLINE_DELIMITED_JSON・AVRO・PARQUET などを読めます。",
          },
        ],
        expected: "6 行が読み込まれます。",
      },
      {
        title: "ドライランで処理バイト数を比べる",
        explanation:
          "--dry_run はクエリを実行せず、処理するバイト数の上限だけを返します。BigQuery は列指向なので、読む列を絞るとバイト数が減ります。",
        actions: [
          {
            kind: "command",
            text: 'bq query "SELECT * FROM sales.orders" --location=US --use_legacy_sql=false --dry_run',
          },
          {
            kind: "command",
            text: 'bq query "SELECT region, SUM(amount) AS total FROM sales.orders GROUP BY region" --location=US --use_legacy_sql=false --dry_run',
          },
        ],
        points: [
          {
            term: "--dry_run",
            description:
              "料金はかかりません。オンデマンド料金は処理バイト数で決まるので、実行前の見積もりに使います。",
          },
          {
            term: "SELECT *",
            description: "すべての列を読みます。LIMIT を付けても読むバイト数は減りません。",
          },
        ],
        expected: "2 つ目（region と amount だけ）のほうが少ないバイト数になります。",
      },
      {
        title: "クエリを実行してジョブを確かめる",
        explanation:
          "クエリもジョブとして実行されます。ジョブの一覧と状態を bq のジョブ系のコマンドで確かめます。",
        actions: [
          {
            kind: "command",
            text: 'bq query "SELECT region, SUM(amount) AS total FROM sales.orders GROUP BY region" --location=US --use_legacy_sql=false',
            capture: { name: "JOB", pattern: "job: (bq-job-\\d+)" },
          },
          { kind: "command", text: "bq ls -j --location=US" },
          { kind: "command", text: "bq show -j <JOB> --location=US" },
        ],
        points: [
          {
            term: "bq ls -j",
            description: "ジョブ（読み込み・クエリ・抽出）の一覧です。",
          },
          {
            term: "bq show -j",
            description:
              "ジョブ 1 件の状態（DONE / FAILED）と詳細です。Dataflow なら gcloud dataflow jobs list / describe を使います。",
          },
        ],
        expected: "地域ごとの合計が返り、クエリのジョブの state が DONE になっています。",
      },
    ],
    takeaway:
      "読み込みは bq load、費用の見積もりは --dry_run、ジョブの確認は bq ls -j / bq show -j。列を絞ると処理バイト数（費用）が減ります。",
  },
};
