import { CommonSteps } from "./common";
import type { MissionGuide } from "./model";

export const BasicsGuides = {
  "m-setup-002": {
    introduction:
      "普段の開発用設定を上書きせず、本番用の接続先とゾーンを別のconfigurationとして保存します。",
    steps: [
      {
        title: "本番用の設定を作成する",
        explanation:
          "まずprodという設定の入れ物を作ります。作成した設定がそのまま操作中の設定になります。",
        actions: [
          {
            kind: "command",
            text: "gcloud config configurations create prod",
          },
        ],
        points: [
          {
            term: "config configurations create",
            description:
              "名前付きの設定を作り、自動的にアクティブにします。クラウド上のプロジェクトを新規作成する操作ではありません。",
          },
        ],
        expected: "prodの作成が成功します。以降のconfig setはprodへ保存されます。",
      },
      {
        title: "プロジェクトとゾーンを設定する",
        explanation: "次に、本番で使うプロジェクトとVMの既定の配置先を指定します。",
        actions: [
          {
            kind: "command",
            text: "gcloud config set project ace-prod-01",
          },
          {
            kind: "command",
            text: "gcloud config set compute/zone asia-northeast1-a",
          },
        ],
        points: [
          {
            term: "project",
            description: "以降のgcloudコマンドの対象となるプロジェクトIDです。",
          },
          {
            term: "compute/zone",
            description:
              "VMなどのゾーン単位のリソースで使う既定値です。コマンドに--zoneを書くと、そちらが優先されます。",
          },
        ],
        expected: "prodにace-prod-01とasia-northeast1-aが保存されます。",
      },
      {
        title: "保存された設定を確認する",
        explanation: "設定したつもりで別環境を操作しないように、現在の設定を読み返します。",
        actions: [
          {
            kind: "command",
            text: "gcloud config configurations list",
          },
          {
            kind: "command",
            text: "gcloud config list",
          },
        ],
        points: [
          {
            term: "IS_ACTIVE",
            description: "configurationの一覧で、現在選ばれている設定を表します。",
          },
          {
            term: "core/projectとcompute/zone",
            description:
              "config listのセクションごとに値が表示されます。名前と値を両方照合します。",
          },
        ],
        expected:
          "prodがアクティブで、coreのprojectがace-prod-01、computeのzoneがasia-northeast1-aになっています。",
      },
    ],
    takeaway:
      "configurationを切り替えると、プロジェクトやゾーンなどの既定値をまとめて切り替えられます。",
  },
  "m-setup-001": {
    introduction:
      "VMを作る前に、利用料金の請求先とCompute Engine APIを整えます。請求先の紐付けとサービスの有効化は別々に行います。",
    steps: [
      {
        title: "利用できる請求アカウントを調べる",
        explanation:
          "先に請求先のIDを確認します。この演習では表示された01AB2C-DEF345-6789ABを使います。",
        actions: [
          {
            kind: "command",
            text: "gcloud billing accounts list",
          },
        ],
        points: [
          {
            term: "billing accounts list",
            description:
              "操作中のアカウントから見える請求アカウントを一覧にします。表示名と、操作に使うIDを区別します。",
          },
        ],
        expected: "一覧に01AB2C-DEF345-6789ABが表示されます。",
      },
      {
        title: "本番プロジェクトへ請求先を紐付ける",
        explanation: "確認した請求アカウントをace-prod-01へリンクします。",
        actions: [
          {
            kind: "command",
            text: "gcloud billing projects link ace-prod-01 --billing-account=01AB2C-DEF345-6789AB",
          },
        ],
        points: [
          {
            term: "--billing-account",
            description:
              "料金の請求先となるアカウントIDです。コマンド先頭のace-prod-01は課金を有効にするプロジェクトです。",
          },
        ],
        expected: "ace-prod-01の課金リンクが設定されます。",
      },
      {
        title: "Compute Engine APIを有効化する",
        explanation: "課金の準備ができたので、VMを扱うAPIを有効にします。",
        actions: [
          {
            kind: "command",
            text: "gcloud services enable compute.googleapis.com --project=ace-prod-01",
          },
          {
            kind: "command",
            text: "gcloud services list --enabled --project=ace-prod-01",
          },
        ],
        points: [
          {
            term: "compute.googleapis.com",
            description: "Compute EngineのAPI名です。画面上のサービス名とは表記が異なります。",
          },
          {
            term: "--project",
            description:
              "対象を明示します。現在の既定プロジェクトが開発用でも、本番側を変更できます。",
          },
        ],
        expected:
          "有効なサービスの一覧にcompute.googleapis.comがあり、ミッションがクリアになります。",
      },
    ],
    takeaway:
      "プロジェクトが存在するだけではVMを使えません。課金リンクとAPIの両方が利用条件になります。",
  },
  "m-plan-001": {
    introduction:
      "VPCというネットワークの枠を先に作り、その中にリージョンとIP範囲を持つサブネットを作ります。",
    steps: [
      CommonSteps.prepareCompute,
      {
        title: "自動作成しないVPCを作る",
        explanation:
          "必要な範囲だけを自分で設計するため、サブネットが自動で増えないcustomモードを選びます。",
        actions: [
          {
            kind: "command",
            text: "gcloud compute networks create vpc-app --subnet-mode=custom",
          },
        ],
        points: [
          {
            term: "--subnet-mode=custom",
            description:
              "VPC作成時に各リージョンのサブネットを自動作成しません。次の手順で必要なサブネットを追加します。",
          },
        ],
        expected: "vpc-appが作成されます。この時点ではapp-subnetはありません。",
      },
      {
        title: "東京のIP範囲を追加して確認する",
        explanation: "VPCへ所属先を指定し、東京リージョンのVMへ配るIP範囲を定義します。",
        actions: [
          {
            kind: "command",
            text: "gcloud compute networks subnets create app-subnet --network=vpc-app --region=asia-northeast1 --range=10.10.0.0/24",
          },
          {
            kind: "command",
            text: "gcloud compute networks subnets describe app-subnet --region=asia-northeast1",
          },
        ],
        points: [
          {
            term: "--network",
            description: "サブネットを所属させるVPC名です。",
          },
          {
            term: "--range=10.10.0.0/24",
            description:
              "CIDR形式のIP範囲です。/24は先頭24ビットがネットワーク部分であることを表します。",
          },
          {
            term: "--region",
            description: "サブネットの配置リージョンです。VPC自体は特定のゾーンに属しません。",
          },
        ],
        expected:
          "networkがvpc-app、ipCidrRangeが10.10.0.0/24、regionがasia-northeast1になっています。",
      },
    ],
    takeaway:
      "VPCは全体の接続単位、サブネットはリージョンごとのIP範囲です。親子の作成順序を押さえます。",
  },
  "m-plan-002": {
    introduction:
      "バッチ処理を人のアカウントで動かさず、処理専用のサービスアカウントにStorageの操作権限を付けます。",
    steps: [
      CommonSteps.prepareIam,
      {
        title: "処理専用のアカウントを作る",
        explanation:
          "まず実行主体だけを作成します。作成しただけではStorageの管理権限は付きません。",
        actions: [
          {
            kind: "command",
            text: 'gcloud iam service-accounts create batch-sa --display-name="Batch SA"',
          },
        ],
        points: [
          {
            term: "サービスアカウント",
            description: "アプリやVMなど、人以外の処理を識別するためのアカウントです。",
          },
          {
            term: "--display-name",
            description:
              "人が見分けるための表示名です。IAMの指定にはメール形式の識別子を使います。",
          },
        ],
        expected: "batch-saのメールアドレスが表示されます。",
      },
      {
        title: "オブジェクトを管理する権限を付ける",
        explanation:
          "作った主体へ、プロジェクト内のStorageオブジェクトを管理するロールを付与します。",
        actions: [
          {
            kind: "command",
            text: "gcloud projects add-iam-policy-binding ace-dev-01 --member=serviceAccount:batch-sa@ace-dev-01.iam.gserviceaccount.com --role=roles/storage.objectAdmin",
          },
          {
            kind: "command",
            text: "gcloud projects get-iam-policy ace-dev-01",
          },
        ],
        points: [
          {
            term: "--member=serviceAccount:…",
            description:
              "serviceAccount:という種別とメールアドレスを組み合わせて、権限を受ける主体を指定します。",
          },
          {
            term: "roles/storage.objectAdmin",
            description:
              "オブジェクトの作成・閲覧・削除などを許可します。プロジェクトのOwnerを付ける演習ではありません。",
          },
        ],
        expected: "IAMポリシーのstorage.objectAdminにbatch-saのメンバーが含まれています。",
      },
    ],
    takeaway: "サービスアカウントの作成と、そのアカウントに何を許可するかというIAM設定は別々です。",
  },
  "m-deploy-001": {
    introduction:
      "HTTPで公開するVMへタグを付け、そのタグを目印にファイアウォールで80番ポートを許可します。",
    steps: [
      CommonSteps.prepareCompute,
      {
        title: "HTTP公開用の目印を付けてVMを作る",
        explanation:
          "まずVMを用意し、次のファイアウォールルールが対象を選べるようにタグを付けます。",
        actions: [
          {
            kind: "command",
            text: "gcloud compute instances create web-1 --zone=asia-northeast1-a --machine-type=e2-small --tags=http-server",
          },
        ],
        points: [
          {
            term: "--machine-type=e2-small",
            description: "VMのCPU・メモリの構成を選びます。",
          },
          {
            term: "--tags=http-server",
            description:
              "ネットワークタグです。IAMの権限やラベルではなく、ファイアウォールの対象選択に使います。",
          },
        ],
        expected: "web-1がRUNNINGになり、tagsにhttp-serverが入ります。",
      },
      {
        title: "タグが一致するVMへHTTPを許可する",
        explanation: "VMを所属させたdefaultネットワークに、HTTPの受信ルールを追加します。",
        actions: [
          {
            kind: "command",
            text: "gcloud compute firewall-rules create allow-http --network=default --allow=tcp:80 --target-tags=http-server",
          },
          {
            kind: "command",
            text: "gcloud compute firewall-rules describe allow-http",
          },
          {
            kind: "command",
            text: "gcloud compute instances describe web-1 --zone=asia-northeast1-a",
          },
        ],
        points: [
          {
            term: "--allow=tcp:80",
            description:
              "TCPの80番ポートを許可します。サーバー側のアプリを起動する指定ではありません。",
          },
          {
            term: "--target-tags",
            description:
              "このタグを持つVMだけがルールの対象です。VM側と同じhttp-serverを指定します。",
          },
        ],
        expected:
          "allow-httpの対象タグとweb-1のタグが一致し、許可ポートがtcp:80です。実際のWebサーバー通信はこの演習では行いません。",
      },
    ],
    takeaway: "VMのタグとファイアウォールのtarget-tagsが一致して、通信を許可する対象が決まります。",
  },
  "m-deploy-002": {
    introduction:
      "ログの保存先バケットを東京リージョンに作り、新しいオブジェクトの既定ストレージクラスをNEARLINEにします。",
    steps: [
      CommonSteps.prepareStorage,
      {
        title: "ログ用バケットの場所と既定クラスを指定する",
        explanation: "東京で保存し、頻繁には読まないログを想定してNEARLINEを選びます。",
        actions: [
          {
            kind: "command",
            text: "gcloud storage buckets create gs://ace-dev-01-logs --location=asia-northeast1 --default-storage-class=NEARLINE",
          },
        ],
        points: [
          {
            term: "gs://",
            description: "Cloud Storageのバケットやオブジェクトを指定するURIです。",
          },
          {
            term: "--location",
            description: "保存先リージョンです。",
          },
          {
            term: "--default-storage-class",
            description:
              "個別に指定しないで保存する新しいオブジェクトの既定クラスです。NEARLINEは低頻度アクセス向けです。",
          },
        ],
        expected: "バケット作成が成功します。",
      },
      {
        title: "作成結果の2つの設定を読み返す",
        explanation: "名前だけで判断せず、場所と既定クラスを確認します。",
        actions: [
          {
            kind: "command",
            text: "gcloud storage buckets describe gs://ace-dev-01-logs",
          },
        ],
        points: [
          {
            term: "describe",
            description:
              "対象の詳細設定を表示する読み取り操作です。作成時に渡したフラグがどの項目に反映されたかを追います。",
          },
        ],
        expected: "locationがASIA-NORTHEAST1、storageClassがNEARLINEです。",
      },
    ],
    takeaway:
      "バケットの配置場所とストレージクラスは異なる設定です。用途とアクセス頻度を分けて考えます。",
  },
  "m-deploy-003": {
    introduction:
      "Kubernetes Engine APIを有効化し、ノード管理をGKEに任せるAutopilotクラスタを作ります。",
    steps: [
      CommonSteps.prepareContainer,
      {
        title: "Autopilotクラスタを作成する",
        explanation: "アプリを配置するKubernetesの実行環境を用意します。",
        actions: [
          {
            kind: "command",
            text: "gcloud container clusters create-auto app-cluster --region=asia-northeast1",
          },
        ],
        points: [
          {
            term: "クラスタ",
            description: "コンテナ化したアプリを実行・管理するKubernetesの環境です。",
          },
          {
            term: "create-auto",
            description: "ノードの構成や運用をGKEへ任せるAutopilotモードで作成します。",
          },
          {
            term: "--region",
            description: "リージョンを配置先として指定します。",
          },
        ],
        expected: "app-clusterが作成されます。",
      },
      {
        title: "モードと場所を確認する",
        explanation: "Standardクラスタや別リージョンに作っていないか確認します。",
        actions: [
          {
            kind: "command",
            text: "gcloud container clusters describe app-cluster --region=asia-northeast1",
          },
        ],
        points: [
          {
            term: "autopilot",
            description:
              "Autopilotが有効かどうかを表す設定です。名前にautoを付けるだけではモードは変わりません。",
          },
        ],
        expected: "Autopilotが有効で、配置先がasia-northeast1です。",
      },
    ],
    takeaway:
      "create-autoはAutopilotの作成です。リージョンを指定し、クラスタのモードを出力で確認します。",
  },
  "m-ops-001": {
    introduction:
      "まず対象VMを停止し、そのブートディスクからスナップショットを取ります。VM名、ディスク名、ゾーンを照合して進めます。",
    steps: [
      {
        title: "対象VMを停止する",
        explanation:
          "この演習ではデータを書き換える処理が動かない状態でコピーを取る流れを練習します。",
        actions: [
          {
            kind: "command",
            text: "gcloud compute instances stop batch-1 --zone=asia-northeast1-b",
          },
          {
            kind: "command",
            text: "gcloud compute instances describe batch-1 --zone=asia-northeast1-b",
          },
        ],
        points: [
          {
            term: "stop",
            description: "VMの実行を止めます。VMやディスクを削除する操作ではありません。",
          },
          {
            term: "TERMINATED",
            description:
              "Compute Engineの停止済みVMを表す状態名です。削除済みという意味ではありません。",
          },
        ],
        expected: "batch-1のstatusがTERMINATEDです。",
      },
      {
        title: "ブートディスクのコピーを作る",
        explanation: "停止を確認できたら、batch-1ディスクから復元用のスナップショットを作ります。",
        actions: [
          {
            kind: "command",
            text: "gcloud compute snapshots create batch-1-snap --source-disk=batch-1 --source-disk-zone=asia-northeast1-b",
          },
          {
            kind: "command",
            text: "gcloud compute snapshots describe batch-1-snap",
          },
        ],
        points: [
          {
            term: "--source-disk",
            description:
              "コピー元のディスク名です。この演習ではVM名と同じですが、VMの名前を指定するフラグではありません。",
          },
          {
            term: "--source-disk-zone",
            description: "同名ディスクを取り違えないように、コピー元ディスクのゾーンを指定します。",
          },
        ],
        expected: "batch-1-snapがあり、sourceDiskがasia-northeast1-bのbatch-1を指しています。",
      },
    ],
    takeaway: "VMを停止する操作と、復元用のディスクコピーを作成する操作を区別します。",
  },
  "m-ops-002": {
    introduction:
      "コンテナイメージをCloud Runへデプロイし、未認証の利用者も呼べるサービスにします。",
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
            text: "gcloud services enable run.googleapis.com",
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
        title: "Cloud Runサービスをデプロイする",
        explanation:
          "APIの準備後に実行環境を作り、使うソフトウェアと公開・配置の条件を指定します。",
        actions: [
          {
            kind: "command",
            text: "gcloud run deploy hello --image=gcr.io/cloudrun/hello --region=asia-northeast1 --allow-unauthenticated",
          },
        ],
        points: [
          {
            term: "--image",
            description: "実行するコンテナイメージです。ここでは教材のhelloイメージを使います。",
          },
          {
            term: "--allow-unauthenticated",
            description:
              "ログインしていない呼び出しも許可して公開します。サービス作成とは別に、呼び出せる主体を決める指定です。",
          },
        ],
        expected: "作成が成功したら、次の手順で詳細を確認します。",
      },
      {
        title: "作成結果を確認する",
        explanation: "コマンドが成功しただけで終わらず、ミッションの指定値と詳細出力を照合します。",
        actions: [
          {
            kind: "command",
            text: "gcloud run services describe hello --region=asia-northeast1",
          },
        ],
        points: [
          {
            term: "describe",
            description: "作成したリソースを読み取り、目的の設定が保存されているか確認します。",
          },
        ],
        expected: "helloのURLが表示され、未認証の呼び出しが許可されています。",
      },
    ],
    takeaway: "デプロイするイメージ、配置リージョン、呼び出し権限を分けて確認します。",
  },
  "m-deploy-005": {
    introduction: "関数を呼び出すきっかけをHTTPにし、Pythonの実行環境と公開設定を指定します。",
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
            text: "gcloud services enable cloudfunctions.googleapis.com",
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
        title: "HTTPトリガーの関数をデプロイする",
        explanation:
          "APIの準備後に実行環境を作り、使うソフトウェアと公開・配置の条件を指定します。",
        actions: [
          {
            kind: "command",
            text: "gcloud functions deploy hello --runtime=python312 --trigger-http --allow-unauthenticated --region=asia-northeast1",
          },
        ],
        points: [
          {
            term: "--runtime=python312",
            description: "関数コードを実行するPython 3.12環境を選びます。",
          },
          {
            term: "--trigger-http",
            description: "HTTPリクエストをきっかけに関数を呼び出します。",
          },
          {
            term: "--allow-unauthenticated",
            description:
              "認証なしの呼び出しを許可します。教材では実コードの実行や通信は行いません。",
          },
        ],
        expected: "作成が成功したら、次の手順で詳細を確認します。",
      },
      {
        title: "作成結果を確認する",
        explanation: "コマンドが成功しただけで終わらず、ミッションの指定値と詳細出力を照合します。",
        actions: [
          {
            kind: "command",
            text: "gcloud functions describe hello --region=asia-northeast1",
          },
        ],
        points: [
          {
            term: "describe",
            description: "作成したリソースを読み取り、目的の設定が保存されているか確認します。",
          },
        ],
        expected: "runtimeがpython312で、HTTPトリガーと未認証許可が設定されています。",
      },
    ],
    takeaway: "ランタイムは実行環境、トリガーは起動条件、IAMは呼び出し主体を決めます。",
  },
  "m-deploy-006": {
    introduction:
      "DBエンジンと配置リージョンを選び、Cloud SQLの管理されたインスタンスを作成します。",
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
            text: "gcloud services enable sqladmin.googleapis.com",
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
        title: "MySQLの管理されたインスタンスを作る",
        explanation:
          "APIの準備後に実行環境を作り、使うソフトウェアと公開・配置の条件を指定します。",
        actions: [
          {
            kind: "command",
            text: "gcloud sql instances create app-db --database-version=MYSQL_8_0 --region=asia-northeast1",
          },
        ],
        points: [
          {
            term: "--database-version=MYSQL_8_0",
            description: "MySQL 8.0を選びます。インスタンス名だけではDBエンジンは決まりません。",
          },
          {
            term: "--region",
            description: "Cloud SQLインスタンスの配置リージョンです。",
          },
        ],
        expected: "作成が成功したら、次の手順で詳細を確認します。",
      },
      {
        title: "作成結果を確認する",
        explanation: "コマンドが成功しただけで終わらず、ミッションの指定値と詳細出力を照合します。",
        actions: [
          {
            kind: "command",
            text: "gcloud sql instances describe app-db",
          },
        ],
        points: [
          {
            term: "describe",
            description: "作成したリソースを読み取り、目的の設定が保存されているか確認します。",
          },
        ],
        expected: "app-dbのdatabaseVersionがMYSQL_8_0、regionがasia-northeast1です。",
      },
    ],
    takeaway: "DBインスタンスの作成は、テーブル作成やデータ投入とは別の段階です。",
  },
  "m-iam-001": {
    introduction:
      "権限不足を体験した後、フォルダへ必要なロールだけを付け、子プロジェクトへ継承されることを確認します。",
    steps: [
      {
        title: "開発者の権限不足を確認する",
        explanation:
          "最初はdevとしてVM作成を試し、権限がない状態を観察します。失敗はこの手順の想定どおりです。",
        actions: [
          {
            kind: "command",
            text: "gcloud config set account dev@example.com",
          },
          {
            kind: "command",
            text: "gcloud compute instances create web-2 --zone=asia-northeast1-a",
            expectFailure: true,
          },
        ],
        points: [
          {
            term: "config set account",
            description: "操作する主体を切り替えます。対象プロジェクトは変わりません。",
          },
          {
            term: "PERMISSION_DENIED",
            description: "対象操作に必要な権限が足りないことを示します。VMは作成されません。",
          },
        ],
        expected: "権限不足のエラーになります。ここではOwnerやEditorを付けて解消しません。",
      },
      {
        title: "所有者からフォルダへ必要なロールを付ける",
        explanation:
          "権限を変更できるownerへ戻り、devフォルダの配下でVMを管理できるロールを付けます。",
        actions: [
          {
            kind: "command",
            text: "gcloud config set account owner@example.com",
          },
          {
            kind: "command",
            text: "gcloud resource-manager folders add-iam-policy-binding 284100000001 --member=user:dev@example.com --role=roles/compute.instanceAdmin.v1",
          },
        ],
        points: [
          {
            term: "folders add-iam-policy-binding",
            description:
              "フォルダを範囲としてIAMの付与を追加します。子プロジェクトもこの権限を継承します。",
          },
          {
            term: "roles/compute.instanceAdmin.v1",
            description:
              "Compute EngineのVM管理に必要な権限を含む事前定義ロールです。プロジェクト全体の管理者ロールではありません。",
          },
        ],
        expected: "フォルダのポリシーへdevの付与が追加されます。",
      },
      {
        title: "同じ開発者で再実行する",
        explanation: "権限が効く主体へ戻り、最初に失敗した操作をもう一度行います。",
        actions: [
          {
            kind: "command",
            text: "gcloud config set account dev@example.com",
          },
          {
            kind: "command",
            text: "gcloud compute instances create web-2 --zone=asia-northeast1-a",
          },
          {
            kind: "command",
            text: "gcloud compute instances describe web-2 --zone=asia-northeast1-a",
          },
        ],
        points: [
          {
            term: "再実行する理由",
            description:
              "ownerで成功させるだけではdevの権限を確認できません。同じ主体・同じ操作で結果を比べます。",
          },
        ],
        expected: "devとしてweb-2を作成でき、VMがRUNNINGになります。",
      },
    ],
    takeaway:
      "IAMでは「誰に」「どの範囲で」「何を許可するか」を分けます。上位フォルダへの付与は子プロジェクトへ継承されます。",
  },
  "m-iam-002": {
    introduction: "複数プロジェクトへ個別に付与せず、運用グループへ組織全体の閲覧権限を付けます。",
    steps: [
      {
        title: "組織IDを確認する",
        explanation: "付与先の組織を取り違えないように、名前とIDを一覧で確認します。",
        actions: [
          {
            kind: "command",
            text: "gcloud organizations list",
          },
        ],
        points: [
          {
            term: "組織",
            description: "フォルダやプロジェクトをまとめる階層の最上位の管理単位です。",
          },
        ],
        expected: "組織ID123456789012が表示されます。",
      },
      {
        title: "運用グループへ閲覧を許可する",
        explanation: "対象範囲を組織にし、運用担当者のグループへviewerを付けます。",
        actions: [
          {
            kind: "command",
            text: "gcloud organizations add-iam-policy-binding 123456789012 --member=group:ops@example.com --role=roles/viewer",
          },
          {
            kind: "command",
            text: "gcloud organizations get-iam-policy 123456789012",
          },
        ],
        points: [
          {
            term: "--member=group:…",
            description: "個人ではなくグループを権限の受け手にします。",
          },
          {
            term: "roles/viewer",
            description:
              "リソースの閲覧を中心に許可する事前定義ロールです。変更権限を与えるEditorとは異なります。",
          },
        ],
        expected: "組織ポリシーのviewerにgroup:ops@example.comが含まれます。",
      },
    ],
    takeaway:
      "組織に付けたロールは配下へ継承されます。メンバーの種別group:と付与範囲を確認します。",
  },
  "m-setup-003": {
    introduction:
      "請求アカウントを対象に、月額の予算を作成します。予算設定とリソースの利用停止は別です。",
    steps: [
      {
        title: "請求先と予算額を指定する",
        explanation: "プロジェクトではなく請求アカウントを範囲にし、100000円の予算を作ります。",
        actions: [
          {
            kind: "command",
            text: "gcloud billing budgets create --billing-account=01AB2C-DEF345-6789AB --display-name=monthly --budget-amount=100000JPY",
          },
        ],
        points: [
          {
            term: "--billing-account",
            description: "予算の対象となる請求アカウントです。",
          },
          {
            term: "--budget-amount=100000JPY",
            description: "数値と通貨を合わせて指定します。この演習では月額10万円です。",
          },
          {
            term: "--display-name",
            description: "人が一覧で見分けるための表示名です。",
          },
        ],
        expected: "monthlyという予算が作成されます。",
      },
      {
        title: "通貨と金額を確認する",
        explanation: "桁や通貨の取り違えがないか、一覧で確認します。",
        actions: [
          {
            kind: "command",
            text: "gcloud billing budgets list --billing-account=01AB2C-DEF345-6789AB",
          },
        ],
        points: [
          {
            term: "budgets list",
            description: "指定した請求アカウントに属する予算を表示します。",
          },
        ],
        expected: "monthlyの予算額が100000 JPYです。",
      },
    ],
    takeaway:
      "予算は支出を把握する設定です。金額に達したときのリソース自動停止を指示するコマンドではありません。",
  },
  "m-plan-003": {
    introduction:
      "メッセージの送信先となるトピックを作り、受信者が取り出すためのサブスクリプションを接続します。",
    steps: [
      CommonSteps.preparePubsub,
      {
        title: "注文の送信先トピックを作る",
        explanation: "先に配送元を作成します。後で作る購読はこのトピックを参照します。",
        actions: [
          {
            kind: "command",
            text: "gcloud pubsub topics create orders",
          },
        ],
        points: [
          {
            term: "トピック",
            description: "送信者がメッセージをpublishする名前付きの送信先です。",
          },
        ],
        expected: "ordersトピックが作成されます。",
      },
      {
        title: "注文処理用の購読を接続する",
        explanation: "workerがpullで受信できるサブスクリプションを作成します。",
        actions: [
          {
            kind: "command",
            text: "gcloud pubsub subscriptions create orders-worker --topic=orders",
          },
          {
            kind: "command",
            text: "gcloud pubsub subscriptions describe orders-worker",
          },
        ],
        points: [
          {
            term: "--topic=orders",
            description:
              "購読元のトピックを指定します。トピックとサブスクリプションは異なるリソースです。",
          },
          {
            term: "pullサブスクリプション",
            description: "受信側から取り出しを要求する方式です。",
          },
        ],
        expected: "orders-workerのtopicがordersを指します。",
      },
    ],
    takeaway: "トピックは配送元、サブスクリプションは受信と未確認メッセージの管理単位です。",
  },
  "m-deploy-004": {
    introduction:
      "クラスタを用意し、kubectlの接続先を選んでからアプリを配置します。最後に複製数と公開用Serviceを設定します。",
    steps: [
      CommonSteps.prepareContainer,
      {
        title: "クラスタを作りkubectlの接続先を取得する",
        explanation: "アプリを配置するStandardクラスタを用意し、その認証情報を選びます。",
        actions: [
          {
            kind: "command",
            text: "gcloud container clusters create app --zone=asia-northeast1-a",
          },
          {
            kind: "command",
            text: "gcloud container clusters get-credentials app --zone=asia-northeast1-a",
          },
        ],
        points: [
          {
            term: "get-credentials",
            description: "kubectlが接続するクラスタの認証情報とコンテキストを設定します。",
          },
          {
            term: "コンテキスト",
            description: "kubectlの接続先クラスタなどをまとめた設定です。",
          },
        ],
        expected: "kubectlの対象がappになります。",
      },
      {
        title: "定義ファイルを適用し3つに複製する",
        explanation: "教材のYAMLに書かれたDeploymentを作り、アプリを動かすPodを3つへ増やします。",
        actions: [
          {
            kind: "command",
            text: "kubectl apply -f deployment.yaml",
          },
          {
            kind: "command",
            text: "kubectl scale deployment web --replicas=3",
          },
        ],
        points: [
          {
            term: "Deployment",
            description: "アプリのイメージや必要なPod数を宣言して管理するリソースです。",
          },
          {
            term: "apply -f",
            description: "ファイルに書かれた望ましい構成をクラスタへ反映します。",
          },
          {
            term: "--replicas=3",
            description: "同じアプリを実行するPodの目標数を3にします。",
          },
        ],
        expected: "webのDeploymentが3レプリカになります。",
      },
      {
        title: "公開用Serviceを作り確認する",
        explanation: "Podの集合へアクセスする入口を作ります。ServiceはラベルでPodを選びます。",
        actions: [
          {
            kind: "command",
            text: "kubectl expose deployment web --type=LoadBalancer --port=80",
          },
          {
            kind: "command",
            text: "kubectl get deployments",
          },
          {
            kind: "command",
            text: "kubectl get services",
          },
        ],
        points: [
          {
            term: "Service",
            description: "入れ替わるPodへ安定した接続先を提供します。",
          },
          {
            term: "--type=LoadBalancer",
            description: "外部ロードバランサーを介して公開するServiceの種類です。",
          },
          {
            term: "--port=80",
            description: "Serviceが受け付けるポート番号です。",
          },
        ],
        expected: "webが3レプリカで、web ServiceのTYPEがLoadBalancerです。",
      },
    ],
    takeaway:
      "gcloudはGKE環境、kubectlはクラスタ内のアプリを操作します。接続先の取得がその橋渡しです。",
  },
  "m-ops-003": {
    introduction:
      "VMのひな型を作り、そのひな型から複数VMを管理するMIGを作成して、自動スケールの上限を設定します。",
    steps: [
      CommonSteps.prepareCompute,
      {
        title: "VMのひな型を作成する",
        explanation:
          "同じ構成を繰り返し使えるように、マシンタイプをインスタンステンプレートへ保存します。",
        actions: [
          {
            kind: "command",
            text: "gcloud compute instance-templates create web-tpl --machine-type=e2-small",
          },
        ],
        points: [
          {
            term: "インスタンステンプレート",
            description: "VMを作成するための構成です。これだけではMIGのVMは起動しません。",
          },
        ],
        expected: "web-tplにe2-smallの構成が保存されます。",
      },
      {
        title: "ひな型から2台を管理するグループを作る",
        explanation: "MIGへテンプレートと初期台数、VMの配置先を指定します。",
        actions: [
          {
            kind: "command",
            text: "gcloud compute instance-groups managed create web-mig --template=web-tpl --size=2 --zone=asia-northeast1-a",
          },
        ],
        points: [
          {
            term: "--template",
            description: "VM作成に使うひな型です。",
          },
          {
            term: "--size=2",
            description: "グループが維持する初期の目標台数です。",
          },
        ],
        expected: "web-migに2台のVMが作成されます。",
      },
      {
        title: "増やせる台数の上限を決める",
        explanation: "自動調整を有効にしても際限なく増やさないよう、最大5台にします。",
        actions: [
          {
            kind: "command",
            text: "gcloud compute instance-groups managed set-autoscaling web-mig --max-num-replicas=5 --zone=asia-northeast1-a",
          },
          {
            kind: "command",
            text: "gcloud compute instance-groups managed describe web-mig --zone=asia-northeast1-a",
          },
        ],
        points: [
          {
            term: "--max-num-replicas=5",
            description: "自動スケールで増やせる上限です。直ちに5台へ増やす指定ではありません。",
          },
        ],
        expected: "目標台数は2のままで、自動スケールの最大値が5です。",
      },
    ],
    takeaway: "テンプレートはVMの構成、MIGはVMの集合、autoscalingは台数を調整する規則です。",
  },
  "m-iam-003": {
    introduction:
      "既存の広い管理者ロールを付けず、VMの起動・停止と参照に必要な4権限だけを集めます。",
    steps: [
      CommonSteps.prepareIam,
      {
        title: "必要な4権限だけのロールを定義する",
        explanation:
          "許可したい操作を列挙してvmOperatorを作ります。VMの作成・削除の権限は含めません。",
        actions: [
          {
            kind: "command",
            text: "gcloud iam roles create vmOperator --project=ace-dev-01 --title=VMOperator --permissions=compute.instances.start,compute.instances.stop,compute.instances.get,compute.instances.list",
          },
        ],
        points: [
          {
            term: "--permissions",
            description: "ロールに含める個別の権限をカンマ区切りで指定します。",
          },
          {
            term: "getとlist",
            description:
              "対象VMの詳細と一覧を参照するための権限です。起動・停止の対象確認に使えます。",
          },
        ],
        expected: "vmOperatorが作成されます。",
      },
      {
        title: "開発者へロールを割り当てる",
        explanation: "作成したロールをプロジェクトのIAMでdevへ付与し、内容も読み返します。",
        actions: [
          {
            kind: "command",
            text: "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:dev@example.com --role=projects/ace-dev-01/roles/vmOperator",
          },
          {
            kind: "command",
            text: "gcloud iam roles describe vmOperator --project=ace-dev-01",
          },
          {
            kind: "command",
            text: "gcloud projects get-iam-policy ace-dev-01",
          },
        ],
        points: [
          {
            term: "projects/ace-dev-01/roles/vmOperator",
            description:
              "プロジェクト内のカスタムロールの完全名です。事前定義ロールのroles/…とは形が違います。",
          },
        ],
        expected: "includedPermissionsに指定した4権限だけがあり、devへ完全名で付与されています。",
      },
    ],
    takeaway: "カスタムロールは権限の集合、IAM bindingはその集合を主体へ割り当てる設定です。",
  },
} satisfies Readonly<Record<string, MissionGuide>>;
