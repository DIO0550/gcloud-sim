import { CommonSteps } from "./common";
import type { MissionGuide } from "./model";

export const ContainersGuides = {
  "m-containers-001": {
    introduction:
      "ソースからイメージを作り、そのイメージからコンテナを起動してログとポートを確認します。",
    steps: [
      {
        title: "教材ソースをイメージにする",
        explanation: "組み込みのhello-webを使って、hello:v1という参照名のイメージを作ります。",
        actions: [
          {
            kind: "command",
            text: "docker build -t hello:v1 ./hello-web",
          },
          {
            kind: "command",
            text: "docker images",
          },
        ],
        points: [
          {
            term: "-t hello:v1",
            description: "helloというイメージへv1というタグを付けます。",
          },
          {
            term: "./hello-web",
            description: "Dockerfileなどを含むビルド用ソースのディレクトリです。",
          },
        ],
        expected: "docker imagesにhelloのv1が表示されます。まだコンテナは起動していません。",
      },
      {
        title: "ポートを結び付けて起動する",
        explanation: "ホストの8080番から、コンテナ内アプリの8080番へ届く構成にします。",
        actions: [
          {
            kind: "command",
            text: "docker run -d --name hello-local -p 8080:8080 hello:v1",
          },
          {
            kind: "command",
            text: "docker ps",
          },
          {
            kind: "command",
            text: "docker logs hello-local",
          },
          {
            kind: "command",
            text: "docker inspect hello-local",
          },
        ],
        points: [
          {
            term: "-d",
            description: "バックグラウンドで起動します。",
          },
          {
            term: "--name",
            description: "後で操作するコンテナの名前です。イメージ名とは別です。",
          },
          {
            term: "-p 8080:8080",
            description: "左はホスト側、右はコンテナ側のポートです。向きを逆にしないようにします。",
          },
        ],
        expected:
          "hello-localが起動中で、ホスト8080→コンテナ8080の設定と起動ログが確認できます。教材では実プロセスや通信は発生しません。",
      },
    ],
    takeaway: "イメージは実行の元になるひな型、コンテナはそれを起動した実体です。",
  },
  "m-containers-002": {
    introduction: "イメージのローカル参照名とリモートの保存先を対応付け、pushで共有します。",
    steps: [
      CommonSteps.prepareArtifactregistry,
      CommonSteps.registryAceImages,
      CommonSteps.tagLocalImage,
      CommonSteps.pushLocalImage,
    ],
    takeaway:
      "認証設定、リポジトリのIAM、pushは役割が異なります。ローカルタグを付けただけでは公開されません。",
  },
  "m-containers-003": {
    introduction:
      "イメージのローカル参照名とリモートの保存先を対応付け、pushで共有します。さらに利用者へ取得だけを許可します。",
    steps: [
      CommonSteps.prepareArtifactregistry,
      CommonSteps.registryAceImages,
      CommonSteps.tagLocalImage,
      CommonSteps.pushLocalImage,
      {
        title: "読み取り専用ロールで取得を試す",
        explanation: "リポジトリを範囲にReaderを付け、その利用者でpullとpushの違いを確認します。",
        actions: [
          {
            kind: "command",
            text: "gcloud artifacts repositories add-iam-policy-binding ace-images --location=us-central1 --member=user:developer@example.com --role=roles/artifactregistry.reader",
          },
          {
            kind: "command",
            text: "gcloud auth login developer@example.com",
          },
          {
            kind: "command",
            text: "docker pull us-central1-docker.pkg.dev/ace-dev-01/ace-images/hello:v1",
          },
          {
            kind: "command",
            text: "docker push us-central1-docker.pkg.dev/ace-dev-01/ace-images/hello:v1",
            expectFailure: true,
          },
        ],
        points: [
          {
            term: "roles/artifactregistry.reader",
            description: "イメージの取得を許可します。登録するWriterの権限は含みません。",
          },
          {
            term: "gcloud auth login",
            description:
              "この教材では指定した架空のアカウントを利用可能にし、操作主体を切り替えます。",
          },
          {
            term: "期待する権限エラー",
            description: "pullの成功だけでなく、pushが拒否されることも読み取り専用の確認です。",
          },
        ],
        expected: "developerのpullは成功し、pushは権限不足で失敗します。",
      },
    ],
    takeaway:
      "認証設定、リポジトリのIAM、pushは役割が異なります。ローカルタグを付けただけでは公開されません。",
  },
  "m-builds-001": {
    introduction:
      "ビルド依頼者とビルド実行主体の権限を分け、Cloud BuildからArtifact Registryへ成果物を登録します。",
    steps: [
      CommonSteps.prepareCloudbuildArtifactregistryContainer,
      CommonSteps.registryAceImages,
      CommonSteps.createBuildIdentity,
      CommonSteps.submitCloudBuild,
    ],
    takeaway: "依頼者の権限とビルド実行時の権限は別です。ビルド結果は履歴と保存先で確認します。",
  },
  "m-builds-002": {
    introduction:
      "Cloud Buildで作った成果物を、別のサービスアカウントを使うGKEへ配置します。作成側はWriter、実行側はReaderに分けます。",
    steps: [
      CommonSteps.prepareCloudbuildArtifactregistryContainer,
      CommonSteps.registryAceImages,
      CommonSteps.createBuildIdentity,
      CommonSteps.submitCloudBuild,
      {
        title: "GKEノード用の実行主体を用意する",
        explanation: "ビルド用アカウントを使い回さず、イメージを取得する側にReaderだけを付けます。",
        actions: [
          {
            kind: "command",
            text: "gcloud iam service-accounts create ace-nodes",
          },
          {
            kind: "command",
            text: "gcloud iam service-accounts add-iam-policy-binding ace-nodes@ace-dev-01.iam.gserviceaccount.com --member=user:owner@example.com --role=roles/iam.serviceAccountUser",
          },
          {
            kind: "command",
            text: "gcloud artifacts repositories add-iam-policy-binding ace-images --location=us-central1 --member=serviceAccount:ace-nodes@ace-dev-01.iam.gserviceaccount.com --role=roles/artifactregistry.reader",
          },
          {
            kind: "command",
            text: "gcloud container clusters create-auto ace-gke --region=us-central1 --service-account=ace-nodes@ace-dev-01.iam.gserviceaccount.com",
          },
          {
            kind: "command",
            text: "gcloud container clusters get-credentials ace-gke --region=us-central1",
          },
        ],
        points: [
          {
            term: "ノードのサービスアカウント",
            description: "Podのイメージをリポジトリから取得するときに使う主体です。",
          },
          {
            term: "ReaderとWriter",
            description:
              "アプリ実行側には取得、ビルド側には登録が必要です。役割ごとに許可を絞ります。",
          },
        ],
        expected: "ace-gkeのノードがace-nodesを使い、対象イメージを取得できます。",
      },
      {
        title: "2つのPodと公開用Serviceを作る",
        explanation:
          "ビルドした完全名を指定し、2つのPodへ複製します。Serviceの入口80番をアプリの8080番へ接続します。",
        actions: [
          {
            kind: "command",
            text: "kubectl create deployment hello --image=us-central1-docker.pkg.dev/ace-dev-01/ace-images/hello:v1 --replicas=2",
          },
          {
            kind: "command",
            text: "kubectl rollout status deployment/hello",
          },
          {
            kind: "command",
            text: "kubectl expose deployment hello --type=LoadBalancer --port=80 --target-port=8080",
          },
          {
            kind: "command",
            text: "kubectl get all",
          },
        ],
        points: [
          {
            term: "--replicas=2",
            description: "アプリを実行するPodの目標数です。",
          },
          {
            term: "--portと--target-port",
            description:
              "portはServiceが受ける番号、target-portはPod内のアプリへ転送する番号です。",
          },
        ],
        expected: "helloの2レプリカが起動し、LoadBalancer Serviceが80→8080を公開しています。",
      },
    ],
    takeaway:
      "ビルドの権限とノードの取得権限を分けます。イメージを作れることと、Podから取得できることは同じではありません。",
  },
  "m-containers-004": {
    introduction:
      "v1とv2を両方保存し、利用者が参照するstableというタグだけを新しい版へ切り替えます。",
    steps: [
      CommonSteps.prepareArtifactregistry,
      CommonSteps.registryAceImages,
      {
        title: "v1をビルドしリモートへ登録する",
        explanation:
          "教材のソースからイメージをビルドし、配置先を含むタグ名でpushします。ローカルにあるだけではGKEから取得できません。",
        actions: [
          {
            kind: "command",
            text: "docker build -t us-central1-docker.pkg.dev/ace-dev-01/ace-images/hello:v1 ./hello-web",
          },
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
      {
        title: "stableを最初の版へ向ける",
        explanation: "まずstableがv1を指す状態を作ります。",
        actions: [
          {
            kind: "command",
            text: "gcloud artifacts docker tags add us-central1-docker.pkg.dev/ace-dev-01/ace-images/hello:v1 us-central1-docker.pkg.dev/ace-dev-01/ace-images/hello:stable",
          },
        ],
        points: [
          {
            term: "tags add",
            description:
              "リモートのイメージへタグを付けます。既にある移動先タグは参照先が更新されます。",
          },
        ],
        expected: "v1とstableが同じdigestを指します。",
      },
      {
        title: "v2をビルドしリモートへ登録する",
        explanation:
          "教材のソースからイメージをビルドし、配置先を含むタグ名でpushします。ローカルにあるだけではGKEから取得できません。",
        actions: [
          {
            kind: "command",
            text: "docker build -t us-central1-docker.pkg.dev/ace-dev-01/ace-images/hello:v2 ./hello-web-v2",
          },
          {
            kind: "command",
            text: "docker push us-central1-docker.pkg.dev/ace-dev-01/ace-images/hello:v2",
          },
          {
            kind: "command",
            text: "gcloud artifacts docker images list us-central1-docker.pkg.dev/ace-dev-01/ace-images --include-tags",
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
      {
        title: "stableだけをv2へ切り替える",
        explanation: "新しい版を登録できたので、stableの参照先をv2へ移します。",
        actions: [
          {
            kind: "command",
            text: "gcloud artifacts docker tags add us-central1-docker.pkg.dev/ace-dev-01/ace-images/hello:v2 us-central1-docker.pkg.dev/ace-dev-01/ace-images/hello:stable",
          },
          {
            kind: "command",
            text: "gcloud artifacts docker tags list us-central1-docker.pkg.dev/ace-dev-01/ace-images/hello",
          },
        ],
        points: [
          {
            term: "digestを比べる理由",
            description: "名前が違っても同じdigestなら同じ内容です。v2とstableの一致を確認します。",
          },
          {
            term: "v1を残す理由",
            description: "問題があったときに前の版を参照できるよう、旧版は削除しません。",
          },
        ],
        expected: "v2とstableのdigestが一致し、v1も残っています。",
      },
    ],
    takeaway:
      "タグはイメージの参照名、digestは内容の識別子です。stableを動かしてもv1の内容は残せます。",
  },
  "m-containers-005": {
    introduction:
      "開始時に用意された古いイメージとコンテナだけを片付け、保存用イメージを守ります。ローカルとリモートを別々に確認します。",
    steps: [
      {
        title: "削除対象と保存対象を確認する",
        explanation: "cleanup-localとold:v1を削除対象、keep:v2を残す対象として一覧を見ます。",
        actions: [
          {
            kind: "command",
            text: "docker ps -a",
          },
          {
            kind: "command",
            text: "docker images",
          },
          {
            kind: "command",
            text: "gcloud artifacts docker images list us-central1-docker.pkg.dev/ace-dev-01/cleanup-images --include-tags",
          },
        ],
        points: [
          {
            term: "-a",
            description: "停止中のコンテナも一覧に含めます。",
          },
          {
            term: "--include-tags",
            description: "リモートイメージのタグも表示し、oldとkeepを区別します。",
          },
        ],
        expected: "ローカルのcleanup-localと、リモートのold:v1・keep:v2が見つかります。",
      },
      {
        title: "教材のローカル実体とタグを片付ける",
        explanation: "実行を止めてからコンテナを削除し、対応するローカル参照も消します。",
        actions: [
          {
            kind: "command",
            text: "docker stop cleanup-local",
          },
          {
            kind: "command",
            text: "docker rm cleanup-local",
          },
          {
            kind: "command",
            text: "docker rmi cleanup-local:v1",
          },
        ],
        points: [
          {
            term: "stop / rm / rmi",
            description:
              "stopは実行停止、rmはコンテナ削除、rmiはローカルイメージの参照削除です。ほかのタグが同じ内容を使っていれば内容は保持されます。",
          },
        ],
        expected: "cleanup-localのコンテナとタグがなくなります。",
      },
      {
        title: "リモートの旧版だけを削除する",
        explanation: "タグだけでなく旧版の内容を削除し、リポジトリとkeepを残します。",
        actions: [
          {
            kind: "command",
            text: "gcloud artifacts docker tags delete us-central1-docker.pkg.dev/ace-dev-01/cleanup-images/old:v1 --quiet",
          },
          {
            kind: "command",
            text: "gcloud artifacts docker images delete us-central1-docker.pkg.dev/ace-dev-01/cleanup-images/old --quiet",
          },
          {
            kind: "command",
            text: "gcloud artifacts docker images list us-central1-docker.pkg.dev/ace-dev-01/cleanup-images --include-tags",
          },
        ],
        points: [
          {
            term: "tags delete",
            description: "タグを消しても、未タグの内容が残る場合があります。",
          },
          {
            term: "images delete …/old",
            description:
              "oldというイメージの内容を削除します。cleanup-imagesリポジトリ全体は削除しません。",
          },
        ],
        expected: "oldがなく、keep:v2とcleanup-imagesリポジトリが残っています。",
      },
    ],
    takeaway:
      "コンテナの停止、コンテナ削除、ローカルタグ削除、リモートタグ削除、リモート内容削除はそれぞれ別の操作です。",
  },
} satisfies Readonly<Record<string, MissionGuide>>;
