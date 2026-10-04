# GKEの更新・設定注入・ロールバック

Issue [#15](https://github.com/DIO0550/gcloud-sim/issues/15) の部分実装です。カテゴリから1つのミッションを選び、手順を順に開いて練習できます。実クラスタには接続しません。

## 更新と履歴

```sh
gcloud services enable container.googleapis.com
gcloud container clusters create-auto app --region=us-central1
kubectl create deployment web --image=nginx:1 --replicas=2
kubectl set image deployment/web web=nginx:2
kubectl rollout status deployment/web
kubectl rollout history deployment/web
kubectl rollout history deployment/web --revision=1
kubectl get rs
```

`set image`は単一Deployment・単一コンテナの指定に対応します。`deployment web web=IMAGE`と`deployment/web web=IMAGE`、コンテナ名の`*`を使えます。コンテナ名はDeployment名と同じです。同じイメージへの変更は何も更新しません。複数リソース/複数コンテナ、`--local`、`--dry-run`、任意manifestは未対応として拒否します。

Pod templateの更新はrevisionを増やし、履歴にイメージを保存します。`apply -f deployment.yaml`もイメージが変わったときだけrevisionを増やします。レプリカ数だけの変更はspecのgenerationを増やしますが、revisionや既存Podの識別子は変えません。`rollout restart`は同じイメージで新しいtemplateを作ります。

`get rs/replicasets`と`describe replicaset NAME`は保存した履歴からReplicaSetの名前・イメージ・レプリカ数を表示します。現行以外は0レプリカです。リソースツリーでDeploymentを選ぶと、プロパティに現在のrevision・更新履歴・Podを表示します。

## ロールバック

```sh
kubectl scale deployment/web --replicas=3
kubectl rollout undo deployment/web --to-revision=1
kubectl rollout status deployment/web
kubectl rollout history deployment/web
kubectl get deployments
```

undoは保存したtemplateへ戻し、現在のレプリカ数（この例では3）を維持します。戻したtemplateには新しいrevision番号を付け、以前のReplicaSetの識別子を再利用します。指定を省略するか`--to-revision=0`なら、保持している直前のrevisionへ戻します。現在のrevisionを指定した場合は変更しません。存在しない/保持していない番号では失敗します。

履歴は現在と過去10件のtemplateを保存します。上限を超える古いものは削除し、そこへは戻せません。表示するCHANGE-CAUSEは未対応のため`<none>`、IMAGE列は教材用の追加表示です。revision詳細は保存済みの単一コンテナのPod templateを表示します。

## 失敗からの復旧とPodの自己修復

「GKEのアプリを新しいイメージへ更新する」と「失敗したGKEの更新をロールバックする」の2ミッションを追加しています。どちらも初期Worldから解けます。後者はArtifact Registryに存在しない`hello:missing`へ更新し、ImagePullBackOffを確認してから、3レプリカを維持したまま履歴のv1へ戻します。新規作成だけ・取得権限不足・イメージを直接戻す操作だけでは対応する達成条件を満たしません。

Artifact Registryの取得可否は[CONTAINERS.md](CONTAINERS.md)の現在状態によるモデルを使います。更新要求の受付とPodの準備完了は別です。存在しないイメージへのset image自体は受け付け、get/describeで起動待ちを表示し、rollout statusは理由付きで失敗します。正常イメージへのundoで回復します。

`kubectl delete pod POD_NAME`は選んだPodだけを即座に作り直します。他のPod、revision、generation、ReplicaSetの識別子は維持します。restartとは別の処理です。新しいPod識別子は保存され、再読込しても同じ状態を復元します。

## ConfigMap・Secretと環境変数

```sh
kubectl create configmap app-config --from-literal=APP_MODE=staging --from-literal=LOG_LEVEL=info
kubectl create secret generic app-secret --from-literal=API_TOKEN=demo-token
kubectl set env deployment/web --from=configmap/app-config
kubectl set env deployment/web --from=secret/app-secret
kubectl set env deployment/web DEBUG=true
kubectl set env deployment/web DEBUG-
kubectl set env deployment/web --list
kubectl exec deployment/web -- printenv APP_MODE
```

ConfigMapは`cm/configmap/configmaps`、Secretは`secret/secrets`でget/describe/deleteできます。設定はプロジェクト・クラスタごとに分かれ、namespaceはdefaultのみです。クラスタ削除で設定も消えます。`--from-literal`は1キーずつ繰り返せ、値にカンマ・空文字・日本語を含められます。同じキーの重複はエラーです。名前は学習用にDNSラベル（63文字以内）、データは100キー/1 MiB以内に制限します。

`set env`は単一Deployment/単一コンテナのtemplateを変更します。直接の`KEY=VALUE`、削除`KEY-`、`--from=configmap/NAME|secret/NAME`を使えます。取込元を指定すると値そのものではなくキー参照を保存します。`--keys=KEY1,KEY2`で選択でき、`--prefix=APP_`で接頭辞を付けられます。取込キーは大文字にし、英数字とアンダースコア以外を`_`に変換します。変換後の衝突、存在しないキー、取得権限不足は変更前に拒否します。この教材の環境変数名は`[A-Za-z_][A-Za-z0-9_]*`、最大100個です。

環境変数の変更もrevisionを増やし、history詳細・ReplicaSet・Deploymentのプロパティに参照を表示します。同じ定義への再適用では増えません。undoは保存したイメージと環境変数定義を一緒に戻します。参照先の過去の値は履歴に含まれず、その時点の設定から新しいPodの値を決めます。

## 設定の変更と再起動

```sh
kubectl delete configmap app-config
kubectl create configmap app-config --from-literal=APP_MODE=production --from-literal=LOG_LEVEL=info
kubectl get configmap app-config -o yaml
kubectl exec deployment/web -- printenv APP_MODE
kubectl rollout restart deployment/web
kubectl exec deployment/web -- printenv APP_MODE
```

設定の変更だけでは起動済みPodの環境は変わりません。上の例は再起動前がstaging、再起動後がproductionです。スケールで増やしたPod・個別に削除して再作成したPodも新しい値を取得し、既存Podは元の値を保持します。起動済みの値は保存・再読込しても維持します。設定変更操作は今回delete→createで学習し、patch/edit/設定ファイルapplyは未対応です。

参照先やキーが欠けた新しいPodはCreateContainerConfigErrorとなり、get/describeに原因を表示します。既存の起動済みPodは動き続けるため、READYが1/2の状態も再現します。未起動Podのlogs/execとDeploymentのrollout statusは失敗します。足りないキーを作ると待機Podが即座に値を取得して起動します。再試行時間は再現しません。

`kubectl exec POD -- printenv [KEY]`または`env`は、この教材で注入した変数だけを表示します。`deployment/NAME`なら先頭Podです。シェルやコンテナ内の任意プログラムは実行しません。イメージ内蔵のENV、変数展開、volume、envFromの動的な全キー取込、複数コンテナは未対応です。環境取得は仮想Pod作成時に行い、イメージpullのタイミング・ノードキャッシュは従来の簡略モデルのままです。

「ConfigMapとSecretから環境変数を渡す」「ConfigMapの変更をPodの再起動で反映する」の2ミッションを追加し、GKEの追加ミッションは計4件です。

## Secretの表示と権限

Secretのget一覧・describe・プロパティは値を表示しません。getのJSON/YAMLはKubernetes同様にbase64表現のdataを返します。`set env --list`や履歴にはSecretの参照先だけを表示し、exec/printenvは起動時に取得した値を返します。base64は暗号化ではなく、保存データやコマンド履歴にも値が残ります。学習には架空の値を使用してください。

ConfigMap/Secretの操作はそれぞれ`container.configMaps.*`/`container.secrets.*`を検証します。`set env --from`にはDeployment更新と取込元getの両方、execには`container.pods.exec`が必要です。container.viewerはConfigMapとtemplateの参照を読めますが、Secret値の取得・exec・更新はできません。container.developer/adminは今回の操作に対応します。Kubernetes RBACやSecretの暗号化・安全な保管庫は再現しません。

## 権限・保存・再現範囲

- history/statusは`container.deployments.get`、set image/restart/undoは`container.deployments.update`を要求します。学習用のcontainer.viewerにDeployment/Pod/Serviceの読み取り権限を補い、更新権限と分離しました。クラスタ/API/プロジェクト/アカウントも検証します。
- namespaceはdefaultのみで、別namespaceを指定した操作は拒否します。`get -o json`はJSONの単一リソースまたはList、`-o yaml`は従来のYAML表示です。出力には教材用の列も含みます。
- Snapshot v10に履歴・Pod識別子・ConfigMap/Secret・template環境変数・起動時の値を保存します。v9からの移行は既存の履歴とPod識別子を保持し、空の設定/環境変数を補完します。v1〜v8は現在のイメージ・世代を1件の履歴として移行し、過去のイメージは推測しません。v8のDocker/レジストリ/ビルド履歴・ノードSA・Terraform状態を保持します。移行後に新しく更新した分からrollbackできます。
- PodはDeploymentから導出します。レプリカ上限はシミュレーターの表示・保存保護のため1000です。実際のKubernetesの上限を表す値ではありません。
- 即時に切り替わる簡略モデルです。ローリング更新中の旧/新Podの共存、maxSurge/maxUnavailable、スケジューラ、進行待ち・timeout、probe、実ネットワーク通信は再現しません。失敗した更新中に旧Podを稼働させ続ける動作も未対応です。
- ReplicaSetは読み取り専用の導出状態です。templateの識別子/Pod名は疑似値で、実際のハッシュ・annotationsは再現しません。イメージ変更/restartごとに新しいtemplateを作り、undoでは保存したtemplateを再利用します。
- `.pkg.dev`以外のイメージは従来の簡略な成功モデルです。実在タグ/コンテナの起動可否の確認はしません。異常系ミッションでは存在確認できる教材レジストリを使います。

namespace、ConfigMap/Secretのファイル/volumeマウント・任意manifest、readiness/liveness、HPA/VPA、StatefulSet/PVC、NetworkPolicy、ノードプール設定やWorkload Identity等は残作業です。Issue #15は閉じません。

参照: [ConfigMap](https://kubernetes.io/docs/concepts/configuration/configmap/)、[Secret](https://kubernetes.io/docs/concepts/configuration/secret/)、[kubectl set env](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_set/kubectl_set_env/)、[Deploymentの更新とロールバック](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)、[kubectl set image](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_set/kubectl_set_image/)、[kubectl rollout undo](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_undo/)、[GKEのロールと権限](https://docs.cloud.google.com/iam/docs/roles-permissions/container)。
