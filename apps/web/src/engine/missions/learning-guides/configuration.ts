import { CommonSteps } from "./common";
import type { MissionGuide } from "./model";

export const ConfigurationGuides = {
  "m-gke-003": {
    introduction:
      "設定の入れ物を作り、ConfigMapとSecretの値を参照して環境変数へ渡します。直接書いた変数とも比較します。",
    steps: [
      CommonSteps.prepareContainer,
      CommonSteps.createConfigCluster,
      CommonSteps.createConfigApplication,
      {
        title: "通常設定とSecretを作る",
        explanation: "公開してよいアプリ設定と、取り扱いを区別したい値を別の入れ物へ分けます。",
        actions: [
          {
            kind: "command",
            text: "kubectl create configmap app-config --from-literal=APP_MODE=production",
          },
          {
            kind: "command",
            text: "kubectl create secret generic app-secret --from-literal=API_TOKEN=demo-token",
          },
        ],
        points: [
          {
            term: "ConfigMap",
            description: "文字列の設定値などを名前とキーで保存するリソースです。",
          },
          {
            term: "Secret",
            description:
              "パスワードやトークンなど、アクセスを制限して扱う情報用のリソースです。ここでは架空のdemo-tokenだけを使います。",
          },
          {
            term: "--from-literal",
            description: "ファイルではなく、キー=値を直接与えて作成します。",
          },
        ],
        expected: "app-configとapp-secretが作られます。まだ作成だけではPodへ渡りません。",
      },
      {
        title: "設定を値の参照として渡す",
        explanation:
          "Deploymentへ値を直接書くのではなく、ConfigMapとSecretのキーを参照する構成を付けます。",
        actions: [
          {
            kind: "command",
            text: "kubectl set env deployment/config-web --from=configmap/app-config",
          },
          {
            kind: "command",
            text: "kubectl set env deployment/config-web --from=secret/app-secret",
          },
          {
            kind: "command",
            text: "kubectl set env deployment/config-web LOG_LEVEL=info",
          },
        ],
        points: [
          {
            term: "--from=configmap/…",
            description: "ConfigMapのキーを環境変数として参照させます。",
          },
          {
            term: "--from=secret/…",
            description:
              "Secretのキーを参照させます。Secretはアクセス制御して扱う情報の入れ物ですが、この演習は架空の値です。",
          },
          {
            term: "LOG_LEVEL=info",
            description: "この値だけは直接指定します。参照による設定との違いを確認します。",
          },
        ],
        expected: "APP_MODEとAPI_TOKENが参照で、LOG_LEVELが直接値として設定されます。",
      },
      {
        title: "参照とコンテナの値を確認する",
        explanation: "Deployment側の参照設定と、実行中コンテナが受け取った値をそれぞれ確認します。",
        actions: [
          {
            kind: "command",
            text: "kubectl set env deployment/config-web --list",
          },
          {
            kind: "command",
            text: "kubectl describe secret app-secret",
          },
          {
            kind: "command",
            text: "kubectl exec deployment/config-web -- printenv APP_MODE",
          },
          {
            kind: "command",
            text: "kubectl exec deployment/config-web -- printenv LOG_LEVEL",
          },
        ],
        points: [
          {
            term: "describe secret",
            description: "値そのものの代わりにキーとバイト数などを確認します。",
          },
          {
            term: "set env --list",
            description: "設定された環境変数や参照元を一覧にします。",
          },
        ],
        expected: "APP_MODE=production、LOG_LEVEL=infoで、API_TOKENはapp-secretのキー参照です。",
      },
    ],
    takeaway:
      "ConfigMapとSecretは設定の入れ物、Deploymentのenvはその使い方です。参照先と起動済みの値を分けて確認します。",
  },
  "m-gke-004": {
    introduction: "起動済みPodの環境変数と、後から更新したConfigMapの値が異なる状態を観察します。",
    steps: [
      CommonSteps.prepareContainer,
      CommonSteps.createConfigCluster,
      CommonSteps.createConfigApplication,
      {
        title: "最初の設定を参照させる",
        explanation:
          "まずstagingの値を持つConfigMapを参照させ、起動時に取り込まれる値を確認します。",
        actions: [
          {
            kind: "command",
            text: "kubectl create configmap app-config --from-literal=APP_MODE=staging",
          },
          {
            kind: "command",
            text: "kubectl set env deployment/config-web --from=configmap/app-config",
          },
          {
            kind: "command",
            text: "kubectl exec deployment/config-web -- printenv APP_MODE",
          },
        ],
        points: [
          {
            term: "--from=configmap/app-config",
            description: "Deploymentの環境変数をConfigMapのキー参照として設定します。",
          },
        ],
        expected: "PodのAPP_MODEはstagingです。",
      },
      {
        title: "設定だけを新しい値へ変更する",
        explanation:
          "この演習ではConfigMapを削除・再作成してproductionへ変更します。Podはまだ再起動しません。",
        actions: [
          {
            kind: "command",
            text: "kubectl delete configmap app-config",
          },
          {
            kind: "command",
            text: "kubectl create configmap app-config --from-literal=APP_MODE=production",
          },
          {
            kind: "command",
            text: "kubectl get configmap app-config -o yaml",
          },
          {
            kind: "command",
            text: "kubectl exec deployment/config-web -- printenv APP_MODE",
          },
        ],
        points: [
          {
            term: "ConfigMapとPodの違い",
            description: "ConfigMapに保存した現在の値と、Podが起動時に読み込んだ値は別々です。",
          },
        ],
        expected: "ConfigMapはproduction、起動済みPodはstagingのままです。",
      },
      CommonSteps.restartConfigApplication,
    ],
    takeaway:
      "環境変数は起動時に解決されます。ConfigMapの変更だけでは既存Podの環境変数は更新されません。",
  },
  "m-gke-005": {
    introduction:
      "YAMLを読み込んでConfigMapとSecretを作り、ファイル編集・apply・Pod再起動という3段階の違いを確認します。",
    steps: [
      CommonSteps.prepareContainer,
      CommonSteps.createConfigCluster,
      CommonSteps.createConfigApplication,
      {
        title: "YAMLから設定を作り参照させる",
        explanation:
          "ファイルタブでapp-config.yamlとapp-secret.yamlを開いてdataとstringDataを確認し、クラスタへ反映します。",
        actions: [
          {
            kind: "load",
            name: "kubernetes-config",
            overwrite: true,
          },
          {
            kind: "command",
            text: "kubectl apply -f app-config.yaml",
          },
          {
            kind: "command",
            text: "kubectl apply -f app-secret.yaml",
          },
          {
            kind: "command",
            text: "kubectl set env deployment/config-web --from=configmap/app-config",
          },
          {
            kind: "command",
            text: "kubectl set env deployment/config-web --from=secret/app-secret",
          },
        ],
        points: [
          {
            term: "dataとstringData",
            description:
              "ConfigMapの通常設定と、Secretへ文字列を入力する箇所です。この教材では実際の秘密情報を使いません。",
          },
          {
            term: "apply -f",
            description: "保存したファイルをクラスタの設定へ反映します。",
          },
        ],
        expected: "app-configのstagingとapp-secretのdemo-tokenがPodへ参照で渡されます。",
      },
      {
        title: "ファイルとConfigMapだけを更新する",
        explanation: "YAMLをproductionへ変更してapplyし、Podの値と比べます。",
        actions: [
          {
            kind: "replace",
            name: "app-config.yaml",
            before: "staging",
            after: "production",
          },
          {
            kind: "command",
            text: "kubectl apply -f app-config.yaml",
          },
          {
            kind: "command",
            text: "kubectl get configmap app-config -o yaml",
          },
          {
            kind: "command",
            text: "kubectl exec deployment/config-web -- printenv APP_MODE",
          },
        ],
        points: [
          {
            term: "編集だけでは反映されない理由",
            description:
              "ファイルの保存は定義の変更、applyはクラスタ設定の変更です。環境変数の更新にはさらにPodの再作成が必要です。",
          },
        ],
        expected: "YAMLとConfigMapはproduction、起動済みPodはstagingです。",
      },
      CommonSteps.restartConfigApplication,
      {
        title: "Secret参照も保持されていることを確認する",
        explanation: "再起動で片方の設定だけが欠けていないか確かめます。",
        actions: [
          {
            kind: "command",
            text: "kubectl exec deployment/config-web -- printenv API_TOKEN",
          },
          {
            kind: "command",
            text: "kubectl apply -f app-config.yaml",
          },
        ],
        points: [
          {
            term: "unchanged",
            description: "同じ定義を再度applyしても、差分がなければ更新されないことを表します。",
          },
        ],
        expected: "API_TOKENは教材値demo-tokenで、同じYAMLの再適用はunchangedです。",
      },
    ],
    takeaway: "ファイル、クラスタ上の設定、起動中Podの環境変数を別の状態として追います。",
  },
  "m-gke-016": {
    introduction:
      "コンテキストへ既定namespaceを保存し、-nを省略した操作がどの環境へ向くかを確かめます。",
    steps: [
      CommonSteps.prepareContainer,
      {
        title: "クラスタとkubectlの接続先を準備する",
        explanation:
          "クラスタを用意し、get-credentialsでkubectlの操作先を選びます。ファイルを使う演習では続いて教材テンプレートを読み込みます。",
        actions: [
          {
            kind: "command",
            text: "gcloud container clusters create context-gke --zone=us-central1-a",
          },
          {
            kind: "command",
            text: "gcloud container clusters get-credentials context-gke --zone=us-central1-a",
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
        expected: "kubectlの対象がcontext-gkeです。ここからアプリを配置します。",
      },
      {
        title: "同名アプリを2つの環境へ作る",
        explanation: "stagingとproductionの両方にwebを作ります。",
        actions: [
          {
            kind: "command",
            text: "kubectl create namespace staging",
          },
          {
            kind: "command",
            text: "kubectl create namespace production",
          },
          {
            kind: "command",
            text: "kubectl create deployment web --image=nginx:1 -n staging",
          },
          {
            kind: "command",
            text: "kubectl create deployment web --image=nginx:1 -n production",
          },
        ],
        points: [
          {
            term: "namespace",
            description: "クラスタ内の名前の範囲です。同名のwebを環境ごとに独立して配置できます。",
          },
        ],
        expected: "両namespaceにnginx:1・1レプリカのwebがあります。",
      },
      {
        title: "既定の操作先をstagingへ切り替える",
        explanation: "コンテキストへnamespaceを設定し、省略時の接続先を変えます。",
        actions: [
          {
            kind: "command",
            text: "kubectl config set-context --current --namespace=staging",
          },
          {
            kind: "command",
            text: "kubectl config get-contexts",
          },
          {
            kind: "command",
            text: "kubectl set image deployment/web web=nginx:2",
          },
          {
            kind: "command",
            text: "kubectl scale deployment/web --replicas=2",
          },
        ],
        points: [
          {
            term: "--current",
            description: "現在選んでいるコンテキストを変更します。",
          },
          {
            term: "--namespace=staging",
            description:
              "以後-nを省略した場合のnamespaceを設定します。クラスタ自体を作り直す操作ではありません。",
          },
        ],
        expected: "NAMESPACE列がstagingで、省略した操作は検証環境だけに反映されます。",
      },
      {
        title: "本番を確認して既定値を本番へ戻す",
        explanation:
          "明示した-nが既定値より優先することと、本番が更新されていないことを確認します。",
        actions: [
          {
            kind: "command",
            text: "kubectl get deployment web -n production -o json",
          },
          {
            kind: "command",
            text: "kubectl config set-context --current --namespace=production",
          },
          {
            kind: "command",
            text: "kubectl get deployment web -o json",
          },
          {
            kind: "command",
            text: "kubectl get deployments -A",
          },
        ],
        points: [
          {
            term: "-n production",
            description: "既定がstagingでも、このコマンドだけ本番を参照します。",
          },
          {
            term: "コンテキストの保存値",
            description: "最後にproductionを既定にすると、次の省略したgetも本番を参照します。",
          },
        ],
        expected:
          "本番はnginx:1・1レプリカ・revision 1、stagingはnginx:2・2レプリカです。最後の既定namespaceはproductionです。",
      },
    ],
    takeaway:
      "コンテキストごとの既定namespaceと、コマンドで明示する-nを区別します。明示した-nが優先されます。",
  },
  "m-gke-017": {
    introduction: "ConfigMapとSecretの値は変えず、ラベルを使って設定を環境ごとに分類します。",
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
            name: "kubernetes-config-labels",
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
        title: "設定と利用中のアプリを確認する",
        explanation: "教材の設定とwebを適用し、誤ったラベルと変更してはいけない値を見分けます。",
        actions: [
          {
            kind: "command",
            text: "kubectl apply -f labeled-configs.yaml",
          },
          {
            kind: "command",
            text: "kubectl get cm -o yaml",
          },
          {
            kind: "command",
            text: "kubectl describe secret credentials",
          },
        ],
        points: [
          {
            term: "cm",
            description: "ConfigMapの短縮名です。",
          },
          {
            term: "metadata.labelsとdata",
            description: "ラベルは検索用の分類、dataはアプリが利用する設定値です。",
          },
        ],
        expected: "settings-prodに誤ったenvironment=stagingとtemporaryがあり、webは初回の版です。",
      },
      {
        title: "環境ラベルを付け、不要なラベルを外す",
        explanation:
          "既存値を書き換えるsettings-prodだけに--overwriteを付け、temporaryを削除します。",
        actions: [
          {
            kind: "command",
            text: "kubectl label cm settings-dev app=web environment=staging",
          },
          {
            kind: "command",
            text: "kubectl label cm settings-prod app=web environment=production --overwrite",
          },
          {
            kind: "command",
            text: "kubectl label cm/settings-prod temporary-",
          },
          {
            kind: "command",
            text: "kubectl label secret/credentials app=web environment=production",
          },
        ],
        points: [
          {
            term: "--overwrite",
            description: "既存ラベルを異なる値へ変更するときに明示します。",
          },
          {
            term: "temporary-",
            description: "キーの末尾に-を付けると、そのラベルを削除します。",
          },
        ],
        expected: "3つの設定にapp=webがあり、environmentはstaging/productionへ分類されています。",
      },
      {
        title: "ラベル検索と設定値の保持を確認する",
        explanation: "検索結果だけでなく、アプリ側の値とrevisionが変わっていないことを見ます。",
        actions: [
          {
            kind: "command",
            text: "kubectl get cm -l app=web,environment=production",
          },
          {
            kind: "command",
            text: "kubectl get secrets -l environment=production",
          },
          {
            kind: "command",
            text: "kubectl exec deployment/web -- printenv MODE",
          },
          {
            kind: "command",
            text: "kubectl get deployment web -o json",
          },
        ],
        points: [
          {
            term: "-lの複数条件",
            description: "カンマで区切った条件をすべて満たすリソースを選びます。",
          },
          {
            term: "revisionを保つ理由",
            description: "設定の分類を変えただけなので、Pod定義の更新や再起動は不要です。",
          },
        ],
        expected:
          "本番用設定だけが見つかり、データとwebのnginx:1・1レプリカ・revision 1が保たれています。",
      },
    ],
    takeaway:
      "metadata.labelsは分類の情報です。ConfigMapのdataやPodへ渡す環境変数そのものではありません。",
  },
  "m-gke-018": {
    introduction:
      "immutableな設定を直接更新すると失敗することを確認し、設定の再作成とPod再起動を分けて反映します。",
    steps: [
      CommonSteps.prepareContainer,
      {
        title: "クラスタとkubectlの接続先を準備する",
        explanation:
          "クラスタを用意し、get-credentialsでkubectlの操作先を選びます。ファイルを使う演習では続いて教材テンプレートを読み込みます。",
        actions: [
          {
            kind: "command",
            text: "gcloud container clusters create-auto immutable-gke --region=us-central1",
          },
          {
            kind: "command",
            text: "gcloud container clusters get-credentials immutable-gke --region=us-central1",
          },
          {
            kind: "load",
            name: "kubernetes-immutable",
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
          "kubectlの対象がimmutable-gkeです。ファイルタブで読み込んだYAMLのmetadata、specを開いて確認します。",
      },
      {
        title: "変更不可の設定をアプリへ渡す",
        explanation:
          "ConfigMapとSecretにimmutable: trueがあることを確認し、参照するアプリを配置します。",
        actions: [
          {
            kind: "command",
            text: "kubectl apply -f frozen-settings.yaml",
          },
          {
            kind: "command",
            text: "kubectl apply -f frozen-credentials.yaml",
          },
          {
            kind: "command",
            text: "kubectl apply -f frozen-web.yaml",
          },
          {
            kind: "command",
            text: "kubectl get cm frozen-settings -o yaml",
          },
          {
            kind: "command",
            text: "kubectl describe secret frozen-credentials",
          },
        ],
        points: [
          {
            term: "immutable: true",
            description: "このリソースのdataを後から更新できない設定です。",
          },
          {
            term: "キー参照",
            description: "frozen-webはMODEとTOKENを設定リソースのキーから読みます。",
          },
        ],
        expected: "2レプリカがstagingとdemo-token-v1で起動します。",
      },
      {
        title: "ファイルを変更し、直接更新の失敗を見る",
        explanation:
          "immutableを維持したまま値を更新しようとします。ファイル変更は可能でも、クラスタのdata更新は拒否されます。",
        actions: [
          {
            kind: "replace",
            name: "frozen-settings.yaml",
            before: "staging",
            after: "production",
          },
          {
            kind: "replace",
            name: "frozen-credentials.yaml",
            before: "demo-token-v1",
            after: "demo-token-v2",
          },
          {
            kind: "command",
            text: "kubectl apply -f frozen-settings.yaml",
            expectFailure: true,
          },
          {
            kind: "command",
            text: "kubectl apply -f frozen-credentials.yaml",
            expectFailure: true,
          },
        ],
        points: [
          {
            term: "data is immutable",
            description:
              "変更不可のデータを更新しようとしたエラーです。immutableをfalseへ戻す更新もできません。",
          },
        ],
        expected: "applyが失敗し、クラスタ上の設定は旧値のままです。",
      },
      {
        title: "設定の入れ物を削除して作り直す",
        explanation:
          "同じ名前で新しい設定を作り直します。既存Podの環境変数は、この時点では変わりません。",
        actions: [
          {
            kind: "command",
            text: "kubectl delete -f frozen-settings.yaml",
          },
          {
            kind: "command",
            text: "kubectl apply -f frozen-settings.yaml",
          },
          {
            kind: "command",
            text: "kubectl delete -f frozen-credentials.yaml",
          },
          {
            kind: "command",
            text: "kubectl apply -f frozen-credentials.yaml",
          },
          {
            kind: "command",
            text: "kubectl exec deployment/frozen-web -- printenv MODE",
          },
          {
            kind: "command",
            text: "kubectl exec deployment/frozen-web -- printenv TOKEN",
          },
        ],
        points: [
          {
            term: "再作成と環境変数",
            description:
              "参照先が新しくなっても、起動時に取り込んだPodの環境変数は旧値を保持します。",
          },
        ],
        expected: "設定は新値ですが、Podはstagingとdemo-token-v1です。",
      },
      {
        title: "Podを再起動して新しい値を確認する",
        explanation: "新しい設定を起動時に読ませ、2つのPodを更新します。",
        actions: [
          {
            kind: "command",
            text: "kubectl rollout restart deployment/frozen-web",
          },
          {
            kind: "command",
            text: "kubectl rollout status deployment/frozen-web",
          },
          {
            kind: "command",
            text: "kubectl exec deployment/frozen-web -- printenv MODE",
          },
          {
            kind: "command",
            text: "kubectl exec deployment/frozen-web -- printenv TOKEN",
          },
        ],
        points: [
          {
            term: "rollout restart",
            description: "Deployment配下のPodを作り直し、設定参照を新たに解決します。",
          },
        ],
        expected:
          "Podがproductionとdemo-token-v2を読み、ファイルとクラスタのimmutable: trueも保たれています。",
      },
    ],
    takeaway:
      "immutableはデータの変更を禁止します。再作成できても、既存Podの環境変数は別途更新が必要です。",
  },
  "m-gke-019": {
    introduction:
      "ConfigMapのテキストとバイナリを区別し、環境変数が誤ってバイナリキーを参照している設定を修正します。",
    steps: [
      CommonSteps.prepareContainer,
      {
        title: "クラスタとkubectlの接続先を準備する",
        explanation:
          "クラスタを用意し、get-credentialsでkubectlの操作先を選びます。ファイルを使う演習では続いて教材テンプレートを読み込みます。",
        actions: [
          {
            kind: "command",
            text: "gcloud container clusters create-auto binary-gke --region=us-central1",
          },
          {
            kind: "command",
            text: "gcloud container clusters get-credentials binary-gke --region=us-central1",
          },
          {
            kind: "load",
            name: "kubernetes-binary-data",
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
          "kubectlの対象がbinary-gkeです。ファイルタブで読み込んだYAMLのmetadata、specを開いて確認します。",
      },
      {
        title: "起動できないPodの原因を調べる",
        explanation: "両方の設定を適用し、環境変数の参照先とConfigMapの内容を比較します。",
        actions: [
          {
            kind: "command",
            text: "kubectl apply -f asset-settings.yaml",
          },
          {
            kind: "command",
            text: "kubectl apply -f asset-web.yaml",
          },
          {
            kind: "command",
            text: "kubectl get pods",
          },
          {
            kind: "command",
            text: "kubectl get cm asset-settings -o yaml",
          },
          {
            kind: "command",
            text: "kubectl describe cm asset-settings",
          },
        ],
        points: [
          {
            term: "CreateContainerConfigError",
            description: "コンテナを起動するための設定を用意できない状態です。",
          },
          {
            term: "binaryData",
            description:
              "asset.binは非UTF-8の4 bytesです。describeではバイト数、get -o yamlではbase64表現を確認します。",
          },
        ],
        expected: "asset-webが誤ってasset.binを環境変数へ参照しているため起動できません。",
      },
      {
        title: "参照をテキストのキーへ修正する",
        explanation: "バイナリ自体は削除せず、Deploymentの参照先だけをMODEへ変えます。",
        actions: [
          {
            kind: "replace",
            name: "asset-web.yaml",
            before: "key: asset.bin",
            after: "key: MODE",
          },
          {
            kind: "command",
            text: "kubectl apply -f asset-web.yaml",
          },
          {
            kind: "command",
            text: "kubectl rollout status deployment/asset-web",
          },
          {
            kind: "command",
            text: "kubectl exec deployment/asset-web -- printenv MODE",
          },
        ],
        points: [
          {
            term: "configMapKeyRefのkey",
            description:
              "どのキーを環境変数へ渡すかを指定します。MODEはConfigMapのdataにある文字列です。",
          },
        ],
        expected:
          "2レプリカがReadyとなりMODE=productionです。ConfigMapにはdataとbinaryDataが両方残っています。",
      },
    ],
    takeaway:
      "ConfigMapのdataは文字列設定、binaryDataはbase64で表すバイナリです。環境変数への参照に使うキーを分けます。",
  },
  "m-gke-020": {
    introduction:
      "設定をファイルとしてコンテナへ配置するvolumeで、存在しないキーの指定を見つけて修正します。",
    steps: [
      CommonSteps.prepareContainer,
      {
        title: "クラスタとkubectlの接続先を準備する",
        explanation:
          "クラスタを用意し、get-credentialsでkubectlの操作先を選びます。ファイルを使う演習では続いて教材テンプレートを読み込みます。",
        actions: [
          {
            kind: "command",
            text: "gcloud container clusters create-auto volume-gke --region=us-central1",
          },
          {
            kind: "command",
            text: "gcloud container clusters get-credentials volume-gke --region=us-central1",
          },
          {
            kind: "load",
            name: "kubernetes-volumes",
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
          "kubectlの対象がvolume-gkeです。ファイルタブで読み込んだYAMLのmetadata、specを開いて確認します。",
      },
      {
        title: "ファイル配置が失敗する状態を観察する",
        explanation:
          "ConfigMapとSecretを用意してアプリを適用し、Podの状態と参照の設定を確認します。",
        actions: [
          {
            kind: "command",
            text: "kubectl apply -f volume-settings.yaml",
          },
          {
            kind: "command",
            text: "kubectl apply -f volume-credentials.yaml",
          },
          {
            kind: "command",
            text: "kubectl apply -f volume-web.yaml",
          },
          {
            kind: "command",
            text: "kubectl get pods",
          },
          {
            kind: "command",
            text: "kubectl describe deployment volume-web",
          },
          {
            kind: "command",
            text: "kubectl get deployment volume-web -o yaml",
          },
        ],
        points: [
          {
            term: "FailedMount",
            description: "volumeで指定した内容をコンテナへ配置できない状態です。",
          },
          {
            term: "volumes / items / volumeMounts",
            description: "何を使うか、どのキーを選ぶか、どのパスへ配置するかを順に追います。",
          },
        ],
        expected: "itemsに存在しないmissing.confがあり、Podが起動準備中で止まっています。",
      },
      {
        title: "存在するキーへ直して再適用する",
        explanation: "volume-web.yamlの参照キーをConfigMap内のapp.confへ合わせます。",
        actions: [
          {
            kind: "replace",
            name: "volume-web.yaml",
            before: "key: missing.conf",
            after: "key: app.conf",
          },
          {
            kind: "command",
            text: "kubectl apply -f volume-web.yaml",
          },
          {
            kind: "command",
            text: "kubectl rollout status deployment/volume-web",
          },
        ],
        points: [
          {
            term: "itemsのkey",
            description: "ConfigMap内のキーです。コンテナのファイルパスと同じとは限りません。",
          },
        ],
        expected: "2レプリカがReadyになります。",
      },
      {
        title: "配置された3つのファイルを読む",
        explanation: "テキスト、バイナリ、Secretそれぞれの配置先を確認します。",
        actions: [
          {
            kind: "command",
            text: "kubectl exec deployment/volume-web -- cat /etc/app/app.conf",
          },
          {
            kind: "command",
            text: "kubectl exec deployment/volume-web -- base64 /etc/app/assets/asset.bin",
          },
          {
            kind: "command",
            text: "kubectl exec deployment/volume-web -- cat /etc/credentials/TOKEN",
          },
        ],
        points: [
          {
            term: "base64",
            description:
              "バイナリを表示可能な文字列として読みます。AP+AAQ==はこの教材の4 bytesを表します。",
          },
          {
            term: "Secretのvolume",
            description:
              "Secretのキーを環境変数ではなくファイルとして使えます。ここでは架空の値です。",
          },
        ],
        expected: "app.confはproduction、asset.binはAP+AAQ==、TOKENはdemo-volume-tokenです。",
      },
    ],
    takeaway:
      "volumeは設定の参照元、volumeMountはコンテナ内の配置先です。itemsは参照元のキーとファイル名を対応付けます。",
  },
  "m-gke-021": {
    introduction:
      "同じConfigMapを通常のvolume、subPath、環境変数の3通りで使い、更新の反映方法を比較します。",
    steps: [
      CommonSteps.prepareContainer,
      {
        title: "クラスタとkubectlの接続先を準備する",
        explanation:
          "クラスタを用意し、get-credentialsでkubectlの操作先を選びます。ファイルを使う演習では続いて教材テンプレートを読み込みます。",
        actions: [
          {
            kind: "command",
            text: "gcloud container clusters create-auto reload-gke --region=us-central1",
          },
          {
            kind: "command",
            text: "gcloud container clusters get-credentials reload-gke --region=us-central1",
          },
          {
            kind: "load",
            name: "kubernetes-volume-refresh",
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
          "kubectlの対象がreload-gkeです。ファイルタブで読み込んだYAMLのmetadata、specを開いて確認します。",
      },
      {
        title: "同じ設定を3つの方法で受け取る",
        explanation: "ConfigMapとアプリを配置し、最初の値を確認します。",
        actions: [
          {
            kind: "command",
            text: "kubectl apply -f reload-settings.yaml",
          },
          {
            kind: "command",
            text: "kubectl apply -f reload-web.yaml",
          },
          {
            kind: "command",
            text: "kubectl exec deployment/reload-web -- cat /etc/config/MODE",
          },
        ],
        points: [
          {
            term: "通常のvolume",
            description: "ConfigMapをディレクトリとして配置します。",
          },
          {
            term: "subPath",
            description:
              "volume内の1つのパスだけを切り出して配置する設定です。通常マウントと更新の挙動が異なります。",
          },
        ],
        expected: "最初のMODEはstagingです。",
      },
      {
        title: "ConfigMapの更新後に3つの値を比べる",
        explanation: "productionへ変更してapplyします。Podの再起動はまだ行いません。",
        actions: [
          {
            kind: "replace",
            name: "reload-settings.yaml",
            before: "MODE: staging",
            after: "MODE: production",
          },
          {
            kind: "command",
            text: "kubectl apply -f reload-settings.yaml",
          },
          {
            kind: "command",
            text: "kubectl exec deployment/reload-web -- cat /etc/config/MODE",
          },
          {
            kind: "command",
            text: "kubectl exec deployment/reload-web -- cat /etc/mode.conf",
          },
          {
            kind: "command",
            text: "kubectl exec deployment/reload-web -- printenv MODE",
          },
        ],
        points: [
          {
            term: "更新の違い",
            description:
              "通常マウントは設定更新を反映しますが、subPathと起動時の環境変数はstagingを保持します。",
          },
          {
            term: "教材と実環境の差",
            description:
              "この教材の通常マウントはapply直後に反映します。実際の更新遅延は再現しません。",
          },
        ],
        expected: "/etc/config/MODEだけがproductionで、/etc/mode.confと環境変数MODEはstagingです。",
      },
      {
        title: "Podを作り直して値をそろえる",
        explanation: "subPathと環境変数も新しい設定から取得し直すため、Podを再作成します。",
        actions: [
          {
            kind: "command",
            text: "kubectl rollout restart deployment/reload-web",
          },
          {
            kind: "command",
            text: "kubectl rollout status deployment/reload-web",
          },
          {
            kind: "command",
            text: "kubectl exec deployment/reload-web -- cat /etc/config/MODE",
          },
          {
            kind: "command",
            text: "kubectl exec deployment/reload-web -- cat /etc/mode.conf",
          },
          {
            kind: "command",
            text: "kubectl exec deployment/reload-web -- printenv MODE",
          },
        ],
        points: [
          {
            term: "再起動する目的",
            description:
              "遅延を待つためではなく、起動時に取り込む値やsubPathの配置を新しいPodで解決し直します。",
          },
        ],
        expected: "2レプリカがReadyとなり、3つの値がすべてproductionです。",
      },
    ],
    takeaway:
      "設定の値が変わったときの動作は使い方によって異なります。通常マウントとsubPath・環境変数を区別します。",
  },
} satisfies Readonly<Record<string, MissionGuide>>;
