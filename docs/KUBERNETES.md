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

`set image`は単一Deployment・単一コンテナの指定に対応します。`deployment web web=IMAGE`と`deployment/web web=IMAGE`、コンテナ名の`*`を使えます。コンテナ名はDeployment名と同じです。同じイメージへの変更は何も更新しません。複数リソース/複数コンテナ、`--local`、`--dry-run`は未対応として拒否します。仮想manifestの対応範囲は後述します。

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

設定の変更だけでは起動済みPodの環境は変わりません。上の例は再起動前がstaging、再起動後がproductionです。スケールで増やしたPod・個別に削除して再作成したPodも新しい値を取得し、既存Podは元の値を保持します。起動済みの値は保存・再読込しても維持します。delete→createのほか、以下の設定ファイルapplyでも変更できます。patch/editは未対応です。

参照先やキーが欠けた新しいPodはCreateContainerConfigErrorとなり、get/describeに原因を表示します。既存の起動済みPodは動き続けるため、READYが1/2の状態も再現します。未起動Podのlogs/execとDeploymentのrollout statusは失敗します。足りないキーを作ると待機Podが即座に値を取得して起動します。再試行時間は再現しません。

`kubectl exec POD -- printenv [KEY]`または`env`は、この教材で注入した変数だけを表示します。`deployment/NAME`なら先頭Podです。シェルやコンテナ内の任意プログラムは実行しません。イメージ内蔵のENV、変数展開、volume、envFromの動的な全キー取込、複数コンテナは未対応です。環境取得は仮想Pod作成時に行い、イメージpullのタイミング・ノードキャッシュは従来の簡略モデルのままです。

「ConfigMapとSecretから環境変数を渡す」「ConfigMapの変更をPodの再起動で反映する」の2ミッションを追加し、GKEの追加ミッションは計4件です。

## 設定ファイルの編集とapply

```sh
sim files load kubernetes-config
sim files read app-config.yaml
sim files read app-secret.yaml
kubectl apply -f app-config.yaml
kubectl apply -f app-secret.yaml
kubectl set env deployment/web --from=configmap/app-config
sim files replace app-config.yaml --search=staging --replacement=production
kubectl apply -f app-config.yaml
kubectl exec deployment/web -- printenv APP_MODE
kubectl rollout restart deployment/web
kubectl exec deployment/web -- printenv APP_MODE
```

`sim files`は実際のkubectlコマンドではなく、ブラウザ内の学習用ファイル操作です。上の手順は前節のクラスタとDeploymentを使います。新ミッション「設定ファイルをapplyしてPodへ反映する」は初期Worldからも実施できます。ミッションは全43件、GKE拡充分は6件です。

`sim files write FILE --content='…'`で独自のYAML/JSONを書き、`read`で読み、`replace --search=… --replacement=…`で1か所を編集できます。ファイルは `.yaml` / `.yml` / `.json` の相対パスで、32ファイル・1ファイル64,000文字まで。Terraformとは別に保存し、Terraformのplanに影響しません。`sim files delete FILE`はファイルだけを消します。クラスタ上の設定を消す操作は `kubectl delete -f FILE` です。教材の上書きは `sim files load kubernetes-config --force` で明示します。

対応するmanifestは `apiVersion: v1` のConfigMapとOpaque Secretです。`metadata.name`と任意の`metadata.namespace: default`、ConfigMapの文字列`data`、Secretのbase64 `data`と平文`stringData`を読みます。同じキーではstringDataを優先し、取得時はbase64 dataで返します。Secretの内容はUTF-8のみ。YAMLは数値・booleanを自動で文字列へ変換しないため、文字列の値は必要に応じて引用符で囲みます。複数行文字列と `---` 区切りの最大32リソースも使えます。

`create -f`は新規作成専用で、既存なら失敗します。`apply -f`は作成または更新し、同じ構成の再適用はunchangedです。前回applyで管理したキーをファイルから取り除くとそのキーを削除し、applyで管理していない既存キーは保持します。設定の作成日時と既存Podは維持し、起動時の値は再起動で更新します。履歴として保持するのは管理キーだけで、実kubectlのlast-applied-configuration annotationやフィールド管理全体は再現しません。

権限はConfigMap/Secretごとに判定します。applyはgetと、新規ならcreate・既存ならupdateを要求します（同じ値への再適用にもupdateを要求する簡略モデル）。create/deleteは対象のcreate/deleteだけで、Deployment権限は不要です。複数リソースは全体を検証し、途中の権限不足・不正なmanifest・重複・削除対象の欠落があれば一切変更しません。実kubectlの複数リソース処理は途中まで反映されることがあるため、この原子的な動作は教材上の簡略化です。

namespace追加、labels/annotations、immutable、binaryData、volume、対応範囲外のDeployment/Service manifest、List、ディレクトリ/URL/stdin入力、server-side apply、patch/edit、YAML alias/明示タグは未対応として拒否します。認識できないフィールドもエラーにし、無視して成功扱いにはしません。`deployment.yaml` / `service.yaml` は仮想ファイルがない場合のみ従来の固定教材として利用できます。同名ファイルがあれば必ず内容を解釈し、壊れていても固定教材へ切り替えません。

## Deployment・Serviceのファイル適用と接続先

```sh
gcloud services enable container.googleapis.com
gcloud container clusters create-auto manifest-gke --region=us-central1
sim files load kubernetes-workload
kubectl apply -f web-deployment.yaml
kubectl apply -f web-service.yaml
kubectl describe service manifest-svc
sim files replace web-deployment.yaml --search=nginx:1 --replacement=nginx:2
kubectl apply -f web-deployment.yaml
sim files replace web-service.yaml --search=wrong-app --replacement=manifest-web
kubectl apply -f web-service.yaml
kubectl describe service manifest-svc
kubectl rollout history deployment/manifest-web
```

教材のServiceは最初に誤ったselector `app: wrong-app` を持ちます。Service自体は作成できますが接続先はありません。DeploymentのPodラベル `app: manifest-web` に合わせてapplyすると、準備完了の2つのPodが `endpoints` に表示されます。Serviceのプロパティでもselector・targetPort・接続先を確認できます。対応する「マニフェストでアプリを更新しServiceの接続先を直す」ミッションは、初期Worldから実行でき、イメージ更新履歴とファイル・クラスタ状態の一致を確認します。ファイルを編集しただけや、最初からnginx:2で作った場合は達成しません。

対応範囲は次のとおりです。認識しないフィールドは無視せず拒否します。

| 対象 | 対応するフィールド・動作 |
| --- | --- |
| Deployment | `apps/v1`、metadata.name、namespaceはdefault、replicasは0〜1000。selector.matchLabelsとtemplate.metadata.labelsはどちらも `app: <Deployment名>` の1キー。metadata.labelsを指定する場合も同じ値のみ |
| コンテナ | 1個のみ、nameはDeployment名と同じ。imageとenvを指定。envは文字列value（省略なら空文字）またはconfigMapKeyRef/secretKeyRef。optional・envFrom・ports・volume・probe等は未対応 |
| Service | `v1`、ClusterIP/NodePort/LoadBalancer、selectorはDNSラベル形式の `app` 1キー。TCPの1ポート、port/targetPortは1〜65535の整数。省略時のtypeはClusterIP、targetPortはportと同じ |
| 更新 | Deploymentのimage・env・replicasを一度に変更してもtemplate revisionは1つだけ進む。replicasだけならrevisionと既存Podを保持。env省略は空、replicas省略は新規なら1・更新なら現在の値を保持 |
| Service再適用 | selectorとport/targetPortの変更はClusterIP・外部IP・作成日時を保持。typeの変更はこの教材では拒否し、明示的な削除・再作成が必要 |
| 接続先 | 同じプロジェクト・クラスタでappラベルが一致し、イメージ取得と環境変数解決が成功したPodを導出。0レプリカ・Deployment削除・一致なし・起動待ちなら接続先なし |

`create/apply/delete -f`と複数ドキュメントを利用でき、ConfigMap/Secretとの混在も可能です。createは既存リソースを更新せず、deleteはファイルを残します。applyは対象種別のgetとcreate/update、create/deleteはそれぞれの権限を検証し、複数リソースの途中失敗ではリソースもIP採番も変更しません。Serviceの権限はDeploymentから独立しています。

Deployment/Serviceのapplyは対応するspec値を反映する限定モデルです。ConfigMap/Secretの管理キー処理とは異なり、last-applied annotationや三方向マージ・server-side applyは再現しません。selectorの不変性も `app: <Deployment名>` の固定モデルで検証します。任意ラベル・複数コンテナ・名前付きポート・複数ポート・UDP・headless/ExternalName・Serviceのtype変更は未対応です。

接続先は学習用の表示で、EndpointSliceリソース・probe・プロセスの待受ポート・実通信を確認するものではありません。Serviceだけを先に作ってもよく、Deploymentを削除してもServiceは残ります。既存のSnapshot v11のDeployment/Service構造で保存できるため版番号は変更せず、旧Snapshotの移行も維持します。

## Secretの表示と権限

Secretのget一覧・describe・プロパティは値を表示しません。getのJSON/YAMLはKubernetes同様にbase64表現のdataを返します。`set env --list`や履歴にはSecretの参照先だけを表示し、exec/printenvは起動時に取得した値を返します。base64は暗号化ではなく、保存データやコマンド履歴にも値が残ります。学習には架空の値を使用してください。

ConfigMap/Secretの操作はそれぞれ`container.configMaps.*`/`container.secrets.*`を検証します。`set env --from`にはDeployment更新と取込元getの両方、execには`container.pods.exec`が必要です。container.viewerはConfigMapとtemplateの参照を読めますが、Secret値の取得・exec・更新はできません。container.developer/adminは今回の操作に対応します。Kubernetes RBACやSecretの暗号化・安全な保管庫は再現しません。

## 権限・保存・再現範囲

- history/statusは`container.deployments.get`、set image/restart/undoは`container.deployments.update`を要求します。学習用のcontainer.viewerにDeployment/Pod/Serviceの読み取り権限を補い、更新権限と分離しました。クラスタ/API/プロジェクト/アカウントも検証します。
- namespaceはdefaultのみで、別namespaceを指定した操作は拒否します。`get -o json`はJSONの単一リソースまたはList、`-o yaml`は従来のYAML表示です。出力には教材用の列も含みます。
- Snapshot v11にKubernetes仮想ファイルとapply管理キーを追加し、履歴・Pod識別子・ConfigMap/Secret・template環境変数・起動時の値を保存します。v10からは既存の設定・環境変数・履歴・Pod識別子とTerraform/Docker状態を保持し、空の仮想ファイル・管理キーを補完します。v9からの移行は既存の履歴とPod識別子を保持し、空の設定/環境変数を補完します。v1〜v8は現在のイメージ・世代を1件の履歴として移行し、過去のイメージは推測しません。v8のDocker/レジストリ/ビルド履歴・ノードSA・Terraform状態を保持します。移行後に新しく更新した分からrollbackできます。
- PodはDeploymentから導出します。レプリカ上限はシミュレーターの表示・保存保護のため1000です。実際のKubernetesの上限を表す値ではありません。
- 即時に切り替わる簡略モデルです。ローリング更新中の旧/新Podの共存、maxSurge/maxUnavailable、スケジューラ、進行待ち・timeout、probe、実ネットワーク通信は再現しません。失敗した更新中に旧Podを稼働させ続ける動作も未対応です。
- ReplicaSetは読み取り専用の導出状態です。templateの識別子/Pod名は疑似値で、実際のハッシュ・annotationsは再現しません。イメージ変更/restartごとに新しいtemplateを作り、undoでは保存したtemplateを再利用します。
- `.pkg.dev`以外のイメージは従来の簡略な成功モデルです。実在タグ/コンテナの起動可否の確認はしません。異常系ミッションでは存在確認できる教材レジストリを使います。

namespace、ConfigMap/Secretのvolumeマウント・任意ラベルや複数コンテナを含むmanifest、readiness/liveness、HPA/VPA、StatefulSet/PVC、NetworkPolicy、ノードプール設定やWorkload Identity等は残作業です。Issue #15は閉じません。

参照: [ConfigMap](https://kubernetes.io/docs/concepts/configuration/configmap/)、[Secret](https://kubernetes.io/docs/concepts/configuration/secret/)、[kubectl set env](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_set/kubectl_set_env/)、[Deploymentの更新とロールバック](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)、[kubectl set image](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_set/kubectl_set_image/)、[kubectl rollout undo](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_undo/)、[GKEのロールと権限](https://docs.cloud.google.com/iam/docs/roles-permissions/container)。

ファイル操作の参照: [Secretの設定ファイル](https://kubernetes.io/docs/tasks/configmap-secret/managing-secret-using-config-file/)、[宣言的な構成管理](https://kubernetes.io/docs/tasks/manage-kubernetes-objects/declarative-config/)。

ワークロード設定の参照: [Deploymentのselector](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#selector)、[Serviceの定義](https://kubernetes.io/docs/concepts/services-networking/service/#defining-a-service)。
