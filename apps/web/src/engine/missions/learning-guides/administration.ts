import type { MissionGuide } from "./model";

export const AdministrationGuides = {
  "admin-locations": {
    introduction:
      "devフォルダへ保存場所の制約を付け、その配下のプロジェクトで許可された場所へバケットを作ります。",
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
            text: "gcloud services enable orgpolicy.googleapis.com storage.googleapis.com",
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
        title: "フォルダ単位の制約をファイルに書く",
        explanation:
          "ファイルタブでadmin-policy.jsonを新規作成し、次のJSONを保存します。対象フォルダと許可場所を別々の項目で指定します。",
        actions: [
          {
            kind: "write",
            name: "admin-policy.json",
            content:
              '{"name": "folders/284100000001/policies/gcp.resourceLocations", "spec": {"rules": [{"values": {"allowedValues": ["is:us-central1"]}}]}}',
          },
        ],
        points: [
          {
            term: "gcp.resourceLocations",
            description: "作成できるリソースの場所を制限する制約名です。",
          },
          {
            term: "allowedValuesのis:us-central1",
            description:
              "us-central1を明示的に許可する値です。フォルダ配下のプロジェクトへ継承されます。",
          },
        ],
        expected:
          "admin-policy.jsonが保存されます。ファイル編集だけではポリシーはまだ変わりません。",
      },
      {
        title: "ポリシーを反映し、許可された場所へ作成する",
        explanation: "JSONを適用した後で、子プロジェクトにバケットを作ります。",
        actions: [
          {
            kind: "command",
            text: "gcloud org-policies set-policy admin-policy.json",
          },
          {
            kind: "command",
            text: "gcloud storage buckets create gs://admin-locations --location=us-central1",
          },
          {
            kind: "command",
            text: "gcloud storage buckets describe gs://admin-locations",
          },
        ],
        points: [
          {
            term: "set-policy",
            description: "ファイルの内容を組織ポリシーへ反映します。",
          },
          {
            term: "--location=us-central1",
            description: "先ほど許可した場所に作成します。",
          },
        ],
        expected:
          "admin-locationsが許可されたus-central1に作成され、フォルダの制約が設定されています。",
      },
    ],
    takeaway:
      "組織ポリシーはリソースの構成条件を制限します。操作主体へ権限を付けるIAMとは役割が違います。",
  },
  "admin-assets": {
    introduction:
      "プロジェクト内へバケットを作り、組織全体を検索範囲としてCloud Asset Inventoryから探します。",
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
            text: "gcloud services enable cloudasset.googleapis.com storage.googleapis.com",
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
        title: "検索対象を用意する",
        explanation: "名前で見つけられるように、子プロジェクトへバケットを作ります。",
        actions: [
          {
            kind: "command",
            text: "gcloud storage buckets create gs://admin-assets --location=us-central1",
          },
        ],
        points: [
          {
            term: "Asset",
            description: "Cloud Asset Inventoryが扱う、VMやバケットなどのリソース情報です。",
          },
        ],
        expected: "ace-dev-01にadmin-assetsが存在します。",
      },
      {
        title: "組織の配下から名前を検索する",
        explanation: "作成プロジェクトに限定せず、組織を起点に横断検索します。",
        actions: [
          {
            kind: "command",
            text: "gcloud asset search-all-resources --scope=organizations/123456789012 --query=name:admin-assets",
          },
        ],
        points: [
          {
            term: "--scope",
            description:
              "検索する階層上の範囲です。organizations/…なら配下のリソースを対象にします。",
          },
          {
            term: "--query=name:admin-assets",
            description: "リソース名を条件として絞り込みます。",
          },
        ],
        expected: "admin-assetsが見つかり、所属プロジェクトと上位の階層情報を確認できます。",
      },
    ],
    takeaway:
      "検索範囲scopeと、名前などを絞るqueryは別です。結果の所属プロジェクト・フォルダも確認します。",
  },
  "admin-apibilling": {
    introduction:
      "課金が未設定の本番プロジェクトで、課金リンクとCompute APIを順に整え、VM作成まで進めます。",
    steps: [
      {
        title: "本番の請求先を設定する",
        explanation:
          "VMの利用条件を満たすために、まず本番プロジェクトの請求アカウントを紐付けます。",
        actions: [
          {
            kind: "command",
            text: "gcloud billing projects link ace-prod-01 --billing-account=01AB2C-DEF345-6789AB",
          },
        ],
        points: [
          {
            term: "billing projects link",
            description: "課金対象のプロジェクトと請求先アカウントを接続します。",
          },
        ],
        expected: "本番プロジェクトの課金リンクが有効です。",
      },
      {
        title: "本番のAPIを有効化してVMを作る",
        explanation:
          "既定プロジェクトへ誤って作成しないよう、どちらのコマンドにも--projectを付けます。",
        actions: [
          {
            kind: "command",
            text: "gcloud services enable compute.googleapis.com --project=ace-prod-01",
          },
          {
            kind: "command",
            text: "gcloud compute instances create admin-prod --project=ace-prod-01 --zone=us-central1-a",
          },
          {
            kind: "command",
            text: "gcloud compute instances describe admin-prod --project=ace-prod-01 --zone=us-central1-a",
          },
        ],
        points: [
          {
            term: "--project=ace-prod-01",
            description: "サービスの有効化とVM作成の両方で本番プロジェクトを明示します。",
          },
          {
            term: "--zone",
            description: "VMの配置先です。課金アカウントの場所を指定するフラグではありません。",
          },
        ],
        expected: "ace-prod-01にadmin-prodがRUNNINGで存在します。",
      },
    ],
    takeaway:
      "リソースが作れない場合、請求先、API、IAM、配置場所を分けて確認します。この演習では課金とAPIを復旧します。",
  },
} satisfies Readonly<Record<string, MissionGuide>>;
