import type { GuideStep } from "./model";

export const CommonSteps = {
  prepareCompute: {
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
        text: "gcloud services enable compute.googleapis.com",
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
  prepareIam: {
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
        text: "gcloud services enable iam.googleapis.com",
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
  prepareStorage: {
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
        text: "gcloud services enable storage.googleapis.com",
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
  prepareContainer: {
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
        text: "gcloud services enable container.googleapis.com",
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
  preparePubsub: {
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
        text: "gcloud services enable pubsub.googleapis.com",
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
  prepareMonitoring: {
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
        text: "gcloud services enable monitoring.googleapis.com",
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
  loadTerraformNetwork: {
    title: "構成ファイルを読み、管理する対象を確認する",
    explanation:
      "VPCとサブネットを宣言したmain.tfを読みます。サブネットはVPCのidを参照するので、作成の依存関係も表します。",
    actions: [
      {
        kind: "load",
        name: "terraform-network",
        overwrite: true,
      },
    ],
    points: [
      {
        term: 'resource "google_compute_network" "lab"',
        description: 'labはTerraform内で使う名前、name="tf-lab-vpc"はGoogle Cloud上の名前です。',
      },
      {
        term: "network = google_compute_network.lab.id",
        description:
          "サブネットが先に作るVPCを参照します。Terraformはこの参照から依存順序を判断します。",
      },
      {
        term: "var.subnet_cidr",
        description: "IP範囲を変数から受け取ります。既定値は10.42.0.0/24です。",
      },
    ],
    expected:
      "ファイルタブでmain.tfを開き、resourceの名前・参照先・変数を確認してからCLIへ戻ります。",
  },
  initializeTerraform: {
    title: "Terraform用の認証情報と初期化を準備する",
    explanation:
      "Terraformはgcloud CLIの設定だけではなくApplication Default Credentials (ADC)を使います。認証後に構成を初期化します。",
    actions: [
      {
        kind: "command",
        text: "gcloud auth application-default login",
      },
      {
        kind: "command",
        text: "terraform init",
      },
      {
        kind: "command",
        text: "terraform validate",
      },
    ],
    points: [
      {
        term: "ADC",
        description:
          "Google Cloudのクライアントが共通で利用する認証情報です。gcloud config set accountによるCLIの主体選択とは別です。",
      },
      {
        term: "init",
        description: "providerやmodule、stateの保存先を初期化します。",
      },
      {
        term: "validate",
        description: "構成の形式や参照を検証します。リソースの作成は行いません。",
      },
    ],
    expected: "認証・初期化・構成検証に成功します。",
  },
  checkTerraformState: {
    title: "stateと構成の一致を確認する",
    explanation:
      "stateはTerraformが管理するアドレスと実リソースの対応表です。管理対象の一覧と、次の差分を確認します。",
    actions: [
      {
        kind: "command",
        text: "terraform state list",
      },
      {
        kind: "command",
        text: "terraform plan",
      },
    ],
    points: [
      {
        term: "state list",
        description:
          "Terraformが管理しているアドレスを表示します。クラウドの全リソース一覧とは異なります。",
      },
      {
        term: "No changes",
        description: "望ましい構成、state、現在のリソースの間に適用すべき差分がない状態です。",
      },
    ],
    expected: "対象のアドレスがstateにあり、次のplanでは変更がありません。",
  },
  applyInitialTerraformPlan: {
    title: "変更前の構成を計画して適用する",
    explanation:
      "まず作成・更新・削除の予定をplanへ保存し、その内容を読んでから同じplanを適用します。",
    actions: [
      {
        kind: "command",
        text: "terraform plan -out=initial-plan",
      },
      {
        kind: "command",
        text: "terraform show initial-plan",
      },
      {
        kind: "command",
        text: "terraform apply initial-plan",
      },
    ],
    points: [
      {
        term: "-out=initial-plan",
        description:
          "計画をファイルへ保存します。applyへこのファイル名を渡すと、確認した計画を適用できます。",
      },
      {
        term: "planとapply",
        description:
          "planは予定の確認、applyは実リソースとstateへの反映です。保存済みplanを渡す場合は追加のyes確認はありません。",
      },
    ],
    expected:
      "planに表示された対象が反映されます。変更不要のリソースまで削除・置換されていないことを確認します。",
  },
  importExistingNetwork: {
    title: "既存のVPCをHCLのアドレスと結び付ける",
    explanation:
      "gcloudで用意したVPCを、対応するresource定義へ取り込みます。importはVPCを新しく作る操作ではありません。",
    actions: [
      {
        kind: "write",
        name: "import.tf",
        content:
          'resource "google_compute_network" "imported" {\n  project = "ace-dev-01"\n  name = "tf-import-net"\n  auto_create_subnetworks = false\n}\n',
      },
      {
        kind: "command",
        text: "terraform import google_compute_network.imported projects/ace-dev-01/global/networks/tf-import-net",
      },
      {
        kind: "command",
        text: "terraform state show google_compute_network.imported",
      },
    ],
    points: [
      {
        term: "google_compute_network.imported",
        description: "HCLで宣言したリソースのアドレスです。",
      },
      {
        term: "projects/…/global/networks/…",
        description: "取り込む既存VPCのIDです。stateにこの対応関係を登録します。",
      },
    ],
    expected: "state showにtf-import-netが表示され、クラウド上の既存VPCが管理対象になります。",
  },
  moveNetworkIntoModule: {
    title: "アドレス移行を計画し、再作成を避ける",
    explanation:
      "ルートのlabをmodule.network内へ整理します。movedブロックで旧アドレスと新アドレスを対応付けます。",
    actions: [
      {
        kind: "load",
        name: "terraform-modules",
        overwrite: true,
      },
      {
        kind: "command",
        text: "terraform init",
      },
      {
        kind: "command",
        text: "terraform plan -out=module-plan",
      },
      {
        kind: "command",
        text: "terraform show module-plan",
      },
      {
        kind: "command",
        text: "terraform apply module-plan",
      },
      {
        kind: "command",
        text: "terraform state list",
      },
    ],
    points: [
      {
        term: "module",
        description: "複数のresourceをまとめ、入力と出力を持たせる構成単位です。",
      },
      {
        term: "movedのfromとto",
        description:
          "state上のアドレスを移すことを宣言します。fromが旧アドレス、toがmodule内の新アドレスです。",
      },
      {
        term: "has moved to",
        description:
          "計画に2つのアドレス移行が表示され、追加・変更・削除がないことを読み取ります。",
      },
    ],
    expected:
      "stateにmodule.network.google_compute_network.labとmodule.network.google_compute_subnetwork.labがあり、既存VPC・サブネットが残ります。",
  },
  prepareComputeStorage: {
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
        text: "gcloud services enable compute.googleapis.com storage.googleapis.com",
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
  loadTerraformInfrastructure: {
    title: "構成ファイルを読み、管理する対象を確認する",
    explanation:
      "5つのresourceを定義したmain.tfを読みます。VMとfirewallはVPCを参照し、VMはsubnetも参照します。",
    actions: [
      {
        kind: "load",
        name: "terraform-infrastructure",
        overwrite: true,
      },
    ],
    points: [
      {
        term: "resource間のid参照",
        description: "作成・削除する順番を判断する依存関係になります。",
      },
      {
        term: "target_tagsとtags",
        description: "firewallの対象タグとVMのタグを対応付けます。",
      },
      {
        term: "bucketの保護設定",
        description:
          "UBLA、public_access_prevention、versioningがそれぞれアクセス管理、公開防止、世代管理を設定します。",
      },
    ],
    expected:
      "ファイルタブでmain.tfを開き、resourceの名前・参照先・変数を確認してからCLIへ戻ります。",
  },
  createTerraformStateBucket: {
    title: "state保存用のbucketを用意する",
    explanation: "stateを共有保存する先を先に作り、更新前の世代も保持できるようにします。",
    actions: [
      {
        kind: "command",
        text: "gcloud storage buckets create gs://ace-dev-01-tf-state --location=us-central1 --uniform-bucket-level-access",
      },
      {
        kind: "command",
        text: "gcloud storage buckets update gs://ace-dev-01-tf-state --versioning",
      },
    ],
    points: [
      {
        term: "backend",
        description:
          "Terraformがstateを保存する場所の設定です。リソースを作るproviderとは役割が違います。",
      },
      {
        term: "--versioning",
        description: "stateオブジェクトが更新されたときに以前の世代を保持します。",
      },
    ],
    expected: "state保存用bucketにUBLAとversioningが設定されます。",
  },
  migrateTerraformState: {
    title: "ローカルstateをGCSへ移行する",
    explanation:
      "backend.tfのbucketとprefixを確認し、既にあるstateをコピーする移行として初期化します。",
    actions: [
      {
        kind: "load",
        name: "terraform-backend",
        overwrite: true,
      },
      {
        kind: "command",
        text: "terraform init -migrate-state",
      },
      {
        kind: "answer",
        text: "yes",
      },
      {
        kind: "command",
        text: "terraform state list",
      },
      {
        kind: "command",
        text: "terraform state pull",
      },
      {
        kind: "command",
        text: "gcloud storage ls gs://ace-dev-01-tf-state/terraform/lab/",
      },
      {
        kind: "command",
        text: "terraform plan",
      },
    ],
    points: [
      {
        term: 'prefix = "terraform/lab"',
        description: "stateを保存するbucket内のパスの先頭です。",
      },
      {
        term: "-migrate-state",
        description: "保存先を変えるとき、現在のstateを新しいbackendへ移します。",
      },
      {
        term: "yes",
        description:
          "移行の確認に対する回答です。新しいgcloudやTerraformのコマンドではありません。",
      },
      {
        term: "state pull",
        description: "現在のbackendからstateを読み出します。構成を再作成する操作ではありません。",
      },
    ],
    expected:
      "stateの管理対象が維持され、bucketにstateオブジェクトがあります。次のplanにリソースの再作成がありません。",
  },
  prepareArtifactregistry: {
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
        text: "gcloud services enable artifactregistry.googleapis.com",
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
  registryAceImages: {
    title: "保存先リポジトリとDockerの認証を準備する",
    explanation:
      "Artifact Registryにイメージの保存先を作り、Dockerがそのホストへ認証できるようにします。",
    actions: [
      {
        kind: "command",
        text: "gcloud artifacts repositories create ace-images --repository-format=docker --location=us-central1",
      },
      {
        kind: "command",
        text: "gcloud auth configure-docker us-central1-docker.pkg.dev",
      },
    ],
    points: [
      {
        term: "--repository-format=docker",
        description: "Dockerイメージを保存する形式のリポジトリです。",
      },
      {
        term: "configure-docker",
        description:
          "指定ホストへのDockerの認証にgcloudの資格情報を使う設定です。IAMロールの付与やpushそのものは行いません。",
      },
    ],
    expected:
      "ace-imagesがus-central1に作成され、Dockerの認証先にus-central1-docker.pkg.devが登録されます。",
  },
  tagLocalImage: {
    title: "ローカルタグと保存先タグを用意する",
    explanation:
      "まず短いローカル名でビルドし、同じイメージにArtifact Registry用の完全名を付けます。",
    actions: [
      {
        kind: "command",
        text: "docker build -t hello:v1 ./hello-web",
      },
      {
        kind: "command",
        text: "docker tag hello:v1 us-central1-docker.pkg.dev/ace-dev-01/ace-images/hello:v1",
      },
    ],
    points: [
      {
        term: "docker tag",
        description:
          "既存イメージに別の参照名を付けます。別の内容をビルドしたり、リモートへ送信したりする操作ではありません。",
      },
    ],
    expected: "同じローカルイメージに2つの参照名が付きます。",
  },
  pushLocalImage: {
    title: "リモートへ送信し一覧を確認する",
    explanation: "保存先名を付けたイメージをpushして、リポジトリ側の一覧で登録を確かめます。",
    actions: [
      {
        kind: "command",
        text: "docker push us-central1-docker.pkg.dev/ace-dev-01/ace-images/hello:v1",
      },
      {
        kind: "command",
        text: "gcloud artifacts docker images list us-central1-docker.pkg.dev/ace-dev-01/ace-images --include-tags",
      },
    ],
    points: [
      {
        term: "ローカルとリモートの違い",
        description:
          "docker imagesは手元の一覧です。gcloud artifacts docker images listでリポジトリ側を確認します。",
      },
    ],
    expected: "ace-imagesのリモート一覧にhello:v1が表示されます。",
  },
  prepareCloudbuildArtifactregistryContainer: {
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
        text: "gcloud services enable cloudbuild.googleapis.com artifactregistry.googleapis.com container.googleapis.com",
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
  createBuildIdentity: {
    title: "ビルド処理専用のアカウントを準備する",
    explanation:
      "ビルドの実行主体にリポジトリへの書き込みを許可し、依頼者にはその主体を使う権限を付けます。",
    actions: [
      {
        kind: "command",
        text: "gcloud iam service-accounts create ace-builder",
      },
      {
        kind: "command",
        text: "gcloud artifacts repositories add-iam-policy-binding ace-images --location=us-central1 --member=serviceAccount:ace-builder@ace-dev-01.iam.gserviceaccount.com --role=roles/artifactregistry.writer",
      },
      {
        kind: "command",
        text: "gcloud iam service-accounts add-iam-policy-binding ace-builder@ace-dev-01.iam.gserviceaccount.com --member=user:owner@example.com --role=roles/iam.serviceAccountUser",
      },
    ],
    points: [
      {
        term: "Writer",
        description: "ビルド結果をリポジトリへ登録するために、実行主体へ付けます。",
      },
      {
        term: "Service Account User",
        description: "依頼者がそのサービスアカウントをビルドに割り当てるための権限です。",
      },
    ],
    expected: "ace-builderにWriter、ownerにace-builderの利用権限が付きます。",
  },
  submitCloudBuild: {
    title: "Cloud Buildへビルドを依頼する",
    explanation: "手元のdocker pushではなく、ソースと出力先を指定してCloud Buildへ依頼します。",
    actions: [
      {
        kind: "command",
        text: "gcloud builds submit ./hello-web --tag=us-central1-docker.pkg.dev/ace-dev-01/ace-images/hello:v1 --service-account=projects/ace-dev-01/serviceAccounts/ace-builder@ace-dev-01.iam.gserviceaccount.com --region=us-central1",
      },
      {
        kind: "command",
        text: "gcloud builds list --region=us-central1",
      },
    ],
    points: [
      {
        term: "--tag",
        description: "ビルド成果物として登録するイメージの完全名です。",
      },
      {
        term: "--service-account",
        description: "今回のビルドを実行する主体です。",
      },
      {
        term: "SUCCESS",
        description: "ソースの処理と成果物の登録が成功したことを履歴で確認します。",
      },
    ],
    expected: "Cloud Buildの履歴がSUCCESSで、hello:v1が登録されています。",
  },
  prepareArtifactregistryContainer: {
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
        text: "gcloud services enable artifactregistry.googleapis.com container.googleapis.com",
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
  registryReleaseImages: {
    title: "保存先リポジトリとDockerの認証を準備する",
    explanation:
      "Artifact Registryにイメージの保存先を作り、Dockerがそのホストへ認証できるようにします。",
    actions: [
      {
        kind: "command",
        text: "gcloud artifacts repositories create release-images --repository-format=docker --location=us-central1",
      },
      {
        kind: "command",
        text: "gcloud auth configure-docker us-central1-docker.pkg.dev",
      },
    ],
    points: [
      {
        term: "--repository-format=docker",
        description: "Dockerイメージを保存する形式のリポジトリです。",
      },
      {
        term: "configure-docker",
        description:
          "指定ホストへのDockerの認証にgcloudの資格情報を使う設定です。IAMロールの付与やpushそのものは行いません。",
      },
    ],
    expected:
      "release-imagesがus-central1に作成され、Dockerの認証先にus-central1-docker.pkg.devが登録されます。",
  },
  buildReleaseVersions: {
    title: "v1/v2をビルドしリモートへ登録する",
    explanation:
      "教材のソースからイメージをビルドし、配置先を含むタグ名でpushします。ローカルにあるだけではGKEから取得できません。",
    actions: [
      {
        kind: "command",
        text: "docker build -t us-central1-docker.pkg.dev/ace-dev-01/release-images/hello:v1 ./hello-web",
      },
      {
        kind: "command",
        text: "docker push us-central1-docker.pkg.dev/ace-dev-01/release-images/hello:v1",
      },
      {
        kind: "command",
        text: "docker build -t us-central1-docker.pkg.dev/ace-dev-01/release-images/hello:v2 ./hello-web-v2",
      },
      {
        kind: "command",
        text: "docker push us-central1-docker.pkg.dev/ace-dev-01/release-images/hello:v2",
      },
      {
        kind: "command",
        text: "gcloud artifacts docker images list us-central1-docker.pkg.dev/ace-dev-01/release-images --include-tags",
      },
    ],
    points: [
      {
        term: "docker build -t",
        description: "ソースのディレクトリを元にイメージを作り、参照名を付けます。",
      },
      {
        term: "ホスト/プロジェクト/リポジトリ/イメージ:タグ",
        description: "Artifact Registryの保存先を含む完全な参照名です。",
      },
      {
        term: "docker push",
        description:
          "ローカルのイメージをリポジトリへ登録します。images list --include-tagsでリモート側の登録を確認します。",
      },
    ],
    expected: "指定したタグのイメージがArtifact Registryの一覧にあります。",
  },
  deployReleaseBaseline: {
    title: "ノードへ取得権限を与え、最初の版を配置する",
    explanation:
      "アプリを取得するノードの専用アカウントを用意し、まずv1が動いている履歴を作ります。",
    actions: [
      {
        kind: "command",
        text: "gcloud iam service-accounts create release-nodes",
      },
      {
        kind: "command",
        text: "gcloud iam service-accounts add-iam-policy-binding release-nodes@ace-dev-01.iam.gserviceaccount.com --member=user:owner@example.com --role=roles/iam.serviceAccountUser",
      },
      {
        kind: "command",
        text: "gcloud artifacts repositories add-iam-policy-binding release-images --location=us-central1 --member=serviceAccount:release-nodes@ace-dev-01.iam.gserviceaccount.com --role=roles/artifactregistry.reader",
      },
      {
        kind: "command",
        text: "gcloud container clusters create-auto release-gke --region=us-central1 --service-account=release-nodes@ace-dev-01.iam.gserviceaccount.com",
      },
      {
        kind: "command",
        text: "gcloud container clusters get-credentials release-gke --region=us-central1",
      },
      {
        kind: "command",
        text: "kubectl create deployment hello --image=us-central1-docker.pkg.dev/ace-dev-01/release-images/hello:v1 --replicas=2",
      },
      {
        kind: "command",
        text: "kubectl rollout status deployment/hello",
      },
    ],
    points: [
      {
        term: "Reader",
        description: "ノードがArtifact Registryからイメージを取得するための権限です。",
      },
      {
        term: "rollout status",
        description: "Deploymentの更新で必要なPodが起動できたかを確認します。",
      },
      {
        term: "revision",
        description: "DeploymentのPod定義の変更履歴です。最初のv1がrevision 1になります。",
      },
    ],
    expected: "v1が2レプリカで起動し、最初の履歴が残っています。",
  },
  createConfigCluster: {
    title: "クラスタとkubectlの接続先を準備する",
    explanation:
      "クラスタを用意し、get-credentialsでkubectlの操作先を選びます。ファイルを使う演習では続いて教材テンプレートを読み込みます。",
    actions: [
      {
        kind: "command",
        text: "gcloud container clusters create-auto config-gke --region=us-central1",
      },
      {
        kind: "command",
        text: "gcloud container clusters get-credentials config-gke --region=us-central1",
      },
    ],
    points: [
      {
        term: "get-credentials",
        description:
          "kubectl用の認証情報を取得し、現在のコンテキストを対象クラスタへ切り替えます。",
      },
      {
        term: "kubectlとgcloud",
        description: "gcloudはGKE環境、kubectlはその中のDeploymentやServiceなどを操作します。",
      },
    ],
    expected: "kubectlの対象がconfig-gkeです。ここからアプリを配置します。",
  },
  createConfigApplication: {
    title: "設定を参照するアプリを用意する",
    explanation: "ConfigMapとSecretを利用するconfig-webを2レプリカで起動します。",
    actions: [
      {
        kind: "command",
        text: "kubectl create deployment config-web --image=nginx:1 --replicas=2",
      },
    ],
    points: [
      {
        term: "環境変数",
        description:
          "コンテナの起動時に渡す名前付きの値です。起動後に外の設定を変えても、値がそのままのケースを後で確認します。",
      },
    ],
    expected: "config-webが2レプリカで動作します。",
  },
  restartConfigApplication: {
    title: "Podを作り直し新しい設定を読む",
    explanation:
      "設定の保存やapplyだけでは起動済み環境変数が変わらないため、DeploymentのPodを再作成します。",
    actions: [
      {
        kind: "command",
        text: "kubectl rollout restart deployment/config-web",
      },
      {
        kind: "command",
        text: "kubectl rollout status deployment/config-web",
      },
      {
        kind: "command",
        text: "kubectl exec deployment/config-web -- printenv APP_MODE",
      },
    ],
    points: [
      {
        term: "rollout restart",
        description:
          "Pod定義へ再起動の変更を加え、新しいPodを起動します。設定の入れ物を削除する操作ではありません。",
      },
      {
        term: "exec … -- printenv",
        description: "Pod内の環境変数を読みます。--の後ろはコンテナ内で実行するコマンドです。",
      },
    ],
    expected: "2つのPodが起動し、新しいAPP_MODE=productionを読み込みます。",
  },
} as const satisfies Readonly<Record<string, GuideStep>>;
