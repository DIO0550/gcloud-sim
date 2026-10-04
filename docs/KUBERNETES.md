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

`sim files`は実際のkubectlコマンドではなく、ブラウザ内の学習用ファイル操作です。上の手順は前節のクラスタとDeploymentを使います。新ミッション「設定ファイルをapplyしてPodへ反映する」は初期Worldからも実施できます。ミッションは全51件、GKE拡充分は14件です。

`sim files write FILE --content='…'`で独自のYAML/JSONを書き、`read`で読み、`replace --search=… --replacement=…`で1か所を編集できます。ファイルは `.yaml` / `.yml` / `.json` の相対パスで、32ファイル・1ファイル64,000文字まで。Terraformとは別に保存し、Terraformのplanに影響しません。`sim files delete FILE`はファイルだけを消します。クラスタ上の設定を消す操作は `kubectl delete -f FILE` です。教材の上書きは `sim files load kubernetes-config --force` で明示します。

対応するmanifestは `apiVersion: v1` のConfigMapとOpaque Secretです。`metadata.name`と任意の`metadata.namespace: default`、ConfigMapの文字列`data`、Secretのbase64 `data`と平文`stringData`を読みます。同じキーではstringDataを優先し、取得時はbase64 dataで返します。Secretの内容はUTF-8のみ。YAMLは数値・booleanを自動で文字列へ変換しないため、文字列の値は必要に応じて引用符で囲みます。複数行文字列と `---` 区切りの最大32リソースも使えます。

`create -f`は新規作成専用で、既存なら失敗します。`apply -f`は作成または更新し、同じ構成の再適用はunchangedです。前回applyで管理したキーをファイルから取り除くとそのキーを削除し、applyで管理していない既存キーは保持します。設定の作成日時と既存Podは維持し、起動時の値は再起動で更新します。履歴として保持するのは管理キーだけで、実kubectlのlast-applied-configuration annotationやフィールド管理全体は再現しません。

権限はConfigMap/Secretごとに判定します。applyはgetと、新規ならcreate・既存ならupdateを要求します（同じ値への再適用にもupdateを要求する簡略モデル）。create/deleteは対象のcreate/deleteだけで、Deployment権限は不要です。複数リソースは全体を検証し、途中の権限不足・不正なmanifest・重複・削除対象の欠落があれば一切変更しません。実kubectlの複数リソース処理は途中まで反映されることがあるため、この原子的な動作は教材上の簡略化です。

namespace追加、ConfigMap/Secretのlabels、annotations、immutable、binaryData、volume、対応範囲外のDeployment/Service manifest、List、ディレクトリ/URL/stdin入力、server-side apply、patch/edit、YAML alias/明示タグは未対応として拒否します。認識できないフィールドもエラーにし、無視して成功扱いにはしません。`deployment.yaml` / `service.yaml` は仮想ファイルがない場合のみ従来の固定教材として利用できます。同名ファイルがあれば必ず内容を解釈し、壊れていても固定教材へ切り替えません。

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
| Deployment | `apps/v1`、metadata.name、namespaceはdefault、replicasは0〜1000。metadata.labelsとtemplate.metadata.labelsは独立した文字列map。非空のselector.matchLabelsはPodラベルの部分集合で、作成後は変更不可 |
| コンテナ | 1個のみ、nameはDeployment名と同じ。image・env・resources（CPU/メモリのrequests/limits）を指定。envは文字列value（省略なら空文字）またはconfigMapKeyRef/secretKeyRef。HTTP readinessProbe/livenessProbe/startupProbeにも限定対応。optional・envFrom・ports・volume等は未対応 |
| Service | `v1`、ClusterIP/NodePort/LoadBalancer、selectorは非空の文字列map。metadata.labelsは省略可能。TCPの1ポート、port/targetPortは1〜65535の整数。省略時のtypeはClusterIP、targetPortはportと同じ |
| 更新 | Deploymentのimage・env・Podラベル・resources・replicasを一度に変更してもtemplate revisionは1つだけ進む。replicasだけならrevisionと既存Podを保持。env省略は空、replicas省略は新規なら1・更新なら現在の値を保持 |
| Service再適用 | selectorとport/targetPortの変更はClusterIP・外部IP・作成日時を保持。typeの変更はこの教材では拒否し、明示的な削除・再作成が必要 |
| 接続先 | 同じプロジェクト・クラスタでselectorの全ラベルが一致し、イメージ取得と環境変数解決が成功したPodを導出。0レプリカ・Deployment削除・一致なし・起動待ちなら接続先なし |

`create/apply/delete -f`と複数ドキュメントを利用でき、ConfigMap/Secretとの混在も可能です。createは既存リソースを更新せず、deleteはファイルを残します。applyは対象種別のgetとcreate/update、create/deleteはそれぞれの権限を検証し、複数リソースの途中失敗ではリソースもIP採番も変更しません。Serviceの権限はDeploymentから独立しています。

Deployment/Serviceのapplyは対応するspec値を反映する限定モデルです。ConfigMap/Secretの管理キー処理とは異なり、last-applied annotationや三方向マージ・server-side applyは再現しません。ラベルmapは指定値で置換し、metadata.labels省略は空になります。複数コンテナ・名前付きポート・複数ポート・UDP・headless/ExternalName・Serviceのtype変更は未対応です。

接続先は学習用の表示で、EndpointSliceリソース・プロセスの待受ポート・実通信を確認するものではありません。Serviceだけを先に作ってもよく、Deploymentを削除してもServiceは残ります。Snapshot v17でラベル・selector・resources・HPAとreadiness/liveness/startup設定・評価・共通再起動回数を保存します。

## 複数ラベルとServiceの公開先切り替え

```sh
gcloud services enable container.googleapis.com
gcloud container clusters create-auto labels-gke --region=us-central1
sim files load kubernetes-labels
kubectl apply -f shop-blue.yaml
kubectl apply -f shop-green.yaml
kubectl apply -f shop-service.yaml
kubectl get pods -l app=shop,track=blue
kubectl describe service shop
sim files replace shop-service.yaml --search=blue --replacement=green
kubectl apply -f shop-service.yaml
kubectl get pods -l app=shop,track=green
kubectl describe service shop
kubectl get deployments -l team=storefront
```

Serviceの`app: shop`と`track: green`はAND条件です。両方に一致した、準備完了のPodだけを接続先にします。`track`条件を削除すればblue/green両DeploymentのPodを選べます。ServiceのIPはselector変更でも変わりません。describeとプロパティにはPod名と接続先IP:portを表示します。新ミッション「ラベルでServiceの公開先を切り替える」は両Deploymentを2レプリカずつ残し、ファイルと公開先をgreenにそろえると達成します。

Deployment自身の`metadata.labels`と`spec.template.metadata.labels`は別です。ServiceはPod側のラベルを選びます。Deploymentの`spec.selector.matchLabels`もPodラベルの部分集合でなければならず、作成後は変更できません。Podラベルの変更はrevisionを進め、undoはイメージ・環境変数とともにラベルも復元します。Deployment自身のラベルだけを変更してもgeneration・revision・Podは変わりません。命令形式のcreate deploymentは従来どおり`app: 名前`、exposeは対象Deploymentのselectorを引き継ぎます。

ラベルはmapあたり100個まで。キーの名前部分と値は英数字で始終し、内部の`-_.`を含め63文字まで（値は空文字も可）。キーには小文字DNS形式の253文字以内のprefixと`/`を付けられます。数値・booleanは引用符で囲みます。空selector、matchExpressions、set型・存在・不等号条件、kubectl labelは未対応です。

`kubectl get pods/deployments/services/replicasets/all -l key=value,key2=value2`で絞れます。`--selector`と`==`も使えます。各リソース自身のmetadata.labelsを検索し、名前との併用やConfigMap/Secret/Nodeへの絞り込みは拒否します。複数Deploymentのselector重複による管理競合は再現せず、Podの所有者は作成元Deploymentに固定します。

Pod IPはクラスタ内でDeploymentごとに重複しない仮想/22を割り当てます（最大16,384 Deployment、各1,000 Pod）。Podの位置に対して安定し、再起動や再作成時も再利用する簡略モデルです。実GKEのCIDR/IPAMやネットワーク疎通を再現するものではありません。

## CPU・メモリのrequests / limits

```sh
gcloud services enable container.googleapis.com
gcloud container clusters create-auto resources-gke --region=us-central1
sim files load kubernetes-resources
sim files read resource-web.yaml
kubectl apply -f resource-web.yaml
# 教材はrequest > limitで失敗。以下でCPUの必要量と上限を直す
sim files replace resource-web.yaml --search=500m --replacement=100m
sim files replace resource-web.yaml --search=250m --replacement=500m
sim files replace resource-web.yaml --search=100m --replacement=250m
kubectl apply -f resource-web.yaml
kubectl describe deployment resource-web
kubectl set resources deployment/resource-web --requests=cpu=300m
kubectl rollout history deployment/resource-web
kubectl rollout undo deployment/resource-web
```

`resources.requests`は配置判断に使う必要量、`resources.limits`は利用上限です。設定は1コンテナ（この教材では1 Pod）あたりで、現在の使用量ではありません。CPUの`250m`は`0.25` CPU、メモリの`128Mi`は134,217,728 bytesです。メモリの`M`は10進、`Mi`は2進の単位なので、`1Gi`のrequestと`1000M`のlimitは大小関係が不正になります。

コンテナの`resources.requests/limits`にCPU・メモリのmapを指定できます。数量は文字列または数値。CPUは0以上の整数mまたは小数3桁までのcore、メモリは0以上の整数bytesまたは整数Ki/Mi/Gi/Ti/K/M/G/Tに対応します。CPUは1m未満の精度、メモリは小数付き単位・m・指数表記、GPU・ephemeral-storage等は未対応として拒否します。内部のmillicore/bytesが安全な整数範囲を超える量も拒否します。

同じリソースのrequestがlimitを超えれば、Worldを変更せずエラーにします。limitだけを指定しrequestがなければ、同じ量をrequestに補います。requestだけの指定は可能です。同じ量の表記違い（`0.5`と`500m`、`1024Mi`と`1Gi`等）は正規化され、再適用でrevisionは増えません。

`kubectl set resources deployment/NAME --requests=cpu=250m,memory=128Mi --limits=cpu=500m,memory=256Mi`は指定したキーだけを更新します。`-c/--containers`はDeployment名または`*`に対応。0を指定したキーは削除し、残ったlimitにrequestがなければ再度補完します。両方のmapで0にするとそのリソース設定を解除できます。manifestの`resources`は全体を置換し、省略または`{}`なら未指定に戻します。manifestに書いた0は明示的な値として保存します。

設定変更はPod templateのrevisionを進め、Podを作り直します。image/env/ラベル/replicasとの一括applyでもrevisionは1つ。undoはresourcesも復元し、現在のレプリカ数を保ちます。get/describeのDeployment・Pod・ReplicaSet、rollout historyの詳細、Deploymentのプロパティで設定を確認できます。

新ミッション「CPU・メモリの必要量と上限を設定する」は、教材の不正設定を直し、2レプリカ・requests 250m/128Mi・limits 500m/256Miでファイルとクラスタをそろえると達成します。

今回扱うのは設定・検証・履歴です。スケジューラ、ノード容量、Pending/Unschedulable、CPU throttling、OOMKill、使用量、VPA・HPAの定期評価/実測/安定化、LimitRange/ResourceQuotaは再現しません。Standard/Autopilot共通の限定モデルで、Autopilot独自の既定値・最小量・CPU/メモリ比率・自動調整も適用しません。未指定の量からクラスタ固有の値を推測することはありません。

## PodのQoSを比較する

単一コンテナのCPU・メモリ設定からPodのQoSを導出します。正規化・request補完後の値を使い、ゼロは分類上の未指定として扱います。

| QoS | この教材の判定条件 |
| --- | --- |
| BestEffort | CPU・メモリのrequests/limitsに正の量がない |
| Guaranteed | CPU・メモリの両方に正のrequestとlimitがあり、それぞれ等しい |
| Burstable | 正の量が1つ以上あり、Guaranteedの条件を満たさない |

CPUだけのrequest/limitが等しくてもBurstableです。両リソースのlimitだけを指定するとrequestが補完され、Guaranteedになります。QoSは直接指定する設定ではありません。Deploymentのプロパティには「Pod QoS」を表示し、`kubectl get pods -o json` / `-o yaml` / `describe pods`には`status.qosClass`を出力します。Deployment自身にQoSがあるわけではなく、プロパティはそのtemplateから作るPodの分類です。0レプリカでもtemplateの分類を表示します。

```sh
gcloud services enable container.googleapis.com
gcloud container clusters create qos-gke --zone=us-central1-a
kubectl create deployment qos-best --image=nginx:1
kubectl create deployment qos-burst --image=nginx:1
kubectl create deployment qos-guaranteed --image=nginx:1
kubectl set resources deployment/qos-burst --requests=cpu=250m,memory=128Mi --limits=cpu=500m,memory=256Mi
kubectl set resources deployment/qos-guaranteed --limits=cpu=500m
# CPUだけではBurstable。メモリも追加するとGuaranteed
kubectl set resources deployment/qos-guaranteed --limits=memory=256Mi
kubectl get pods -o yaml
kubectl describe pods
```

ミッション「requestsとlimitsからPodのQoSを比較する」は、上の3つを各1レプリカ・nginx:1・指定のresourcesにそろえると達成します。QoSが同じでも指定量が異なる場合や0レプリカでは未達成です。Standardクラスタで比較し、実際のAutopilotの補正とは分けて学びます。

set resourcesやapplyによるtemplate更新でPodを作り直し、undoは復元した設定から分類します。scale・restart・Pod再作成でも設定に対応した分類になり、起動エラーのPodもQoSを持ちます。QoS自体は保存せず既存resourcesから導出します。v13からは保存したresources、v12以前からは移行後の未指定resourcesを用います。

PodのJSON/YAML/describeでは、以前表示文字列で上書きしていた`status`をオブジェクトに修正しました。`status.phase`・`status.podIP`・`status.qosClass`を保持し、一覧用の`Running`/起動エラー名は教材用`displayStatus`に分離します。Pod一覧と`get all`のSTATUS列は従来どおりです。起動エラー時のphaseはPendingです。参照・更新には既存のPod/Deployment権限とクラスタ/API境界を適用します。

QoSは稼働・性能・退避されないことを保証しません。ノード圧迫時のeviction、OOM、CPU throttling、複数コンテナ/init container、Pod単位resources、in-place resizeは再現しません。Autopilot固有のrequest補正も引き続き対象外です。

参照: [KubernetesのQoS設定](https://kubernetes.io/docs/tasks/configure-pod-container/quality-service-pod/)、[ゼロ量を除外するQoS計算](https://github.com/kubernetes/kubernetes/blob/v1.35.0/pkg/apis/core/helper/qos/qos.go)。

## Secretの表示と権限

Secretのget一覧・describe・プロパティは値を表示しません。getのJSON/YAMLはKubernetes同様にbase64表現のdataを返します。`set env --list`や履歴にはSecretの参照先だけを表示し、exec/printenvは起動時に取得した値を返します。base64は暗号化ではなく、保存データやコマンド履歴にも値が残ります。学習には架空の値を使用してください。

ConfigMap/Secretの操作はそれぞれ`container.configMaps.*`/`container.secrets.*`を検証します。`set env --from`にはDeployment更新と取込元getの両方、execには`container.pods.exec`が必要です。container.viewerはConfigMapとtemplateの参照を読めますが、Secret値の取得・exec・更新はできません。container.developer/adminは今回の操作に対応します。Kubernetes RBACやSecretの暗号化・安全な保管庫は再現しません。

## 権限・保存・再現範囲

- history/statusは`container.deployments.get`、set image/restart/undoは`container.deployments.update`を要求します。学習用のcontainer.viewerにDeployment/Pod/Serviceの読み取り権限を補い、更新権限と分離しました。クラスタ/API/プロジェクト/アカウントも検証します。
- namespaceはdefaultのみで、別namespaceを指定した操作は拒否します。`get -o json`はJSONの単一リソースまたはList、`-o yaml`は従来のYAML表示です。出力には教材用の列も含みます。
- Snapshot v17はstartupProbe・起動判定とprobe種別によらないPod内コンテナの累計再起動回数を追加します。v16のliveness応答に保存した回数を共通カウンタへ移行し、readiness/livenessの設定・判定とHPA・履歴・環境変数・ファイル等を保持します。v16はlivenessProbeをtemplate/履歴に、連続失敗・最後の応答・再起動回数をPod名ごとに追加します。v15からはreadiness設定/評価・HPA・resources・履歴・環境変数・ファイル等を保持し、liveness未指定と空の評価集合を補完します。v15はreadinessProbeをtemplate/履歴、応答判定をPod名ごとに追加します。v14からはHPAの設定と評価・resources・履歴・環境変数・ファイル等を保持し、probe未指定と空の評価集合を補完します。v14はHPAと前回の教材評価を追加し、v13のresources・履歴・ラベル・Podネットワーク・設定・ファイルを保持して空のHPA集合を補完します。v13はコンテナのresourcesを現在のtemplateと履歴に追加します。v12からはラベル・selector・Podネットワークを含む全状態を保持し、resourcesは未指定として補完します。v11からはファイル・apply管理キー・環境変数・履歴・Pod識別子を保持し、Deploymentと過去templateのラベルを`app: 名前`、Service selectorを旧接続先の`app`ラベルへ移行します。導出するPod IPは再割当てになります。v10からは既存の設定・環境変数・履歴・Pod識別子とTerraform/Docker状態を保持し、空の仮想ファイル・管理キーを補完します。v9からの移行は既存の履歴とPod識別子を保持し、空の設定/環境変数を補完します。v1〜v8は現在のイメージ・世代を1件の履歴として移行し、過去のイメージは推測しません。v8のDocker/レジストリ/ビルド履歴・ノードSA・Terraform状態を保持します。移行後に新しく更新した分からrollbackできます。
- PodはDeploymentから導出します。レプリカ上限はシミュレーターの表示・保存保護のため1000です。実際のKubernetesの上限を表す値ではありません。
- 即時に切り替わる簡略モデルです。ローリング更新中の旧/新Podの共存、maxSurge/maxUnavailable、スケジューラ、進行待ち・timeout、プローブの実通信/タイマー、実ネットワーク通信は再現しません。失敗した更新中に旧Podを稼働させ続ける動作も未対応です。
- ReplicaSetは読み取り専用の導出状態です。templateの識別子/Pod名は疑似値で、実際のハッシュ・annotationsは再現しません。イメージ変更/restartごとに新しいtemplateを作り、undoでは保存したtemplateを再利用します。
- `.pkg.dev`以外のイメージは従来の簡略な成功モデルです。実在タグ/コンテナの起動可否の確認はしません。異常系ミッションでは存在確認できる教材レジストリを使います。

namespace、ConfigMap/Secretのvolumeマウント・ラベル、複数コンテナを含むmanifest、readiness/liveness/startupの定期実行、VPA・HPAの定期評価/実測/安定化、StatefulSet/PVC、NetworkPolicy、ノードプール設定やWorkload Identity等は残作業です。Issue #15は閉じません。

参照: [ConfigMap](https://kubernetes.io/docs/concepts/configuration/configmap/)、[Secret](https://kubernetes.io/docs/concepts/configuration/secret/)、[kubectl set env](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_set/kubectl_set_env/)、[Deploymentの更新とロールバック](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)、[kubectl set image](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_set/kubectl_set_image/)、[kubectl rollout undo](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_undo/)、[GKEのロールと権限](https://docs.cloud.google.com/iam/docs/roles-permissions/container)。

ファイル操作の参照: [Secretの設定ファイル](https://kubernetes.io/docs/tasks/configmap-secret/managing-secret-using-config-file/)、[宣言的な構成管理](https://kubernetes.io/docs/tasks/manage-kubernetes-objects/declarative-config/)。

ワークロード設定の参照: [ラベルとselector](https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/)、[Deploymentのselector](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#selector)、[Serviceの定義](https://kubernetes.io/docs/concepts/services-networking/service/#defining-a-service)。

リソース設定の参照: [コンテナのrequests/limits](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)、[kubectl set resources](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_set/kubectl_set_resources/)。


## CPUのHPAを1回ずつ評価する

```sh
gcloud services enable container.googleapis.com
gcloud container clusters create-auto hpa-gke --region=us-central1
kubectl create deployment hpa-web --image=nginx:1 --replicas=2
kubectl autoscale deployment/hpa-web --min=1 --max=5 --cpu-percent=50
sim kubernetes reconcile hpa-web --cpu=250m
# MissingCpuRequest: CPU requestがないので増減しない
kubectl set resources deployment/hpa-web --requests=cpu=250m
sim kubernetes reconcile hpa-web --cpu=250m
# 2 -> 4 replicas
kubectl get hpa
kubectl describe hpa hpa-web
sim kubernetes reconcile hpa-web --cpu=10m
# 4 -> 1 replicas（この教材では縮小の安定化待機を省略）
kubectl delete hpa hpa-web
```

- `autoscale`はDeploymentを対象にHPAを作成します。`--max`必須、`--min`既定1、`--cpu-percent`既定80、`--name`既定はDeployment名です。範囲は`1 <= min <= max <= 1000`、目標使用率は1〜1000の整数に限定します。1 Deploymentにつき1 HPAのみです。作成時にはスケールしません。
- `sim kubernetes reconcile NAME --cpu=量`は**本物のkubectlにはない教材用コマンド**です。評価前の全Podに同じ1 PodあたりCPU使用量を与え、1回だけ評価します。サンプルは非負、最大1000000000mです。繰り返し実行すると、その時点のレプリカ数を基に再計算します。スケール後の負荷分散を自動計算しません。
- 使用率は`CPU使用量 / CPU request`です。必要数を`ceil(現在のレプリカ数 × CPU使用量 × 100 / (CPU request × 目標使用率))`で計算し、最小・最大で制限します。比率が目標の±10%以内なら現在数を維持し、範囲外の現在数は最小・最大へ戻します。数量の計算には整数を使います。使用率表示は整数へ切り捨てますが、判定は数量比で計算する簡略モデルです。
- request未指定/0は`MissingCpuRequest`、0レプリカは`ScalingDisabled`、対象削除後は`TargetNotFound`として増減を止めます。1つでも起動できないPodがあれば`PodsNotReady`で止めます。実際のHPAが行う欠測・未準備Podへの保守的な補正は再現しません。
- スケールはtemplate revisionを作らず、既存Podと起動時の環境変数を維持します。増やしたPodは現在のConfigMap/Secretを読みます。Service接続先も更新されます。HPAを削除してもDeploymentは残り、Deploymentを削除してもHPAは残ります。クラスタ削除でHPAも消えます。
- `get/describe hpa`とツリーのプロパティでは、設定と**前回の教材評価**を確認します。評価時の入力・レプリカ数・判定をSnapshot v14以降に保存します。`TARGETS`とJSONのstatusは前回評価の値で、現在の実測値ではありません。設定変更・手動scale・再読込・getだけでは再評価しません。JSONの`simulator.lastEvaluation`に評価時刻と入力を示します。
- `kubectl autoscale`によるHPA作成は`container.horizontalPodAutoscalers.create`と対象Deploymentのget、参照・削除はHPAのget/list/deleteを要求します。教材評価にはHPAとDeployment双方のupdateを要求します。実際のHPAコントローラーの権限モデルとは異なります。プロジェクト・現在クラスタ・API有効化を検証し、namespaceはdefaultのみです。
- Metrics Server、`kubectl top`、定期評価、カスタム/メモリメトリクス、スケール速度制限、縮小の安定化ウィンドウ、VPA、HPAのpatch/editは未対応です。CPU limitsによるthrottlingやノード容量も計算しません。実際のHPAと同じ時間的挙動を保証するものではありません。

参照: [Kubernetes HPAのアルゴリズム](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/)、[GKEのHPA](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/horizontalpodautoscaler)。


## HPAの設定ファイルをapplyする

```sh
gcloud services enable container.googleapis.com
gcloud container clusters create-auto hpa-manifest-gke --region=us-central1
sim files load kubernetes-hpa
kubectl apply -f autoscale-web.yaml
kubectl apply -f autoscale-hpa.yaml
sim kubernetes reconcile autoscale-web --cpu=1
# 上限3レプリカで停止（TooManyReplicas）
sim files replace autoscale-hpa.yaml --search='maxReplicas: 3' --replacement='maxReplicas: 6'
sim files replace autoscale-hpa.yaml --search='averageUtilization: 80' --replacement='averageUtilization: 50'
kubectl apply -f autoscale-hpa.yaml
# Deploymentは3のまま。前回の教材評価を消し、TARGETSは<unknown>/50%になる
sim kubernetes reconcile autoscale-web --cpu=250m
# 3 -> 6 replicas
kubectl apply -f autoscale-web.yaml
kubectl apply -f autoscale-hpa.yaml
# Deploymentのreplicasは省略済みなので6を維持。同じHPA設定なら評価結果も保持
```

- `autoscaling/v2`の`HorizontalPodAutoscaler`を`kubectl create/apply/delete -f`で扱えます。対応フィールドはmetadata.name/namespace、spec.scaleTargetRef、minReplicas、maxReplicas、metricsです。default namespace、apps/v1 Deploymentへの参照、CPU Resource/Utilizationメトリクス1個に限定します。metadata.labels/annotations、behavior、status、他メトリクス等は拒否します。
- minReplicas省略は1です。maxReplicasと、metrics内のaverageUtilizationは明示必須です。メトリクス省略時の既定値補完はこの教材では行いません。レプリカ範囲・目標使用率・数量の制限は前節と共通です。
- applyでは対象・最小/最大レプリカ数・目標使用率をファイルの設定で置き換え、作成日時は保持します。同じ設定なら`unchanged`となり前回評価も保持します。変更した場合は前回評価を消します。これは古い条件での評価と新しい設定を混同しないための教材の仕様です。DeploymentのPodやレプリカ数はapplyだけでは変えません。
- ファイルからはDeploymentより先にHPAを作成できます。対象がない状態のreconcileは`TargetNotFound`を表示します。対象名変更も可能ですが、同一クラスタ内で別HPAと対象Deploymentが重複する場合は拒否します。
- HPAファイルの操作は`container.horizontalPodAutoscalers`のcreate/deleteを要求し、applyはgetとcreate/updateを要求します。HPA設定の変更だけならDeploymentのget/updateは要求しません。同じ内容の再applyもupdate権限を要求する既存の教材方針に従います。実際にレプリカを変える教材評価には、前節の両方のupdate権限が必要です。
- 混在ファイルは全体が成功した場合だけ確定します。途中の不正設定・権限不足・対象重複・削除対象不足では先行リソースも変更しません。本物のkubectlの逐次適用との違いです。deleteはファイルのHPA名で削除し、対象Deploymentを残します。
- HPAのファイルと設定・評価はSnapshotに保存します（v14で追加、v17でも保持）。HPAのpatch/edit、複数フィールド管理者の三方向マージ、Metrics Server・定期評価等は未対応です。


## HTTP readinessProbeとServiceの接続先

readinessはトラフィックを受ける準備の判定です。この教材では、Deploymentの単一コンテナに次の設定を指定できます。

```yaml
readinessProbe:
  httpGet:
    path: /ready
    port: 8080
  successThreshold: 2
  failureThreshold: 2
```

`httpGet.port`は1〜65535の整数で必須、pathは`/`で始まる空白なしの文字列（1024文字まで、省略時`/`）です。成功閾値は省略時1、失敗閾値は3で、教材の上限はそれぞれ1000です。HTTPのみで、scheme/host/headers・名前付きport・exec/TCP/gRPC・initialDelaySeconds/periodSeconds/timeoutSecondsは未対応として拒否します。

`sim kubernetes probe NAME --status-code=CODE`で、対象Deploymentの全Podへ応答コードを1回ずつ与えます。`--pod=POD_NAME`で1つだけ選べます。コードは整数100〜599、200〜399を成功とします。path/portは設定として保持し、指定した応答をそのプローブの結果として扱います。実HTTP要求、待受ポート/URL/リダイレクト確認、経過時間、定期評価はありません。操作にはクラスタ/APIと`container.deployments.update`を要求します。これは教材データを更新する権限で、本物のkubectlに対応する操作ではありません。

- プローブを持つ新Podは未準備。連続成功がsuccessThresholdに達するとReadyになり、連続失敗がfailureThresholdに達するとNotReadyになります。成功と失敗が切り替わると逆側の連続回数を0へ戻します。
- Readyになるまで、または失敗閾値に到達したPodはService接続先から外れます。PodはRunningのまま、RESTARTSとPod名は変えません。logs/execも引き続き使用できます。
- Deployment/ReplicaSetのREADY、Podの`status.conditions`のReady、`simulator.readinessSample`の前回応答・連続回数、Serviceの接続先、rollout statusに反映します。HPAは既存の全Pod準備判定に従い、未準備PodがいればPodsNotReadyで増減しません。欠測Podなどの詳細補正は再現しません。
- 設定なしのPodは従来どおり起動エラーがなければ準備完了です。ImagePull/設定不足のPodへの応答指定は拒否します。全Podへの指定で1つでも起動エラーがあれば、他Podも変更しません。
- 評価はtemplate revision/generationを増やしません。同じmanifest再applyやmetadata変更・既存Podのscale維持では判定を保ちます。設定変更・image/env/resources更新・restartは新Podを未評価にし、undoも設定だけを復元して新Podの応答を要求します。追加Pod/削除後の再作成Podも未評価、削除されたPodの評価は消去します。
- manifestのreadinessProbe省略は設定解除です。対応するprobe変更も他のtemplate変更と同時に1revisionへまとめ、history/undoとSnapshot v15で保存・復元します。v1〜v14からはprobe未指定に移行し、既存Podの準備状態を変えません。

```sh
gcloud services enable container.googleapis.com
gcloud container clusters create readiness-gke --zone=us-central1-a
sim files load kubernetes-readiness
kubectl apply -f ready-web.yaml
kubectl apply -f ready-service.yaml
kubectl get pods
# まだRunning / READY 0/1。成功閾値2なので2回必要
sim kubernetes probe ready-web --status-code=200
sim kubernetes probe ready-web --status-code=200
kubectl get pods
# 表示されたPod名を1つコピーし、以下のPOD_NAMEを置き換える
sim kubernetes probe ready-web --pod=POD_NAME --status-code=503
sim kubernetes probe ready-web --pod=POD_NAME --status-code=503
kubectl get deployments
kubectl describe service ready-service
# 2つのPodを残し、READY 1/2・接続先1つ。復旧には同じPodへ200を2回指定
```

新ミッション「未準備のPodをServiceの接続先から外す」は、教材どおりのprobe設定で1つを200の連続成功2回、もう1つを503の連続失敗2回にし、Serviceの接続先を実際に1つにすると達成します。全Pod未評価・全Pod成功・全Pod失敗・失敗1回・Service selector不一致では達成しません。

参照: [Kubernetesのliveness/readiness/startup probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)。


## HTTP livenessProbeと同一Pod内のコンテナ再起動

livenessはコンテナの再起動が必要かを判定します。`sim files load kubernetes-liveness`で、readinessも設定された`live-web.yaml`と`live-service.yaml`を読み込めます。

```yaml
livenessProbe:
  httpGet:
    path: /healthz
    port: 8080
  failureThreshold: 2
```

- HTTPのpath/数値portはreadinessと同じ検証・既定値です。successThresholdは1のみ（省略時1）、failureThresholdは1〜1000（省略時3）。未対応の時間・通信方式・terminationGracePeriodSeconds等は拒否します。
- `sim kubernetes probe NAME --kind=liveness --status-code=503 [--pod=POD_NAME]`で1回評価します。200〜399は成功、それ以外の100〜599は失敗。成功は連続失敗回数を0へ戻します。失敗閾値に達すると対象コンテナだけを即時再起動し、連続失敗回数を0に戻します。
- 同じPod名・IP・template revision・generationのままRESTARTSが増加します。`kubectl get/describe pod`の`status.containerStatuses[].restartCount`と、`simulator.livenessSample`の応答・連続失敗・累計再起動回数で確認できます。`restarted`は最後に指定した応答で再起動したという記録で、再起動待ちの状態ではありません。livenessもstartupも未設定のPodにはcontainerStatusesを追加せず、既存表示を保ちます。
- 対象コンテナは現在のConfigMap/Secretから環境変数を読み直し、startup/readinessは未評価へ戻ります。他Podの値・判定は保持します。参照がなくなった場合はCreateContainerConfigErrorとなり、設定修復後に起動可能です。設定したstartupの成功とreadinessの再成功までService接続先から外れ、既存HPAの全Pod準備判定も待機します。
- liveness成功だけではreadinessは成功になりません。readiness未設定なら起動成功後、設定したstartupが成功すればReadyとして扱います。閾値未満のliveness失敗でReadyは変えません。readinessの失敗だけでは再起動しません。
- 設定変更は新しいtemplate revisionになり、history/undoにも対応します。scaleで残るPod・同じmanifestの再applyは回数を保持。新template・rollout restart・Pod削除後の再作成・追加PodはRESTARTS 0から始めます。Pod削除やscale縮小時は古い評価を消去します。
- 全Pod指定では起動エラーを先に検証し、1つでも評価不能なら状態全体を保持します。評価はcontainer.deployments.updateを必要とし、API・プロジェクト・現在のクラスタ境界も検証します。RESTARTSの上限は安全な整数の最大値です。

```sh
gcloud services enable container.googleapis.com
gcloud container clusters create liveness-gke --zone=us-central1-a
sim files load kubernetes-liveness
kubectl apply -f live-web.yaml
kubectl apply -f live-service.yaml
sim kubernetes probe live-web --status-code=200
kubectl get pods
# POD_NAMEを一覧の1つのPod名に置き換える
sim kubernetes probe live-web --kind=liveness --pod=POD_NAME --status-code=503
sim kubernetes probe live-web --kind=liveness --pod=POD_NAME --status-code=503
kubectl get pods
kubectl describe service live-service
sim kubernetes probe live-web --kind=liveness --pod=POD_NAME --status-code=200
sim kubernetes probe live-web --pod=POD_NAME --status-code=200
kubectl describe service live-service
```

再起動は学習用の即時モデルです。実HTTP通信・port/pathの待受確認・定期評価・経過時間・終了猶予・backoff/CrashLoopBackOff・再起動中の中間状態・前コンテナのlogs・実プロセス終了や起動は再現しません。環境変数の再読込にも実クラスタのキャッシュ/伝播遅延はありません。HTTPの300台も与えたコードだけで成功判定し、リダイレクトは追跡しません。

参照: [Kubernetesのliveness/readiness/startup probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)。


## HTTP startupProbeと起動確認の待機

startupはアプリの起動確認です。この教材では`sim files load kubernetes-startup`で`slow-web.yaml`と`slow-service.yaml`を読み込めます。startupの失敗閾値は3、livenessは1とし、起動中はlivenessによる早すぎる再起動を避ける練習ができます。

```yaml
startupProbe:
  httpGet:
    path: /healthz
    port: 8080
  failureThreshold: 3
```

path/数値port・HTTP成功範囲（200〜399）・閾値の検証はlivenessと共通です。successThresholdは1だけ、failureThresholdは1〜1000（既定3）。時刻や待ち時間ではなく、明示した応答の回数で判断します。

| 状態・操作 | 教材の動作 |
| --- | --- |
| startup未評価・失敗中 | プロセスはRunningでもstarted=false・NotReady。Service接続先から除外し、既存HPAはPodsNotReadyで停止。logs/execは起動エラーがなければ利用可能 |
| readiness/livenessを起動確認前に指定 | StartupProbePendingで拒否し、どのPodの評価も変更しない |
| startup成功 | started=trueに固定し、readiness/livenessの評価を許可。readinessがあれば別途成功が必要。なければReady |
| 成功済みstartupを再指定 | StartupProbeCompletedで拒否。再起動まで無効になることを表す |
| startup失敗閾値に到達 | 同じPod内のコンテナを即時再起動し、RESTARTSを増加。連続失敗は0、startupは未成功から再試行 |
| livenessによる再起動 | 同じ共通カウンタを増加し、startup/readinessを未評価へ戻す。startupの再成功までreadiness/livenessは待機 |

全Pod指定は全対象を事前検証します。一部が起動確認済みで他が未確認の場合、startupは全体を拒否します。readiness/livenessも未確認Podが1つでもあれば全体を拒否します。混在状態では`--pod`で対象を指定してください。起動エラー・引数・権限・API・クラスタの検証も更新前に行います。

`kubectl get/describe pod`の`status.containerStatuses[].started`、`restartCount`、`simulator.startupSample`とDeploymentプロパティで確認できます。最後の応答には、その評価後の累計再起動回数も記録します。livenessで再起動した直後は、再起動を引き起こしたliveness応答の記録を残しますが、これは新しいコンテナを評価済みという意味ではありません。

設定をtemplate revision/history/undoに含めます。同じapply・既存Podのscaleは起動確認と回数を維持し、追加・再作成・新templateのPodは未確認・RESTARTS 0です。Snapshot v17は起動確認と共通再起動回数を保存し、v1〜v16ではstartup未指定を補完します。v16で既に記録されたliveness再起動回数を失わず引き継ぎます。

```sh
gcloud services enable container.googleapis.com
gcloud container clusters create startup-gke --zone=us-central1-a
sim files load kubernetes-startup
kubectl apply -f slow-web.yaml
kubectl apply -f slow-service.yaml
sim kubernetes probe slow-web --kind=startup --status-code=503
sim kubernetes probe slow-web --kind=startup --status-code=503
kubectl get pods
# POD_NAMEを一覧の1つのPod名に置き換える
sim kubernetes probe slow-web --kind=startup --pod=POD_NAME --status-code=200
sim kubernetes probe slow-web --pod=POD_NAME --status-code=200
kubectl describe service slow-service
```

実HTTP通信・定期実行・初期遅延・timeout・終了猶予・backoff・起動時間・複数コンテナは再現しません。起動完了や再起動も明示した応答に応じる教材用の即時モデルです。設定されていないprobeの評価は拒否します。

参照: [Kubernetesのprobe種別とstartupの動作](https://kubernetes.io/docs/concepts/workloads/pods/probes/)。
