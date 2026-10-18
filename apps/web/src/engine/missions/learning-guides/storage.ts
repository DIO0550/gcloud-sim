import { CommonSteps } from "./common";
import type { MissionGuide } from "./model";

export const StorageGuides = {
  "storage-classes": {
    introduction: "バケットの既定クラスで保存した後、1つのオブジェクトだけ別のクラスへ変更します。",
    steps: [
      CommonSteps.prepareStorage,
      {
        title: "既定COLDLINEでオブジェクトを保存する",
        explanation: "まずバケットを作り、クラスを指定せずにreport.jsonをアップロードします。",
        actions: [
          {
            kind: "command",
            text: "gcloud storage buckets create gs://storage-classes --location=us-central1 --default-storage-class=COLDLINE",
          },
          {
            kind: "command",
            text: "gcloud storage cp ./report.json gs://storage-classes/report.json",
          },
        ],
        points: [
          {
            term: "--default-storage-class=COLDLINE",
            description: "新規オブジェクトでクラス指定を省略したときに使う既定値です。",
          },
          {
            term: "storage cp",
            description: "教材のローカルファイルをCloud Storageのオブジェクトとして保存します。",
          },
        ],
        expected: "report.jsonは最初COLDLINEで保存されます。",
      },
      {
        title: "オブジェクトだけARCHIVEへ変更する",
        explanation: "バケットの既定値を保ったまま、対象オブジェクトの保管クラスを変更します。",
        actions: [
          {
            kind: "command",
            text: "gcloud storage objects update gs://storage-classes/report.json --storage-class=ARCHIVE",
          },
          {
            kind: "command",
            text: "gcloud storage objects describe gs://storage-classes/report.json",
          },
          {
            kind: "command",
            text: "gcloud storage buckets describe gs://storage-classes",
          },
        ],
        points: [
          {
            term: "--storage-class=ARCHIVE",
            description:
              "指定した既存オブジェクトのクラスを変更します。バケットの既定値を変更するフラグではありません。",
          },
        ],
        expected: "report.jsonはARCHIVE、バケットの既定値はCOLDLINEのままです。",
      },
    ],
    takeaway:
      "既定クラスの変更と既存オブジェクトのクラス変更は別です。オブジェクトの設定を個別に確認します。",
  },
  "storage-ubla": {
    introduction: "オブジェクト保存後に、アクセス制御をバケットのIAMへ統一します。",
    steps: [
      CommonSteps.prepareStorage,
      {
        title: "比較用のオブジェクトを用意する",
        explanation: "先に通常のバケットとオブジェクトを作り、アクセス制御の変更対象を用意します。",
        actions: [
          {
            kind: "command",
            text: "gcloud storage buckets create gs://storage-ubla --location=us-central1",
          },
          {
            kind: "command",
            text: "gcloud storage cp ./report.json gs://storage-ubla/report.json",
          },
        ],
        points: [
          {
            term: "バケットとオブジェクト",
            description: "バケットは保存先の入れ物、オブジェクトは保存した個々のデータです。",
          },
        ],
        expected: "storage-ublaにreport.jsonがあります。",
      },
      {
        title: "アクセス制御をIAMへ統一する",
        explanation:
          "バケット単位で統一する設定を有効にし、オブジェクトを残したまま設定を変えます。",
        actions: [
          {
            kind: "command",
            text: "gcloud storage buckets update gs://storage-ubla --uniform-bucket-level-access",
          },
          {
            kind: "command",
            text: "gcloud storage buckets describe gs://storage-ubla",
          },
          {
            kind: "command",
            text: "gcloud storage ls gs://storage-ubla/",
          },
        ],
        points: [
          {
            term: "Uniform bucket-level access (UBLA)",
            description:
              "オブジェクトごとのACLを使わず、IAMでアクセスを管理する設定です。データの暗号化や削除とは別の機能です。",
          },
        ],
        expected: "uniformBucketLevelAccessが有効で、report.jsonも残っています。",
      },
    ],
    takeaway: "UBLAを有効にすると、個別オブジェクトのACLではなくIAMでアクセスを管理します。",
  },
  "storage-softdelete": {
    introduction: "削除後も一定期間保持するsoft deleteを設定し、削除された世代から復旧します。",
    steps: [
      CommonSteps.prepareStorage,
      {
        title: "復旧できる保持期間を用意する",
        explanation: "誤削除に備え、7日間のsoft deleteを持つバケットにデータを保存します。",
        actions: [
          {
            kind: "command",
            text: "gcloud storage buckets create gs://storage-softdelete --location=us-central1 --soft-delete-duration=7d",
          },
          {
            kind: "command",
            text: "gcloud storage cp ./report.json gs://storage-softdelete/report.json",
          },
        ],
        points: [
          {
            term: "--soft-delete-duration=7d",
            description:
              "削除したオブジェクトを復旧可能な状態で7日保持します。オブジェクトの上書き履歴を残すversioningとは別の設定です。",
          },
        ],
        expected: "report.jsonの最初の世代が保存されます。",
      },
      {
        title: "削除した世代を復元する",
        explanation: "report.jsonを削除し、初回のアップロードで作られた世代1を復元します。",
        actions: [
          {
            kind: "command",
            text: "gcloud storage rm gs://storage-softdelete/report.json --quiet",
          },
          {
            kind: "command",
            text: "gcloud storage restore gs://storage-softdelete/report.json#1",
          },
          {
            kind: "command",
            text: "gcloud storage objects describe gs://storage-softdelete/report.json",
          },
        ],
        points: [
          {
            term: "--quiet",
            description: "削除確認への応答を省略します。削除の意味は変わりません。",
          },
          {
            term: "#1",
            description:
              "復元元の世代番号です。この初期状態からの演習では1です。繰り返す場合は実際に削除した世代を選びます。",
          },
        ],
        expected: "report.jsonが新しいlive世代として存在し、ミッションがクリアになります。",
      },
    ],
    takeaway: "soft deleteの復旧は削除前の世代を指定します。復元すると新しいlive世代が作られます。",
  },
  "storage-retention": {
    introduction:
      "オブジェクトの最低保持期間を設定し、ポリシーをロックしてからデータを保存します。",
    steps: [
      CommonSteps.prepareStorage,
      {
        title: "最低保持期間を設定する",
        explanation: "作成するバケットに1時間の保持期間を指定します。",
        actions: [
          {
            kind: "command",
            text: "gcloud storage buckets create gs://storage-retention --location=us-central1 --retention-period=1h",
          },
        ],
        points: [
          {
            term: "--retention-period=1h",
            description: "保存したオブジェクトを少なくとも1時間保持する条件です。",
          },
        ],
        expected: "retention policyが1時間で作成されます。",
      },
      {
        title: "ポリシーをロックして保存する",
        explanation:
          "ロックは実環境では取り消せず、保持期間を短縮・解除できなくなります。ここでは学習用バケットに対して設定します。",
        actions: [
          {
            kind: "command",
            text: "gcloud storage buckets update gs://storage-retention --lock-retention-period",
          },
          {
            kind: "command",
            text: "gcloud storage cp ./report.json gs://storage-retention/report.json",
          },
          {
            kind: "command",
            text: "gcloud storage buckets describe gs://storage-retention",
          },
        ],
        points: [
          {
            term: "--lock-retention-period",
            description: "保持ポリシーをロックします。単に有効化する指定より強い制約です。",
          },
        ],
        expected: "保持期間が3600秒でロックされ、report.jsonが保存されています。",
      },
    ],
    takeaway:
      "retentionは期間内の削除を制限し、soft deleteは削除後の復旧を扱います。保護する段階が異なります。",
  },
  "storage-cmek": {
    introduction:
      "自分で管理する暗号鍵CMEKをCloud Storageへ指定します。鍵の作成、Storage側の利用権限、バケットの設定の順で進めます。",
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
            text: "gcloud services enable storage.googleapis.com cloudkms.googleapis.com",
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
        title: "リージョンを合わせて暗号鍵を作る",
        explanation: "バケットと同じus-central1に、鍵をまとめるKeyRingと暗号鍵を作ります。",
        actions: [
          {
            kind: "command",
            text: "gcloud kms keyrings create storage-ring --location=us-central1",
          },
          {
            kind: "command",
            text: "gcloud kms keys create storage-key --keyring=storage-ring --location=us-central1 --purpose=encryption",
          },
        ],
        points: [
          {
            term: "KeyRing",
            description: "同じ場所の鍵をまとめる管理単位です。",
          },
          {
            term: "--purpose=encryption",
            description: "データ暗号化・復号に使う鍵として作成します。",
          },
        ],
        expected: "storage-ringの中にstorage-keyが作成されます。",
      },
      {
        title: "Storageへ鍵の利用を許可する",
        explanation:
          "サービスエージェントが暗号化・復号できなければ、バケットへ鍵を指定してもデータを保存できません。",
        actions: [
          {
            kind: "command",
            text: "gcloud storage service-agent --authorize-cmek=projects/ace-dev-01/locations/us-central1/keyRings/storage-ring/cryptoKeys/storage-key",
          },
        ],
        points: [
          {
            term: "サービスエージェント",
            description:
              "Google Cloudのサービスがプロジェクトの処理を行うための管理用アカウントです。",
          },
          {
            term: "--authorize-cmek",
            description:
              "Cloud Storageのサービスエージェントへ、この鍵を使うための権限を設定します。",
          },
        ],
        expected: "Storageのサービスエージェントに鍵の利用権限が付きます。",
      },
      {
        title: "既定の鍵を指定して新規オブジェクトを保存する",
        explanation: "用意した鍵をバケットの既定値にし、その後に保存するデータへ使います。",
        actions: [
          {
            kind: "command",
            text: "gcloud storage buckets create gs://storage-cmek --location=us-central1 --default-encryption-key=projects/ace-dev-01/locations/us-central1/keyRings/storage-ring/cryptoKeys/storage-key",
          },
          {
            kind: "command",
            text: "gcloud storage cp ./report.json gs://storage-cmek/report.json",
          },
          {
            kind: "command",
            text: "gcloud storage objects describe gs://storage-cmek/report.json",
          },
        ],
        points: [
          {
            term: "--default-encryption-key",
            description:
              "新しいオブジェクトに使う既定のCMEKです。既に保存した全オブジェクトを一括で再暗号化する指定ではありません。",
          },
        ],
        expected: "report.jsonの暗号鍵がstorage-keyを指します。",
      },
    ],
    takeaway:
      "鍵を使うのは操作中のユーザーではなくCloud Storageのサービスエージェントです。鍵の場所と保存場所も合わせます。",
  },
} satisfies Readonly<Record<string, MissionGuide>>;
