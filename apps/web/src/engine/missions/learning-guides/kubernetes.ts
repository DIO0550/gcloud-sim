import { CommonSteps } from "./common";
import type { MissionGuide } from "./model";

export const KubernetesGuides = {
  "m-gke-001": {
    introduction: "前の版が動いている状態からイメージをv2へ更新し、現在と過去の履歴を比べます。",
    steps: [
      CommonSteps.prepareArtifactregistryContainer,
      CommonSteps.registryReleaseImages,
      CommonSteps.buildReleaseVersions,
      CommonSteps.deployReleaseBaseline,
      {
        title: "イメージだけをv2へ更新する",
        explanation:
          "Deploymentのhelloコンテナに新しいイメージを指定します。Deployment名とコンテナ名を区別します。",
        actions: [
          {
            kind: "command",
            text: "kubectl set image deployment/hello hello=us-central1-docker.pkg.dev/ace-dev-01/release-images/hello:v2",
          },
          {
            kind: "command",
            text: "kubectl rollout status deployment/hello",
          },
        ],
        points: [
          {
            term: "deployment/hello",
            description: "変更するDeploymentの種類と名前です。",
          },
          {
            term: "hello=IMAGE",
            description: "Podの中でhelloという名前のコンテナを、指定イメージへ更新します。",
          },
        ],
        expected: "v2の2レプリカが起動し、更新完了になります。",
      },
      {
        title: "現在の版と以前の版を確認する",
        explanation: "更新に成功しても、以前のv1の情報が残っていることを確認します。",
        actions: [
          {
            kind: "command",
            text: "kubectl rollout history deployment/hello",
          },
          {
            kind: "command",
            text: "kubectl rollout history deployment/hello --revision=1",
          },
          {
            kind: "command",
            text: "kubectl get rs",
          },
        ],
        points: [
          {
            term: "--revision=1",
            description: "最初の版のPod定義を確認します。",
          },
          {
            term: "ReplicaSet (rs)",
            description:
              "Deploymentの各版のPod集合を管理するリソースです。履歴と対応して残ります。",
          },
        ],
        expected: "現在はv2、revision 1にはv1があり、過去と現在のReplicaSetを確認できます。",
      },
    ],
    takeaway: "DeploymentのPod定義を変えると新しいrevisionができ、前の版も履歴で確認できます。",
  },
  "m-gke-002": {
    introduction: "存在しないイメージへの更新をあえて行い、原因を観察してから以前の版へ戻します。",
    steps: [
      CommonSteps.prepareArtifactregistryContainer,
      CommonSteps.registryReleaseImages,
      CommonSteps.buildReleaseVersions,
      CommonSteps.deployReleaseBaseline,
      {
        title: "存在しないタグへ更新して原因を調べる",
        explanation:
          "missingというタグは登録していません。更新後のPodとDeploymentを読み、取得失敗を観察します。",
        actions: [
          {
            kind: "command",
            text: "kubectl set image deployment/hello hello=us-central1-docker.pkg.dev/ace-dev-01/release-images/hello:missing",
          },
          {
            kind: "command",
            text: "kubectl get pods",
          },
          {
            kind: "command",
            text: "kubectl describe deployment hello",
          },
          {
            kind: "command",
            text: "kubectl rollout status deployment/hello",
            expectFailure: true,
          },
        ],
        points: [
          {
            term: "ImagePullBackOff",
            description:
              "イメージを取得できず、再試行を待つ状態です。名前やタグ、取得権限を確認します。",
          },
          {
            term: "期待するエラー",
            description:
              "この手順のrollout statusは失敗します。正常なv1を削除せず、履歴から戻します。",
          },
        ],
        expected: "PodにImagePullBackOffが見られ、更新完了になりません。",
      },
      {
        title: "台数を変えた後、正常だった履歴へ戻す",
        explanation: "レプリカ数を3へ変更し、v1の履歴を指定してロールバックします。",
        actions: [
          {
            kind: "command",
            text: "kubectl scale deployment/hello --replicas=3",
          },
          {
            kind: "command",
            text: "kubectl rollout history deployment/hello",
          },
          {
            kind: "command",
            text: "kubectl rollout undo deployment/hello --to-revision=1",
          },
          {
            kind: "command",
            text: "kubectl rollout status deployment/hello",
          },
          {
            kind: "command",
            text: "kubectl get deployments",
          },
        ],
        points: [
          {
            term: "--to-revision=1",
            description:
              "初回のv1を明示します。続けて演習する場合はhistoryでv1の番号を確認します。",
          },
          {
            term: "scaleとPod定義",
            description:
              "台数の変更とイメージの更新は別の操作です。台数を増やすだけでは取得失敗は直りません。",
          },
        ],
        expected: "v1で3レプリカが起動し、失敗した版の履歴も残っています。",
      },
    ],
    takeaway:
      "ロールバックはPod定義を過去の版へ戻す操作です。この教材では現在のレプリカ数3を保ってイメージを戻します。",
  },
  "m-gke-006": {
    introduction:
      "Podが起動していてもServiceから接続できない状態を作り、イメージ更新とselector修正を別々に行います。",
    steps: [
      CommonSteps.prepareContainer,
      {
        title: "クラスタとkubectlの接続先を準備する",
        explanation:
          "クラスタを用意し、get-credentialsでkubectlの操作先を選びます。ファイルを使う演習では続いて教材テンプレートを読み込みます。",
        actions: [
          {
            kind: "command",
            text: "gcloud container clusters create-auto manifest-gke --region=us-central1",
          },
          {
            kind: "command",
            text: "gcloud container clusters get-credentials manifest-gke --region=us-central1",
          },
          {
            kind: "load",
            name: "kubernetes-workload",
            overwrite: true,
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
        expected:
          "kubectlの対象がmanifest-gkeです。ファイルタブで読み込んだYAMLのmetadata、specを開いて確認します。",
      },
      {
        title: "定義を適用し、接続先がない原因を調べる",
        explanation:
          "DeploymentとServiceを適用します。Podは起動しますが、Serviceのselectorはwrong-appのままです。",
        actions: [
          {
            kind: "command",
            text: "kubectl apply -f web-deployment.yaml",
          },
          {
            kind: "command",
            text: "kubectl apply -f web-service.yaml",
          },
          {
            kind: "command",
            text: "kubectl get pods",
          },
          {
            kind: "command",
            text: "kubectl describe service manifest-svc",
          },
        ],
        points: [
          {
            term: "Pod",
            description: "コンテナを実行するKubernetesの最小の配置単位です。",
          },
          {
            term: "selector",
            description: "Serviceが接続先として選ぶPodのラベル条件です。",
          },
        ],
        expected: "Podが起動していても、manifest-svcのEndpointsが<none>です。",
      },
      {
        title: "アプリを新しいイメージへ更新する",
        explanation:
          "web-deployment.yamlを変更し、保存したファイルとクラスタのイメージをそろえます。",
        actions: [
          {
            kind: "replace",
            name: "web-deployment.yaml",
            before: "nginx:1",
            after: "nginx:2",
          },
          {
            kind: "command",
            text: "kubectl apply -f web-deployment.yaml",
          },
          {
            kind: "command",
            text: "kubectl rollout history deployment/manifest-web",
          },
        ],
        points: [
          {
            term: "ファイル保存とapply",
            description: "ファイルの変更は手元の定義だけを変えます。applyでクラスタへ反映します。",
          },
        ],
        expected: "manifest-webがnginx:2へ更新され、新しい履歴ができます。",
      },
      {
        title: "ServiceのselectorをPodへ合わせる",
        explanation: "接続条件を実際のPodラベルへ修正し、同じServiceの接続先を復旧します。",
        actions: [
          {
            kind: "replace",
            name: "web-service.yaml",
            before: "wrong-app",
            after: "manifest-web",
          },
          {
            kind: "command",
            text: "kubectl apply -f web-service.yaml",
          },
          {
            kind: "command",
            text: "kubectl describe service manifest-svc",
          },
          {
            kind: "command",
            text: "kubectl rollout status deployment/manifest-web",
          },
        ],
        points: [
          {
            term: "Endpoints",
            description: "Serviceが選んだ、ReadyなPodの接続先です。",
          },
          {
            term: "Serviceを作り直さない理由",
            description: "selectorだけを更新するとServiceのIPを保ったまま接続先を直せます。",
          },
        ],
        expected: "manifest-svcに2つの接続先があり、nginx:2の2レプリカがReadyです。",
      },
    ],
    takeaway:
      "Serviceの接続先はPodラベルとselectorの一致で決まります。アプリの起動状態だけでは接続を判断できません。",
  },
  "m-gke-007": {
    introduction:
      "blueとgreenのアプリを並べて動かし、Serviceのラベル条件だけを変えて公開先を切り替えます。",
    steps: [
      CommonSteps.prepareContainer,
      {
        title: "クラスタとkubectlの接続先を準備する",
        explanation:
          "クラスタを用意し、get-credentialsでkubectlの操作先を選びます。ファイルを使う演習では続いて教材テンプレートを読み込みます。",
        actions: [
          {
            kind: "command",
            text: "gcloud container clusters create-auto labels-gke --region=us-central1",
          },
          {
            kind: "command",
            text: "gcloud container clusters get-credentials labels-gke --region=us-central1",
          },
          {
            kind: "load",
            name: "kubernetes-labels",
            overwrite: true,
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
        expected:
          "kubectlの対象がlabels-gkeです。ファイルタブで読み込んだYAMLのmetadata、specを開いて確認します。",
      },
      {
        title: "blueとgreenのPodを同時に用意する",
        explanation:
          "両方のDeploymentとServiceを適用し、まずblueへ公開されている状態を確認します。",
        actions: [
          {
            kind: "command",
            text: "kubectl apply -f shop-blue.yaml",
          },
          {
            kind: "command",
            text: "kubectl apply -f shop-green.yaml",
          },
          {
            kind: "command",
            text: "kubectl apply -f shop-service.yaml",
          },
          {
            kind: "command",
            text: "kubectl get pods -l app=shop",
          },
          {
            kind: "command",
            text: "kubectl get pods -l app=shop,track=blue",
          },
          {
            kind: "command",
            text: "kubectl describe service shop",
          },
        ],
        points: [
          {
            term: "-l app=shop,track=blue",
            description: "2つのラベルが両方一致するPodを選びます。カンマはORではありません。",
          },
          {
            term: "spec.template.metadata.labels",
            description:
              "Deploymentが作るPodのラベルです。Deployment自身のmetadata.labelsとは別です。",
          },
        ],
        expected: "blueとgreenが2レプリカずつあり、shop Serviceはblueだけを選びます。",
      },
      {
        title: "公開先の条件をgreenへ変更する",
        explanation: "Podを削除せず、Serviceのtrack条件だけを書き換えます。",
        actions: [
          {
            kind: "replace",
            name: "shop-service.yaml",
            before: "blue",
            after: "green",
          },
          {
            kind: "command",
            text: "kubectl apply -f shop-service.yaml",
          },
          {
            kind: "command",
            text: "kubectl describe service shop",
          },
          {
            kind: "command",
            text: "kubectl get pods -l app=shop,track=green",
          },
          {
            kind: "command",
            text: "kubectl get deployments -l team=storefront",
          },
        ],
        points: [
          {
            term: "selectorの変更",
            description:
              "Serviceの接続先の条件を変えます。Deploymentのselectorを変更する操作ではありません。",
          },
        ],
        expected: "ServiceのIPを保ったままgreenの2つのPodへ切り替わり、blueも残っています。",
      },
    ],
    takeaway: "Serviceの複数ラベル条件はANDです。Deployment自身のラベルとPodのラベルも区別します。",
  },
  "m-gke-008": {
    introduction:
      "CPUの必要量が上限を超える設定エラーを観察し、requestsとlimitsを正しい関係へ修正します。",
    steps: [
      CommonSteps.prepareContainer,
      {
        title: "クラスタとkubectlの接続先を準備する",
        explanation:
          "クラスタを用意し、get-credentialsでkubectlの操作先を選びます。ファイルを使う演習では続いて教材テンプレートを読み込みます。",
        actions: [
          {
            kind: "command",
            text: "gcloud container clusters create-auto resources-gke --region=us-central1",
          },
          {
            kind: "command",
            text: "gcloud container clusters get-credentials resources-gke --region=us-central1",
          },
          {
            kind: "load",
            name: "kubernetes-resources",
            overwrite: true,
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
        expected:
          "kubectlの対象がresources-gkeです。ファイルタブで読み込んだYAMLのmetadata、specを開いて確認します。",
      },
      {
        title: "矛盾するリソース設定を観察する",
        explanation: "最初のYAMLはCPU request 500m、limit 250mなので反映できません。",
        actions: [
          {
            kind: "command",
            text: "kubectl apply -f resource-web.yaml",
            expectFailure: true,
          },
        ],
        points: [
          {
            term: "request > limit",
            description: "必要と宣言したCPUが自分の上限を超えており、設定として矛盾しています。",
          },
        ],
        expected: "エラーになり、resource-webのDeploymentはまだ作成されません。",
      },
      {
        title: "CPUの必要量と上限を修正する",
        explanation:
          "requestを250m、limitを500mへ変更します。同じ数値の一括置換で取り違えないよう、一時値を使って順に入れ替えます。",
        actions: [
          {
            kind: "replace",
            name: "resource-web.yaml",
            before: "500m",
            after: "100m",
          },
          {
            kind: "replace",
            name: "resource-web.yaml",
            before: "250m",
            after: "500m",
          },
          {
            kind: "replace",
            name: "resource-web.yaml",
            before: "100m",
            after: "250m",
          },
          {
            kind: "command",
            text: "kubectl apply -f resource-web.yaml",
          },
          {
            kind: "command",
            text: "kubectl describe deployment resource-web",
          },
          {
            kind: "command",
            text: "kubectl get pods",
          },
        ],
        points: [
          {
            term: "250mと500m",
            description: "mはミリCPUです。250mは0.25 CPU、500mは0.5 CPUです。",
          },
          {
            term: "128Miと256Mi",
            description: "Miは1024×1024 bytes単位です。メモリのrequests/limitsはこの値を保ちます。",
          },
        ],
        expected:
          "CPU requests 250m・limits 500m、メモリrequests 128Mi・limits 256Miで2レプリカが起動します。",
      },
      {
        title: "変更履歴からリソース設定を戻す",
        explanation: "一度requestを300mへ変え、undoでファイルと一致する直前の設定へ戻します。",
        actions: [
          {
            kind: "command",
            text: "kubectl set resources deployment/resource-web --requests=cpu=300m",
          },
          {
            kind: "command",
            text: "kubectl rollout history deployment/resource-web",
          },
          {
            kind: "command",
            text: "kubectl rollout undo deployment/resource-web",
          },
          {
            kind: "command",
            text: "kubectl rollout status deployment/resource-web",
          },
        ],
        points: [
          {
            term: "set resources",
            description: "Pod定義のrequestsやlimitsを更新します。",
          },
          {
            term: "rollout undo",
            description: "イメージだけでなくPod定義のリソース設定も過去の版へ戻ります。",
          },
        ],
        expected: "最後はrequests CPU 250mで、YAMLとクラスタが一致しています。",
      },
    ],
    takeaway:
      "requestsは配置判断に使う必要量、limitsは利用上限です。1 Podあたりの設定で、実測値ではありません。",
  },
  "m-gke-011": {
    introduction: "3種類のリソース設定からPodのQoS分類がどう変わるかを比較します。",
    steps: [
      CommonSteps.prepareContainer,
      {
        title: "クラスタとkubectlの接続先を準備する",
        explanation:
          "クラスタを用意し、get-credentialsでkubectlの操作先を選びます。ファイルを使う演習では続いて教材テンプレートを読み込みます。",
        actions: [
          {
            kind: "command",
            text: "gcloud container clusters create qos-gke --zone=us-central1-a",
          },
          {
            kind: "command",
            text: "gcloud container clusters get-credentials qos-gke --zone=us-central1-a",
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
        expected: "kubectlの対象がqos-gkeです。ここからアプリを配置します。",
      },
      {
        title: "resources未指定のPodを用意する",
        explanation:
          "同じnginx:1でも、resourcesの設定によって分類が変わることを比較するため3つ作ります。",
        actions: [
          {
            kind: "command",
            text: "kubectl create deployment qos-best --image=nginx:1",
          },
          {
            kind: "command",
            text: "kubectl create deployment qos-burst --image=nginx:1",
          },
          {
            kind: "command",
            text: "kubectl create deployment qos-guaranteed --image=nginx:1",
          },
          {
            kind: "command",
            text: "kubectl get pods -o yaml",
          },
        ],
        points: [
          {
            term: "BestEffort",
            description: "CPU・メモリのrequest/limitを指定していないPodの分類です。",
          },
        ],
        expected: "最初は3種類ともBestEffortです。",
      },
      {
        title: "必要量と上限が異なるPodを作る",
        explanation: "qos-burstにCPU・メモリの必要量と、それより大きな上限を指定します。",
        actions: [
          {
            kind: "command",
            text: "kubectl set resources deployment/qos-burst --requests=cpu=250m,memory=128Mi --limits=cpu=500m,memory=256Mi",
          },
        ],
        points: [
          {
            term: "Burstable",
            description:
              "resourcesはありますが、CPU・メモリのrequestとlimitがすべて等しい条件にはなっていません。",
          },
        ],
        expected: "qos-burstのPodがBurstableです。",
      },
      {
        title: "CPUとメモリの必要量・上限をそろえる",
        explanation:
          "qos-guaranteedに両方のlimitを設定します。この演習では未指定requestが同じ値で補完されることを確認します。",
        actions: [
          {
            kind: "command",
            text: "kubectl set resources deployment/qos-guaranteed --limits=cpu=500m",
          },
          {
            kind: "command",
            text: "kubectl set resources deployment/qos-guaranteed --limits=memory=256Mi",
          },
          {
            kind: "command",
            text: "kubectl get pods -o json",
          },
        ],
        points: [
          {
            term: "Guaranteed",
            description:
              "CPUとメモリのrequestsとlimitsが指定され、それぞれ同じ値になるPodの分類です。",
          },
          {
            term: "CPUだけでは足りない理由",
            description: "CPUとメモリの両方をそろえる条件なので、CPUだけの設定ではBurstableです。",
          },
        ],
        expected: "qos-bestはBestEffort、qos-burstはBurstable、qos-guaranteedはGuaranteedです。",
      },
    ],
    takeaway:
      "QoSはCPU・メモリのrequests/limitsから決まる分類です。アプリの性能や無停止を保証する値ではありません。",
  },
  "m-gke-015": {
    introduction:
      "同名のwebやsettingsを2つのnamespaceへ分離し、stagingだけを更新して本番を保ちます。",
    steps: [
      CommonSteps.prepareContainer,
      {
        title: "クラスタとkubectlの接続先を準備する",
        explanation:
          "クラスタを用意し、get-credentialsでkubectlの操作先を選びます。ファイルを使う演習では続いて教材テンプレートを読み込みます。",
        actions: [
          {
            kind: "command",
            text: "gcloud container clusters create namespace-gke --zone=us-central1-a",
          },
          {
            kind: "command",
            text: "gcloud container clusters get-credentials namespace-gke --zone=us-central1-a",
          },
          {
            kind: "load",
            name: "kubernetes-namespace",
            overwrite: true,
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
        expected:
          "kubectlの対象がnamespace-gkeです。ファイルタブで読み込んだYAMLのmetadata、specを開いて確認します。",
      },
      {
        title: "2つの環境を別々に配置する",
        explanation:
          "先にnamespaceを作り、それぞれのYAMLに書かれたmetadata.namespaceへ配置します。",
        actions: [
          {
            kind: "command",
            text: "kubectl apply -f namespaces.yaml",
          },
          {
            kind: "command",
            text: "kubectl apply -f staging.yaml",
          },
          {
            kind: "command",
            text: "kubectl apply -f production.yaml",
          },
          {
            kind: "command",
            text: "kubectl get deployments -A",
          },
        ],
        points: [
          {
            term: "metadata.namespace",
            description: "そのリソースを配置するnamespaceです。",
          },
          {
            term: "-A",
            description:
              "すべてのnamespaceを横断して表示します。省略時のdefaultだけとは対象が異なります。",
          },
        ],
        expected: "stagingとproductionの両方にwebがあります。",
      },
      {
        title: "検証環境だけを更新する",
        explanation: "-nでstagingを明示し、イメージとレプリカ数を変更します。",
        actions: [
          {
            kind: "command",
            text: "kubectl set image deployment/web web=nginx:2 -n staging",
          },
          {
            kind: "command",
            text: "kubectl scale deployment/web --replicas=3 -n staging",
          },
        ],
        points: [
          {
            term: "-n staging",
            description: "同名の本番webではなく、stagingのwebだけを操作します。",
          },
        ],
        expected: "stagingはnginx:2・3レプリカ、本番は変更前のままです。",
      },
      {
        title: "環境ごとの設定と接続先を比較する",
        explanation: "各namespaceのConfigMap参照とServiceの接続先を確認します。",
        actions: [
          {
            kind: "command",
            text: "kubectl exec deployment/web -n staging -- printenv MODE",
          },
          {
            kind: "command",
            text: "kubectl exec deployment/web -n production -- printenv MODE",
          },
          {
            kind: "command",
            text: "kubectl describe service web-service -n staging",
          },
          {
            kind: "command",
            text: "kubectl describe service web-service -n production",
          },
          {
            kind: "command",
            text: "kubectl get deployments -A -o json",
          },
        ],
        points: [
          {
            term: "同じnamespace内の参照",
            description:
              "Podから参照するsettingsと、Serviceが選ぶPodはそれぞれのnamespace内で解決されます。",
          },
          {
            term: "revision 1",
            description: "本番のPod定義が初回のまま保たれている確認です。",
          },
        ],
        expected:
          "MODEはstaging/production、接続先は3つ/1つです。本番はnginx:1・1レプリカ・revision 1を保っています。",
      },
    ],
    takeaway:
      "namespaceはクラスタ内の名前と管理範囲を区切ります。同じ名前でもnamespaceが違えば別リソースです。",
  },
  "m-gke-028": {
    introduction:
      "ノードプールの台数変更、制御プレーンの更新、特定プールのノード更新を分けて操作します。",
    steps: [
      CommonSteps.prepareContainer,
      {
        title: "既定プールと追加プールを用意する",
        explanation: "default-poolは2ノード、追加のappsは4ノードとして構成を分けます。",
        actions: [
          {
            kind: "command",
            text: "gcloud container clusters create ops-gke --zone=us-central1-a --num-nodes=2",
          },
          {
            kind: "command",
            text: "gcloud container node-pools create apps --cluster=ops-gke --zone=us-central1-a --machine-type=e2-standard-4 --disk-size=200 --num-nodes=4",
          },
          {
            kind: "command",
            text: "gcloud container node-pools list --cluster=ops-gke --zone=us-central1-a",
          },
        ],
        points: [
          {
            term: "ノードプール",
            description: "同じ構成のworkerノードをまとめて管理する単位です。",
          },
          {
            term: "--cluster",
            description: "追加先のクラスタを指定します。",
          },
          {
            term: "--num-nodes",
            description: "このゾーンクラスタで対象プールに持たせるノード数です。",
          },
        ],
        expected: "default-poolは2、appsは4ノードです。",
      },
      {
        title: "appsだけを3ノードへ変更する",
        explanation: "クラスタ全体の名前だけでなく、対象プールを明示します。",
        actions: [
          {
            kind: "command",
            text: "gcloud container clusters resize ops-gke --zone=us-central1-a --node-pool=apps --num-nodes=3 --quiet",
          },
        ],
        points: [
          {
            term: "--node-pool=apps",
            description: "台数を変えるプールです。default-poolは変更しません。",
          },
          {
            term: "--quiet",
            description: "確認を省略するだけで、対象範囲を広げる意味ではありません。",
          },
        ],
        expected: "appsが3ノードになり、default-poolは2のままです。",
      },
      {
        title: "制御プレーンの後にappsを更新する",
        explanation: "先に管理側を更新し、それから指定したworkerノードプールだけを更新します。",
        actions: [
          {
            kind: "command",
            text: "gcloud container clusters upgrade ops-gke --zone=us-central1-a --master --quiet",
          },
          {
            kind: "command",
            text: "gcloud container clusters upgrade ops-gke --zone=us-central1-a --node-pool=apps --quiet",
          },
          {
            kind: "command",
            text: "gcloud container node-pools describe apps --cluster=ops-gke --zone=us-central1-a",
          },
          {
            kind: "command",
            text: "gcloud container node-pools describe default-pool --cluster=ops-gke --zone=us-central1-a",
          },
        ],
        points: [
          {
            term: "--master",
            description: "制御プレーンを更新する指定です。ノードプールを選ぶ指定とは別です。",
          },
          {
            term: "プールごとの版",
            description:
              "appsは1.32.2-gke.1182000、default-poolは元の1.31.5-gke.1068000を確認します。この教材の収録版です。",
          },
        ],
        expected: "appsは新しい版で3ノード、default-poolは元の版で2ノードです。",
      },
    ],
    takeaway:
      "制御プレーンとworkerノードは異なる管理対象です。制御プレーンを上げても全プールのノード版が同時に変わるわけではありません。",
  },
  "m-gke-040": {
    introduction:
      "リージョンクラスタのノード配置と、アプリのレプリカ数と、Serviceの接続先数をそれぞれ確認します。",
    steps: [
      CommonSteps.prepareContainer,
      {
        title: "3ゾーンへ1ノードずつ配置する",
        explanation: "リージョンを選び、workerを置く3つのゾーンを明示します。",
        actions: [
          {
            kind: "command",
            text: "gcloud container clusters create regional-gke --region=us-central1 --num-nodes=1 --node-locations=us-central1-a,us-central1-b,us-central1-c",
          },
          {
            kind: "command",
            text: "gcloud container clusters get-credentials regional-gke --region=us-central1",
          },
        ],
        points: [
          {
            term: "--region",
            description: "regionalクラスタを作成する指定です。",
          },
          {
            term: "--node-locations",
            description: "workerノードの配置先ゾーンです。",
          },
          {
            term: "--num-nodes=1",
            description: "各ゾーンに1ノードなので、この演習の総ノード数は1×3=3です。",
          },
        ],
        expected: "regional-gkeが3つのworker配置先を持ちます。",
      },
      {
        title: "アプリの3レプリカとServiceを配置する",
        explanation:
          "ノードを3つ作るだけではアプリが3つになるわけではありません。定義ファイルでPod数と公開先を設定します。",
        actions: [
          {
            kind: "load",
            name: "kubernetes-gke-final",
            overwrite: true,
          },
          {
            kind: "command",
            text: "kubectl apply -f regional-app.json",
          },
          {
            kind: "command",
            text: "kubectl apply -f regional-service.json",
          },
        ],
        points: [
          {
            term: "spec.replicas",
            description: "Deploymentが維持するPod数です。クラスタのノード数とは別に指定します。",
          },
        ],
        expected: "regional-appが3レプリカで動作します。",
      },
      {
        title: "配置・Pod・接続先を別々に確認する",
        explanation: "クラスタ、workerノード、Deployment、ServiceのEndpointsを順に見ます。",
        actions: [
          {
            kind: "command",
            text: "gcloud container clusters describe regional-gke --region=us-central1",
          },
          {
            kind: "command",
            text: "kubectl get nodes -o json",
          },
          {
            kind: "command",
            text: "kubectl get deployments",
          },
          {
            kind: "command",
            text: "kubectl describe service regional-app",
          },
        ],
        points: [
          {
            term: "Endpointsの数",
            description:
              "Serviceが選んだReadyなPodの接続先数です。ノードの数をそのまま数えているわけではありません。",
          },
        ],
        expected:
          "3ゾーンに3ノード、regional-appが3レプリカ、Serviceに3接続先があります。教材では実際の障害時再配置は行いません。",
      },
    ],
    takeaway:
      "ノード数とPod数は別の設定です。regionalクラスタの--num-nodesは配置先ゾーンごとの台数として扱います。",
  },
} satisfies Readonly<Record<string, MissionGuide>>;
