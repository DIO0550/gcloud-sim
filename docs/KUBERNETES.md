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

ConfigMapは`cm/configmap/configmaps`、Secretは`secret/secrets`でget/describe/deleteできます。設定はプロジェクト・クラスタ・namespaceごとに分かれ、Podの設定参照は同じnamespace内で解決します。クラスタ削除で設定も消えます。`--from-literal`は1キーずつ繰り返せ、値にカンマ・空文字・日本語を含められます。同じキーの重複はエラーです。名前は学習用にDNSラベル（63文字以内）、データは100キー/1 MiB以内に制限します。

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

`kubectl exec POD -- printenv [KEY]`または`env`は、この教材で注入した変数だけを表示します。`deployment/NAME`なら先頭Podです。シェルやコンテナ内の任意プログラムは実行しません。イメージ内蔵のENV、変数展開、envFromの動的な全キー取込、複数コンテナは未対応です。環境取得は仮想Pod作成時に行い、イメージpullのタイミング・ノードキャッシュは従来の簡略モデルのままです。

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

`sim files`は実際のkubectlコマンドではなく、ブラウザ内の学習用ファイル操作です。上の手順は前節のクラスタとDeploymentを使います。新ミッション「設定ファイルをapplyしてPodへ反映する」は初期Worldからも実施できます。ミッションは全64件、GKE拡充分は27件です。

`sim files write FILE --content='…'`で独自のYAML/JSONを書き、`read`で読み、`replace --search=… --replacement=…`で1か所を編集できます。ファイルは `.yaml` / `.yml` / `.json` の相対パスで、32ファイル・1ファイル64,000文字まで。Terraformとは別に保存し、Terraformのplanに影響しません。`sim files delete FILE`はファイルだけを消します。クラスタ上の設定を消す操作は `kubectl delete -f FILE` です。教材の上書きは `sim files load kubernetes-config --force` で明示します。

対応するmanifestは `apiVersion: v1` のConfigMapとOpaque Secretです。`metadata.name`と任意の`metadata.namespace`・`metadata.labels`、ConfigMapの文字列`data`とbase64の`binaryData`、Secretのbase64 `data`と平文`stringData`を読みます。同じキーではstringDataを優先し、取得時はbase64 dataで返します。Secretの内容はUTF-8のみ。YAMLは数値・booleanを自動で文字列へ変換しないため、文字列の値は必要に応じて引用符で囲みます。複数行文字列と `---` 区切りの最大32リソースも使えます。

`create -f`は新規作成専用で、既存なら失敗します。`apply -f`は作成または更新し、同じ構成の再適用はunchangedです。前回applyで管理したキーをファイルから取り除くとそのキーを削除し、applyで管理していない既存キーは保持します。設定の作成日時と既存Podは維持し、起動時の値は再起動で更新します。履歴として保持するのは管理キーだけで、実kubectlのlast-applied-configuration annotationやフィールド管理全体は再現しません。

権限はConfigMap/Secretごとに判定します。applyはgetと、新規ならcreate・既存ならupdateを要求します（同じ値への再適用にもupdateを要求する簡略モデル）。create/deleteは対象のcreate/deleteだけで、Deployment権限は不要です。複数リソースは全体を検証し、途中の権限不足・不正なmanifest・重複・削除対象の欠落があれば一切変更しません。実kubectlの複数リソース処理は途中まで反映されることがあるため、この原子的な動作は教材上の簡略化です。

ConfigMap/Secretのannotations、対応範囲外のDeployment/Service manifest、List、ディレクトリ/URL/stdin入力、server-side apply、patch/edit、YAML alias/明示タグは未対応として拒否します。認識できないフィールドもエラーにし、無視して成功扱いにはしません。`deployment.yaml` / `service.yaml` は仮想ファイルがない場合のみ従来の固定教材として利用できます。同名ファイルがあれば必ず内容を解釈し、壊れていても固定教材へ切り替えません。

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
| Deployment | `apps/v1`、metadata.name、metadata.namespaceを指定可能（省略はコマンドのnamespace）、replicasは0〜1000。metadata.labelsとtemplate.metadata.labelsは独立した文字列map。非空のselector.matchLabelsはPodラベルの部分集合で、作成後は変更不可 |
| コンテナ | 1個のみ、nameはDeployment名と同じ。image・env・resources（CPU/メモリのrequests/limits）を指定。envは文字列value（省略なら空文字）またはconfigMapKeyRef/secretKeyRef。HTTP readinessProbe/livenessProbe/startupProbeにも限定対応。envのoptional・envFrom・ports等は未対応。ConfigMap/Secret/PVCのvolumes・volumeMountsは後述の範囲で対応 |
| Service | `v1`、ClusterIP/NodePort/LoadBalancer、selectorは非空の文字列map。metadata.labelsは省略可能。TCPの1ポート、port/targetPortは1〜65535の整数。省略時のtypeはClusterIP、targetPortはportと同じ |
| 更新 | Deploymentのimage・env・Podラベル・resources・replicasを一度に変更してもtemplate revisionは1つだけ進む。replicasだけならrevisionと既存Podを保持。env省略は空、replicas省略は新規なら1・更新なら現在の値を保持 |
| Service再適用 | selectorとport/targetPortの変更はClusterIP・外部IP・作成日時を保持。typeの変更はこの教材では拒否し、明示的な削除・再作成が必要 |
| 接続先 | 同じプロジェクト・クラスタでselectorの全ラベルが一致し、イメージ取得と環境変数解決が成功したPodを導出。0レプリカ・Deployment削除・一致なし・起動待ちなら接続先なし |

`create/apply/delete -f`と複数ドキュメントを利用でき、ConfigMap/Secretとの混在も可能です。createは既存リソースを更新せず、deleteはファイルを残します。applyは対象種別のgetとcreate/update、create/deleteはそれぞれの権限を検証し、複数リソースの途中失敗ではリソースもIP採番も変更しません。Serviceの権限はDeploymentから独立しています。

Deployment/Serviceのapplyは対応するspec値を反映する限定モデルです。ConfigMap/Secretの管理キー処理とは異なり、last-applied annotationや三方向マージ・server-side applyは再現しません。ラベルmapは指定値で置換し、metadata.labels省略は空になります。複数コンテナ・名前付きポート・複数ポート・UDP・headless/ExternalName・Serviceのtype変更は未対応です。

接続先は学習用の表示で、EndpointSliceリソース・プロセスの待受ポート・実通信を確認するものではありません。Serviceだけを先に作ってもよく、Deploymentを削除してもServiceは残ります。Snapshot v22でnamespace・コンテキスト既定値・ラベル・selector・resources・HPAとreadiness/liveness/startup設定・評価・共通再起動回数を保存します。

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

ラベルはmapあたり100個まで。キーの名前部分と値は英数字で始終し、内部の`-_.`を含め63文字まで（値は空文字も可）。キーには小文字DNS形式の253文字以内のprefixと`/`を付けられます。数値・booleanは引用符で囲みます。空selector、matchExpressions、set型・存在・不等号条件は未対応。kubectl labelはConfigMap/Secretの1リソースだけに対応します。

`kubectl get pods/deployments/services/replicasets/configmaps/secrets/all -l key=value,key2=value2`で絞れます。`--selector`と`==`も使えます。各リソース自身のmetadata.labelsを検索し、名前との併用やNodeへの絞り込みは拒否します。複数Deploymentのselector重複による管理競合は再現せず、Podの所有者は作成元Deploymentに固定します。

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
- namespaceは省略時コンテキストの既定値（未設定ならdefault）、`-n/--namespace`で指定します。同名リソースはnamespaceごとに独立し、Service・設定注入・HPAも同じnamespace内で解決します。`get -o json`はJSONの単一リソースまたはList、`-o yaml`は従来のYAML表示です。出力には教材用の列も含みます。
- Snapshot v18は各リソースのnamespaceとカスタムnamespace集合を追加し、v1〜v17の全リソースをdefaultへ移行します。v17のprobe判定・再起動回数・環境変数・履歴・HPA・仮想ファイル等はそのまま保持します。Snapshot v17はstartupProbe・起動判定とprobe種別によらないPod内コンテナの累計再起動回数を追加します。v16のliveness応答に保存した回数を共通カウンタへ移行し、readiness/livenessの設定・判定とHPA・履歴・環境変数・ファイル等を保持します。v16はlivenessProbeをtemplate/履歴に、連続失敗・最後の応答・再起動回数をPod名ごとに追加します。v15からはreadiness設定/評価・HPA・resources・履歴・環境変数・ファイル等を保持し、liveness未指定と空の評価集合を補完します。v15はreadinessProbeをtemplate/履歴、応答判定をPod名ごとに追加します。v14からはHPAの設定と評価・resources・履歴・環境変数・ファイル等を保持し、probe未指定と空の評価集合を補完します。v14はHPAと前回の教材評価を追加し、v13のresources・履歴・ラベル・Podネットワーク・設定・ファイルを保持して空のHPA集合を補完します。v13はコンテナのresourcesを現在のtemplateと履歴に追加します。v12からはラベル・selector・Podネットワークを含む全状態を保持し、resourcesは未指定として補完します。v11からはファイル・apply管理キー・環境変数・履歴・Pod識別子を保持し、Deploymentと過去templateのラベルを`app: 名前`、Service selectorを旧接続先の`app`ラベルへ移行します。導出するPod IPは再割当てになります。v10からは既存の設定・環境変数・履歴・Pod識別子とTerraform/Docker状態を保持し、空の仮想ファイル・管理キーを補完します。v9からの移行は既存の履歴とPod識別子を保持し、空の設定/環境変数を補完します。v1〜v8は現在のイメージ・世代を1件の履歴として移行し、過去のイメージは推測しません。v8のDocker/レジストリ/ビルド履歴・ノードSA・Terraform状態を保持します。移行後に新しく更新した分からrollbackできます。
- PodはDeploymentから導出します。レプリカ上限はシミュレーターの表示・保存保護のため1000です。実際のKubernetesの上限を表す値ではありません。
- 即時に切り替わる簡略モデルです。ローリング更新中の旧/新Podの共存、maxSurge/maxUnavailable、スケジューラ、進行待ち・timeout、プローブの実通信/タイマー、実ネットワーク通信は再現しません。失敗した更新中に旧Podを稼働させ続ける動作も未対応です。
- ReplicaSetは読み取り専用の導出状態です。templateの識別子/Pod名は疑似値で、実際のハッシュ・annotationsは再現しません。イメージ変更/restartごとに新しいtemplateを作り、undoでは保存したtemplateを再利用します。
- `.pkg.dev`以外のイメージは従来の簡略な成功モデルです。実在タグ/コンテナの起動可否の確認はしません。異常系ミッションでは存在確認できる教材レジストリを使います。

複数コンテナを含むmanifest、readiness/liveness/startupの定期実行、VPA・HPAの定期評価/実測/安定化、StatefulSet、Ingress/NetworkPolicyの未対応設定、ノードプール設定やWorkload Identity等は残作業です。Issue #15は閉じません。

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
- `kubectl autoscale`によるHPA作成は`container.horizontalPodAutoscalers.create`と対象Deploymentのget、参照・削除はHPAのget/list/deleteを要求します。教材評価にはHPAとDeployment双方のupdateを要求します。実際のHPAコントローラーの権限モデルとは異なります。プロジェクト・現在クラスタ・API有効化を検証し、HPAの対象は同じnamespace内で解決します。
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

- `autoscaling/v2`の`HorizontalPodAutoscaler`を`kubectl create/apply/delete -f`で扱えます。対応フィールドはmetadata.name/namespace、spec.scaleTargetRef、minReplicas、maxReplicas、metricsです。同じnamespace内のapps/v1 Deploymentへの参照、CPU Resource/Utilizationメトリクス1個に限定します。metadata.labels/annotations、behavior、status、他メトリクス等は拒否します。
- minReplicas省略は1です。maxReplicasと、metrics内のaverageUtilizationは明示必須です。メトリクス省略時の既定値補完はこの教材では行いません。レプリカ範囲・目標使用率・数量の制限は前節と共通です。
- applyでは対象・最小/最大レプリカ数・目標使用率をファイルの設定で置き換え、作成日時は保持します。同じ設定なら`unchanged`となり前回評価も保持します。変更した場合は前回評価を消します。これは古い条件での評価と新しい設定を混同しないための教材の仕様です。DeploymentのPodやレプリカ数はapplyだけでは変えません。
- ファイルからはDeploymentより先にHPAを作成できます。対象がない状態のreconcileは`TargetNotFound`を表示します。対象名変更も可能ですが、同一クラスタ内で別HPAと対象Deploymentが重複する場合は拒否します。
- HPAファイルの操作は`container.horizontalPodAutoscalers`のcreate/deleteを要求し、applyはgetとcreate/updateを要求します。HPA設定の変更だけならDeploymentのget/updateは要求しません。同じ内容の再applyもupdate権限を要求する既存の教材方針に従います。実際にレプリカを変える教材評価には、前節の両方のupdate権限が必要です。
- 混在ファイルは全体が成功した場合だけ確定します。途中の不正設定・権限不足・対象重複・削除対象不足では先行リソースも変更しません。本物のkubectlの逐次適用との違いです。deleteはファイルのHPA名で削除し、対象Deploymentを残します。
- HPAのファイルと設定・評価はSnapshotに保存します（v14で追加、v18でも保持）。HPAのpatch/edit、複数フィールド管理者の三方向マージ、Metrics Server・定期評価等は未対応です。


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


## namespaceで環境を分ける

```sh
gcloud services enable container.googleapis.com
gcloud container clusters create namespace-gke --zone=us-central1-a
sim files load kubernetes-namespace
kubectl apply -f namespaces.yaml
kubectl get ns
kubectl apply -f staging.yaml
kubectl apply -f production.yaml
kubectl set image deployment/web web=nginx:2 -n staging
kubectl scale deployment/web --replicas=3 -n staging
kubectl get deployments -A
kubectl exec deployment/web -n staging -- printenv MODE
kubectl exec deployment/web -n production -- printenv MODE
kubectl describe service web-service -n staging
kubectl describe service web-service -n production
```

各クラスタには`default`・`kube-system`・`kube-public`・`kube-node-lease`を導出します。組み込みnamespace内のシステムPodや実コントローラーは作りません。組み込みnamespaceの作成時刻は持たないためAGEは`<unknown>`です。カスタムnamespaceは`kubectl create namespace NAME`（`ns`別名）または`apiVersion: v1`・`kind: Namespace`・`metadata.name`だけのmanifestで作れます。名前は小文字DNSラベル・63文字まで。Namespaceのlabels/annotations/specは未対応で、導出するmetadata.nameラベルだけを表示します。

Deployment・Pod・ReplicaSet・Service・ConfigMap・Secret・HPAをnamespaceごとに識別します。各kubectl操作と`sim kubernetes probe/reconcile`の`-n/--namespace`はその1回の対象を指定し、省略時はコンテキストの既定namespace（未設定なら`default`）です。存在しないnamespaceはNotFoundで拒否します。namespaceとNode自体の操作はクラスタ単位です。リソースの作成・取得・更新・削除・rollout・環境変数・resources・probe・HPAは同名の別namespaceを変更しません。Podの名前は別namespaceで同じになる場合がありますが、仮想Pod IPはクラスタ内で重複しません。

ConfigMap/Secret参照、Service selector、HPA targetは同じnamespace内だけで解決します。別namespaceの同名ConfigMapが存在していても、ローカルの設定が欠けていれば新しいPodはCreateContainerConfigErrorです。起動済みPodの環境変数キャッシュは従来どおり保持します。namespace作成だけでは通信を遮断しません。権限はプロジェクト単位で判定し、Pod通信の教材用判定は後述のNetworkPolicyで扱います。

manifestのnamespaceは省略するとコマンドのnamespaceを使います。`-n`なしでmetadata.namespaceを指定すればそのnamespaceへ適用します。`-n`を明示した場合は全リソースの明示namespaceと一致する必要があり、不一致は全体を拒否します。1ファイルに同名の別namespaceリソースを置けますが、namespaceを解決した後に重複するリソースは拒否します。Namespaceとリソースを同じファイルに書く場合はNamespaceを先に書きます。後続の検証・権限で失敗すると、先行Namespaceも含めファイル全体の変更を戻す教材用の原子的操作です。

`kubectl get -A/--all-namespaces`はNAMESPACE列付きの一覧を返します。JSON/YAMLでもmetadata.namespaceを確認できます。`-A`と`-n`・個別名の組み合わせは未対応として拒否します。`-A`はgetだけに対応します。ツリーではカスタムnamespaceの下へリソースをまとめ、各プロパティとダブルクリックのdescribeコマンドにnamespaceを反映します。補完は現在クラスタのnamespace名・リソース名を候補にし、リソース名の候補は全namespaceを含みます。現在コンテキストの既定namespaceは下記のset-contextで変更できます。root位置のフラグ・namespace RBAC・Namespace自身のラベル操作等は未対応です。

`kubectl delete namespace NAME`は同じプロジェクト・クラスタ・namespace内の全Deployment（導出Pod/ReplicaSetを含む）・Service・ConfigMap・Secret・HPAを即時削除します。組み込みnamespaceは削除対象外です。実際のTerminating/finalizer/終了待ち・削除保護は再現しません。必要な権限は`container.namespaces.create/get/list/update/delete`で、namespace削除はそのdelete権限で子リソースも削除する教材モデルです。admin/developerへ追加し、viewerはget/listだけを持ちます。クラスタ削除でもカスタムnamespaceを削除します。Snapshot v22はこの分離とコンテキストの既定namespaceを保存します。v18は既定namespace未設定でそのまま保持し、v1〜v17はリソースをdefaultへ移行します。


## コンテキストの既定namespace

```sh
kubectl config set-context --current --namespace=staging
kubectl config get-contexts
kubectl get deployments
kubectl get deployment web -n production
kubectl config set-context gke_ace-dev-01_us-central1-a_namespace-gke --namespace=production
kubectl config view
kubectl config set-context --current --namespace=''
```

`set-context`は`--current`か既存CONTEXT名を1つ指定し、`--namespace`を必須にします。短いクラスタ名も使えます。1クラスタにつき1コンテキストを導出する教材モデルで、新しいコンテキストの作成・cluster/user/credentialsの変更・rename/delete-context・viewのminify/jsonpathは未対応です。名前付きの設定は現在の選択を変えません。

既定namespaceはプロジェクト/ロケーション/クラスタごとに保持し、use-context・get-credentials・gcloud configurationの切り替えや保存復元でも維持します。空文字は設定解除で、未設定時はdefaultを使います。namespaceの存在は設定時には要求せず、存在しない場合は後のリソース操作でNotFoundになります。namespaceを削除しても既定値は残るため、config操作または明示-nで復帰できます。クラスタ削除ではそのコンテキスト設定も消します。

通常のコマンドは「明示-n → コンテキスト既定値 → default」の順で決定します。manifestのmetadata.namespaceが明示されていればその値を使い、明示-nとの不一致だけを拒否します。get -Aは既定値によらず全namespaceを表示します。sim kubernetes probe/reconcileも同じ優先順です。get-contextsはNAMESPACE列、viewはcontext.namespace、端末見出しは明示した既定値を表示します。ツリーからのdescribeはdefaultも含めnamespaceを明示し、既定値で別環境の同名リソースを選ばないようにします。

config操作も既存のkubectlと同じAPI/プロジェクト/container.clusters.get確認を通る教材仕様です。ローカル設定だけを更新し、クラウドリソース・revision・Podを変えず、viewerでも変更できます。Snapshot v22で設定を保存し、v1〜v18は未設定へ補完します。v18のnamespace・probe・HPA・履歴・設定・仮想ファイル等は変更しません。


## ConfigMap・Secretをラベルで分類する

```sh
gcloud services enable container.googleapis.com
gcloud container clusters create-auto labels-gke --region=us-central1
sim files load kubernetes-config-labels
kubectl apply -f labeled-configs.yaml
kubectl label cm settings-dev app=web environment=staging
kubectl label cm settings-prod app=web environment=production --overwrite
kubectl label cm/settings-prod temporary-
kubectl label secret/credentials app=web environment=production
kubectl get cm -l app=web,environment=production
kubectl get secrets -l environment=production
kubectl exec deployment/web -- printenv MODE
```

`metadata.labels`はConfigMapとOpaque Secretでも使えます。`kubectl label TYPE NAME KEY=VALUE…`または`TYPE/NAME`で追加し、既存の値を変更する場合は`--overwrite`を付けます。空の値（`KEY=`）も有効です。`KEY-`で削除し、存在しないキーの削除や同じ値の再指定は変更なしです。種別の別名は`cm/configmap/configmaps`と`secret/secrets`。1リソースだけが対象で、Deployment/Service/Podへのlabel、複数名・`--all`・`--list`・ファイル指定は未対応です。同一コマンド内の重複キー・不正値・100ラベルを超える結果は一切反映しません。

`get cm/secrets -l`は既存のラベル規則で`key=value`・`key==value`のAND条件を使います。`-n`とコンテキストの既定namespace、`-A`にも対応し、名前付きgetとの併用は拒否します。`get all`にはConfigMap/Secretを含めません。get/describeの構造化metadataとプロパティにもラベルを表示します。Secretの一覧・describe・プロパティ・label応答はデータ値を隠し、明示したgetのJSON/YAMLは従来どおりbase64 dataを返します。labelには対象種別のgetとupdate、絞り込み一覧にはlistを要求します。

ConfigMap/Secretのapplyはデータキーとラベルキーを別々に管理します。前回applyに含めたラベルをファイルから省くと削除し、CLIで追加した未管理ラベルは保持します。CLIで削除したラベルもファイルに残っていれば再applyで戻ります。`create -f`だけでは管理キーを記録しません。ラベル変更は作成日時・設定データ・Deploymentのrevision・起動済みPodの環境変数を保ちます。ServiceのselectorはPodラベルを選ぶため、設定リソースのラベルでは接続先が変わりません。

ミッション「ラベルでConfigMap・Secretを分類する」は3つの設定を分類し、temporaryラベルを消すと達成します。参照元のデータとwebのnginx:1・1レプリカ・revision 1も条件です。Snapshot v22は設定ラベルとapply管理キーを保存します。v1〜v19は空ラベル・空管理キーへ補完し、v18/v19のnamespace・コンテキスト設定・probe・HPA・履歴・Pod内の値を引き継ぎます。


## 変更できないConfigMap・Secret

```sh
gcloud services enable container.googleapis.com
gcloud container clusters create-auto immutable-gke --region=us-central1
sim files load kubernetes-immutable
kubectl apply -f frozen-settings.yaml
kubectl apply -f frozen-credentials.yaml
kubectl apply -f frozen-web.yaml
kubectl get cm frozen-settings -o yaml
sim files replace frozen-settings.yaml --search=staging --replacement=production
kubectl apply -f frozen-settings.yaml
```

最後のapplyは`data is immutable`で失敗します。ConfigMapとOpaque Secretはトップレベルの`immutable: true`を持てます。新規で省略した場合とliteral作成はfalseで、mutableな設定は更新時にtrueへ変更できます。一度trueにした設定のデータキーの追加・削除・値変更と、falseへ戻す更新は拒否します。Secretはbase64 dataとstringDataを解決した実際の値で比べます。同じデータの再apply、CLIやmanifestによるラベル更新は可能です。既存設定へのapplyでimmutableを省略すると現在値を保持する教材モデルで、immutableフィールドの三方向マージは再現しません。

値を変えるには設定を削除・再作成するか、別名の設定へ参照を切り替えます。教材では同名の設定を作り直します。

```sh
sim files replace frozen-credentials.yaml --search=demo-token-v1 --replacement=demo-token-v2
kubectl delete -f frozen-settings.yaml
kubectl apply -f frozen-settings.yaml
kubectl delete -f frozen-credentials.yaml
kubectl apply -f frozen-credentials.yaml
kubectl exec deployment/frozen-web -- printenv MODE
kubectl exec deployment/frozen-web -- printenv TOKEN
kubectl rollout restart deployment/frozen-web
kubectl rollout status deployment/frozen-web
kubectl exec deployment/frozen-web -- printenv MODE
kubectl exec deployment/frozen-web -- printenv TOKEN
```

再起動前の2つのPodはstagingとdemo-token-v1、再起動後はproductionとdemo-token-v2を使います。設定削除だけでは既存Podを止めず、新しいPodは参照元がないとCreateContainerConfigErrorで待ちます。設定の再作成で待機Podだけが新しい値を取得します。get/describeとプロパティにimmutableを表示し、Secretの一覧・describe・プロパティは従来どおり値を隠します。明示したSecret getのJSON/YAMLはbase64 dataを返します。

API・種別ごとのget/create/update/delete権限、Namespace/コンテキスト/プロジェクト/クラスタ境界を従来どおり検証します。保護中の変更が混在ファイル内で失敗すると、先行したNamespace・Deployment・Service・ConfigMapの変更とIP採番も確定しません。削除は指定した名前が対象で、編集後のファイルでも削除可能です。immutableは削除保護や暗号化ではなく、設定データの更新を禁止するフラグです。監視負荷削減・kubeletのwatch・volumeや伝播遅延は再現しません。

ミッション「変更できない設定を作り直してPodへ反映する」はファイルとクラスタのMODE=production・TOKEN=demo-token-v2をそろえ、両設定のimmutable: true・参照環境変数・nginx:1・2レプリカ・最後の履歴がrestartであることを確認します。ファイル編集だけ、設定の再作成だけ、1つのPodだけの再作成、literal env、mutableな再作成では達成しません。Snapshot v22はimmutableを保存し、v1〜v20はfalseを補完します。v20のラベルとapply管理キー、Namespace・コンテキスト・Pod環境・probe・HPA・履歴・ファイルを保持します。

参考: [Kubernetes ConfigMaps](https://kubernetes.io/docs/concepts/configuration/configmap/#immutable-configmaps)、[Immutable Secrets](https://kubernetes.io/docs/concepts/configuration/secret/#immutable-secrets)、[環境変数で使うConfigMapの更新](https://kubernetes.io/docs/tutorials/configuration/updating-configuration-via-a-configmap/)。

## ConfigMapのテキストとバイナリを分ける

ConfigMapは`data`にUTF-8の文字列、`binaryData`にbase64で表したバイト列を保存できます。バイナリはUTF-8へ変換せず、正規化したbase64のまま保持します。Secretの`data`とは別の機能で、Secretに`binaryData`は指定できません。この教材のSecretは引き続きUTF-8に限定します。

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: asset-settings
data:
  MODE: production
binaryData:
  asset.bin: AP+AAQ==
```

`asset.bin`は4 bytes（00 ff 80 01）です。両方のmapのキーは英数字・`-`・`_`・`.`を使い、253文字まで。`data`と`binaryData`で同じキーを使えず、教材の合計上限は100キーです。サイズはテキスト値のUTF-8バイト数とバイナリの復号後のバイト数を合計して1 MiBまでとし、base64の文字数・paddingやJSONの記号は数えません。仮想ファイル自体の64,000文字制限は別に適用します。

空のバイナリ値`""`は0 bytesの有効なキーです。base64は通常のalphabetとpaddingに限定し、不正値・空白・URL-safe表記を拒否します。同じバイト列になるpadding bitsの違いは正規化し、同じ設定のapplyを冪等にします。`get -o json/yaml`はbase64を返し、一覧のDATAは両mapのキー数です。describe・プロパティはバイナリのキーとバイト数を表示し、生のバイト列を文字として描画しません。ConfigMapは秘密情報の保管庫ではありません。

- applyは`data`と`binaryData`の管理キーを別々に保存します。前回applyしたキーの省略は削除し、createで配置した未管理キーは保持します。管理しているキーをテキストとバイナリの間で移せますが、保持した未管理キーと衝突する場合は更新を拒否します。
- `immutable: true`はテキストとバイナリの両方を保護します。バイト列・キーの追加/削除を拒否し、同じバイト列の再apply・ラベル変更は可能です。変更するには削除・再作成します。
- `configMapKeyRef`と`set env --from=configmap/NAME`は`data`だけを読みます。`binaryData`のキーは、内容がUTF-8や空のバイト列でも環境変数に使えません。キー参照した新しいPodはCreateContainerConfigErrorとなります。`set env --keys`で選ぶとキー不足として拒否します。
- 既存の起動済みPodの環境変数は保持します。テキストキーをバイナリへ移しても既存Podの値は変えず、新しいPodだけが起動を待ちます。テキストキーを戻すと待機Podが読み直し、既存Podの値はそのままです。
- API・ConfigMapの操作権限、プロジェクト/クラスタ/namespaceの分離、ファイル全体の原子的適用は既存の規則を使います。ファイル入力・表示・環境変数の区別までの教材で、ファイル実行・実バイト通信・`--from-file`・patch/editは未対応です。

```sh
gcloud services enable container.googleapis.com
gcloud container clusters create-auto binary-gke --region=us-central1
sim files load kubernetes-binary-data
kubectl apply -f asset-settings.yaml
kubectl apply -f asset-web.yaml
kubectl get pods
# asset.binを環境変数に参照したためCreateContainerConfigError
kubectl get cm asset-settings -o yaml
kubectl describe cm asset-settings
# binaryDataはAP+AAQ== / 4 bytes、dataのMODEはproduction
sim files replace asset-web.yaml --search='key: asset.bin' --replacement='key: MODE'
kubectl apply -f asset-web.yaml
kubectl rollout status deployment/asset-web
kubectl exec deployment/asset-web -- printenv MODE
```

ミッション「バイナリ設定と環境変数の参照を分ける」はConfigMapとファイルのMODE=production・asset.bin=AP+AAQ==を保持し、Deploymentとファイルの参照をMODEへ修正します。nginx:1・2レプリカ・全PodのReadyとproduction取得を確認します。ファイル編集だけ、literal env、バイナリの削除/変更、1レプリカでは達成しません。

Snapshot v22でbinaryDataとそのapply管理キーを保存します。v1〜v21から空のmap/管理キーを補完し、v21のimmutable・ラベル・テキスト管理キー、namespace・コンテキスト・Pod内の値・probe・HPA・履歴・ファイルを保持します。現行Snapshotの不正base64・キー重複・SecretのbinaryDataは拒否します。

参照: [ConfigMap APIのdata・binaryData](https://kubernetes.io/docs/reference/kubernetes-api/core/config-map-v1/)、[ConfigMapのサイズ・immutable](https://kubernetes.io/docs/concepts/configuration/configmap/)。


## ConfigMap・Secretをファイルへマウントする

```sh
gcloud services enable container.googleapis.com
gcloud container clusters create-auto volume-gke --region=us-central1
sim files load kubernetes-volumes
kubectl apply -f volume-settings.yaml
kubectl apply -f volume-credentials.yaml
kubectl apply -f volume-web.yaml
kubectl get pods
# ContainerCreating: FailedMount — itemsのmissing.confが参照先にない
sim files replace volume-web.yaml --search='key: missing.conf' --replacement='key: app.conf'
kubectl apply -f volume-web.yaml
kubectl rollout status deployment/volume-web
kubectl exec deployment/volume-web -- cat /etc/app/app.conf
kubectl exec deployment/volume-web -- base64 /etc/app/assets/asset.bin
kubectl exec deployment/volume-web -- cat /etc/credentials/TOKEN
```

Pod templateの`spec.volumes`に`configMap.name`または`secret.secretName`を指定し、コンテナの`volumeMounts`で同じvolume名を参照します。省略時は全キーを同名ファイルへ投影し、`items: [{key, path}]`なら選択したキーだけを相対パスへ配置します。ConfigMapのdataとbinaryData、SecretのUTF-8 dataに対応します。`optional: true`では欠落リソース/キーを空として扱い、通常マウントは参照先を後から作ると反映します。subPathに選んだファイルがなければ起動できません。`readOnly`はbooleanとして保存し、設定volumeの内容は本教材では常に読み取り専用です。

volumeとmountは各20個まで、itemsは100件まで。volume名は重複不可、パスは空・`.`・`..`・制御文字・バックスラッシュを拒否します。mountPathは絶対パス、items.pathとsubPathは相対パスです。重複/包含関係のitemsパスとmountPathは教材の単純化のため拒否します。subPathはファイル1個に限定し、ディレクトリsubPath・subPathExpr・defaultMode/items.mode・projected/emptyDir等は未対応として拒否します。

必要な参照先がない場合もDeploymentのapplyは成功しますが、Podは`ContainerCreating`となりFailedMountを表示します。get/describe、rollout status、logs/exec、Service接続先、HPAの準備状態判定に同じ待機状態を反映します。参照先を修復すると待機Podが起動します。開始前のPodには環境変数の成功キャッシュを保存しません。起動済みPodの投影更新で必要なリソース/キーが失われた場合は前回の設定投影全体を保持し、同居するPVCの内容は最新の永続データを使い、新しいPodだけを待機させる教材モデルです。

`exec -- cat PATH`はマウント済みのUTF-8ファイルを読み、`base64 PATH`はバイト列をbase64で表示します。非UTF-8のcatは説明付きで拒否します。Pod名・pod/NAME・deployment/NAMEに対応し、Deploymentでは先頭Podを選びます。実シェル、任意プログラム、コンテナイメージ内やホストのファイルへアクセスしません。execには従来どおりcontainer.pods.execとContainer APIが必要です。Secretを明示的にcatした場合は値が出ますが、プロパティではファイルのパスとバイト数だけを表示します。

## 通常マウント・subPath・環境変数の更新差

```sh
gcloud container clusters create-auto reload-gke --region=us-central1
sim files load kubernetes-volume-refresh
kubectl apply -f reload-settings.yaml
kubectl apply -f reload-web.yaml
sim files replace reload-settings.yaml --search='MODE: staging' --replacement='MODE: production'
kubectl apply -f reload-settings.yaml
kubectl exec deployment/reload-web -- cat /etc/config/MODE
# production（通常マウント）
kubectl exec deployment/reload-web -- cat /etc/mode.conf
# staging（subPath）
kubectl exec deployment/reload-web -- printenv MODE
# staging（環境変数）
kubectl rollout restart deployment/reload-web
kubectl rollout status deployment/reload-web
# 再作成後は3つともproduction
```

実環境では通常マウントの更新に遅延がありますが、この教材では設定変更を確定する操作の時点で即時投影し、タイマーやkubeletキャッシュを再現しません。subPathの内容はPod単位で保存し、設定変更でも保持します。1つのPod削除ではそのPodだけ新しい内容になり、scaleで追加したPodも現在値を取得します。コンテナのliveness/startup再起動では同じPodのsubPathを保持します。volume/mountのtemplate変更は1つのrevisionを作り、再applyは冪等、undoは元のマウント設定を復元して現在の参照先から新しいPodを作ります。

ミッション「設定ファイルのマウント障害を直す」と「マウントと環境変数の更新差を確認する」を追加しました。ファイルとクラスタのマウント設定、nginx:1・2レプリカ・全Podの準備と内容を確認します。更新差のミッションでは参照環境変数とrestart履歴も必要です。編集だけ、設定更新だけ、1つのPodだけの再作成では達成しません。

Snapshot v23はvolume/mountを現在templateと履歴へ保存し、Podごとの投影バイト列をbase64で保存します。通常マウントと古いsubPathが異なる状態も保持します。v1〜v22は空のvolume/mount/Podファイルへ補完し、従来の環境変数・immutable・binaryData・ラベル・namespace・コンテキスト・probe/HPA・履歴・仮想ファイルを保持します。不正なパス・base64・他Podのキャッシュや現在templateと履歴の不一致は拒否します。

仕様の参照元: [ConfigMaps](https://kubernetes.io/docs/concepts/configuration/configmap/)、[Secrets](https://kubernetes.io/docs/concepts/configuration/secret/)、[Volumes](https://kubernetes.io/docs/concepts/storage/volumes/)。

## PVC・StorageClass・PVと永続データ

```sh
gcloud services enable container.googleapis.com
gcloud container clusters create-auto storage-gke --region=us-central1
sim files load kubernetes-storage
kubectl apply -f storage-claim.yaml
kubectl apply -f storage-web.yaml
kubectl describe pvc app-data
kubectl get pods
# StorageClass archiveがなくPVCはPending、PodはContainerCreating/FailedMount
kubectl apply -f archive-class.yaml
kubectl get storageclasses
kubectl get pvc
kubectl get pv
# 利用Podが存在するためWaitForFirstConsumerのPVCをBoundへ進める
sim files replace storage-claim.yaml --search=1Gi --replacement=2Gi
kubectl apply -f storage-claim.yaml
sim kubernetes write-file storage-web --path=/data/message.txt --content=survives-restart
kubectl rollout restart deployment/storage-web
kubectl exec deployment/storage-web -- cat /data/message.txt
# 同じPVからsurvives-restartを読む
```

対応するStorageClassは`storage.k8s.io/v1`、provisionerは`pd.csi.storage.gke.io`のみです。parameters.typeは`pd-balanced`/`pd-ssd`（省略時pd-balanced）、volumeBindingModeは`Immediate`（省略時）/`WaitForFirstConsumer`、reclaimPolicyは`Delete`（省略時）/`Retain`、allowVolumeExpansionはboolean（省略時false）です。名前と対応するフィールド以外は拒否します。プロビジョナ・parameters・binding mode・reclaimPolicyの更新は拒否し、拡張許可は更新できます。既存PVは作成時のreclaimPolicyを保持します。

各クラスタには読み取り専用の`standard-rwo`（pd-balanced）と`premium-rwo`（pd-ssd）を導出します。両方ともWaitForFirstConsumer・Delete・拡張可能です。これはCSIストレージの教材セットであり、実際のStandard/Autopilotの既定StorageClass選択は再現しません。PVCはstorageClassNameの明示を必須とし、空文字なら動的割り当てを行わずPendingとなります。クラスが欠落していてもPVC作成は成功し、あとから対応クラスを作ると復旧できます。

PVCは`v1 PersistentVolumeClaim`、accessModesは`[ReadWriteOnce]`、volumeModeはFilesystem（省略可）、resources.requests.storageは文字列の整数1Gi〜1024Giに限定します。ReadWriteOnceは1ノードへの読み書きで、1 Podだけに制限する意味ではありません。教材では複数Pod/Deploymentによる同じPVCの利用を許可し、ノード配置・Multi-Attach制約・ディスク性能は計算しません。PVCのStorageClass変更・容量縮小は拒否し、Bound後の拡張には現在クラスのallowVolumeExpansion=trueが必要です。容量は即反映し、実ファイルシステムの拡張待ちや失敗・クォータを再現しません。

PVは動的割り当てで生成し、クラスタ内で一意の名前を持ちます。ImmediateはPVC作成時、WaitForFirstConsumerは参照するDeploymentに1つ以上のPodができた時に割り当てます。replicas=0だけでは割り当てず、Boundになった後は利用Podがなくても保持します。PVCはnamespace内、StorageClass/PVはクラスタ全体のリソースです。get/describe/deleteの別名はpvc/pv/sc、JSON/YAMLとget -Aにも対応し、PV/SCにはNAMESPACE列を追加しません。get allは既存kubectlと同じ対象範囲を維持し、PVC/PV/SCを含めません。

Deploymentのvolumeに`persistentVolumeClaim: {claimName, readOnly?}`を指定し、volumeMountsのmountPathへディレクトリとしてマウントします。参照PVCの欠落/PendingはFailedMountとなり、Ready・Service・HPA・rollout・logs/execへ反映します。PVCのマウントにはsubPathを許可しません。設定volumeとの混在、template履歴・undo、Pod再作成・scale・liveness/startupのコンテナ再起動も既存のルールに従います。

`sim kubernetes write-file DEPLOYMENT --path=/data/FILE --content=TEXT`はアプリの書き込みを模擬する教材専用操作です。namespaceとコンテキストの規則を使い、先頭の起動可能PodのPVCマウント内へUTF-8文字列を書きます。volume側またはmount側のreadOnlyなら拒否します。`.`/`..`・ホスト/イメージ内のパス・設定volumeへの書き込み・既存ファイルと包含関係のパスは拒否します。内容は展開・実行せず、1 PVにつき100ファイル・UTF-8で合計1 MiBまでです。実ディスクの要求容量とは別の保存上限です。cat/base64で読み、プロパティはパス・ファイル数・バイト数だけを表示します。PV内の内容はPodの再起動/再作成/scaleやDeployment削除では消えません。

利用中PVCのdeleteは削除要求を記録し、get一覧ではTerminatingになります。利用Podが残る間はPV/データと既存マウントを保持し、applyによる変更は拒否します。参照Deploymentの削除・scale=0・templateからの参照解除により全利用Podがなくなった時にPVC削除を完了します。Delete方針はPVと教材データを削除し、Retain方針はPVをReleasedにして内容を残します。新しい同名PVCはReleased PVを自動再利用せず、新しい空のPVを得ます。Bound PVは削除を拒否し、Released PVのdeleteは教材のPV記録を片付けます。実環境ではRetainのディスクはPVオブジェクトを削除しただけでは消えず、別のディスク管理操作が必要です。本教材にはその独立したディスクを作りません。

namespace削除は利用Deploymentを取り除いてPVCの削除を完了し、Retain PVはクラスタ配下に残します。クラスタ削除はそのクラスタのPVを含む教材状態を片付けます。実環境の孤立ディスク・課金やクラスタ削除後のディスク回収を再現する動作ではありません。

PVC・StorageClass・PVごとのcontainer.persistentVolumeClaims.* / container.storageClasses.* / container.persistentVolumes.*権限を使います。applyにはgetとcreate/updateを要求し、ファイルの失敗時は先行の割り当てや削除要求も原子的に戻します。container.admin/developerは対応操作、container.viewerとviewerは読み取り権限を持ちます。write-fileはcontainer.deployments.getとcontainer.pods.exec、すべての操作はContainer APIと現在クラスタの検証を通ります。namespace RBACとCSIドライバのSA/Compute権限は再現しません。

Snapshot v24で独自StorageClass・PVCの容量/割り当て/削除要求・PVの保持方針/Released/ファイルを保存します。v1〜v23は空ストレージを追加し、v23の投影ファイル・古いsubPath・環境変数・履歴と以前のprobe/HPA・namespace/コンテキスト等を保持します。不正な容量・参照・同名PV・パス・base64を拒否します。

ミッション「PVCを割り当てて再起動後もデータを保つ」と「PVC削除後にRetainでデータを残す」は初期Worldから実施できます。前者はマニフェストとライブ設定・2Giへの拡張・全PodのReady・データとrestart履歴、後者はRetain設定・0レプリカ・PVC削除完了・Released PV内の保持内容を確認します。設定の編集だけやTerminating途中では達成しません。

StatefulSet/volumeClaimTemplates、静的PV・volumeNameによる手動バインド、Released PV再利用、PVC/SCのラベル・annotation/既定クラス切替、RWX/ROX/RWOP・Block・Filestore/Hyperdisk・topology/allowedTopologies、PVC subPath、実I/O・ノード配置・ディスク接続/回収・容量不足/拡張待ち・finalizer手動操作は対象外です。

仕様の参照元: [GKE persistent volumes](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/persistent-volumes)、[Storage Classes](https://kubernetes.io/docs/concepts/storage/storage-classes/)、[Persistent Volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)、[GKE IAM権限](https://docs.cloud.google.com/iam/docs/roles-permissions/container)。

## NetworkPolicyでPod通信を制限する

networking.k8s.io/v1のNetworkPolicyを仮想YAML/JSONでcreate/apply/deleteできます。`get/describe/delete netpol`、namespace指定、`get netpol -A`、メタデータラベルによる`-l`、JSON/YAML出力、ツリーとプロパティにも対応します。applyはselector・方向・ルールをファイルの設定へ置き換え、作成日時を保持します。複数文書の途中でエラーになれば全体を取り消します。実kubectlの3-way mergeやCNI処理は再現しません。

Autopilotクラスタは教材の強制機能が有効です。Standardでは`gcloud container clusters create NAME --region=us-central1 --enable-network-policy`で新規作成してください。フラグなしのStandardでもポリシーは保存できますが、通信判定に強制しない旨を表示します。既存クラスタで強制機能を切り替えるupdate操作、実GKEで必要になるノード更新や最小容量は対象外です。

```sh
gcloud services enable container.googleapis.com
gcloud container clusters create-auto policy-gke --region=us-central1
sim files load kubernetes-network-policy
kubectl apply -f network-workloads.yaml
kubectl apply -f deny-ingress.json
kubectl apply -f deny-egress.json
sim kubernetes connect client --to=backend --port=8080
sim files replace allow-ingress.json --search=wrong-client --replacement=client
kubectl apply -f allow-ingress.json
sim kubernetes connect client --to=backend --port=8080
sim files replace allow-egress.json --search=wrong-backend --replacement=backend
kubectl apply -f allow-egress.json
sim kubernetes connect client --to=backend --port=8080
sim kubernetes connect intruder --to=backend --port=8080
sim kubernetes connect client --to=backend --port=8081
kubectl get netpol
kubectl describe netpol allow-client
```

最初はIngress/EgressともDENIED、受信側の修正後もEgressでDENIED、両方の修正後はALLOWEDです。intruderと8081は遮断を保ちます。判定は現在のPodラベルから毎回導出し、Pod再作成は要求しません。

| 設定 | 教材の判定 |
|---|---|
| Pod・方向を選ぶポリシーがない | その方向を許可 |
| `podSelector: {}` | ポリシーと同じnamespaceの全Podを選択 |
| 対象方向の許可ルールなし | その方向で分離。他のポリシーによる許可がなければ遮断 |
| 複数のポリシー・ルール | 許可を合算。評価順序や明示denyの優先順位なし |
| 送信と受信 | 送信元Egress・宛先Ingressの両方が許可した場合だけ許可 |
| 同じpeerのnamespaceSelectorとpodSelector | AND条件 |
| 別々のpeer | OR条件 |
| podSelectorだけのpeer | ポリシーと同じnamespace内で照合 |
| `namespaceSelector: {}` | 全namespaceで照合 |
| 空peer `{}`、空/省略したfrom・to | 全namespaceの全Pod |
| 省略したports | 教材が扱う全TCP宛先ポート |
| policyTypesの省略 | Ingress。空でないegressルールがあればEgressも追加 |

`sim kubernetes connect`は2つのDeploymentの先頭Pod間の新規TCP通信を模擬判定します。`-n/--namespace`は送信元、`--to-namespace`は宛先です。0レプリカ、設定不足、イメージ取得失敗など待機中のPodは評価を拒否します。Readyだけが失敗したPodの直接通信は評価できます。自分自身への通信と許可済み通信の返信は許可扱いです。遮断してもPodのReadyやServiceの接続先を変更しません。ServiceのIP、DNS、NAT、外部通信、待受プロセス、実パケット、既存接続やCNIの反映時間は扱いません。

selectorはmatchLabelsの等価条件、namespaceラベルは自動の`kubernetes.io/metadata.name`だけを扱います。TCPポートは数値1〜65535です。任意のnamespaceラベル、matchExpressions、ipBlock、名前付きポート、endPort、UDP/SCTP等は成功扱いにせず拒否します。実際のNetworkPolicyはこれらも扱えるため、このTCP限定の教材モデルをそのまま実クラスタの疎通保証として使わないでください。

namespaceを跨ぐ教材は同じバンドルの`network-namespaces.yaml`、`cross-workloads.yaml`、`cross-deny.yaml`をapplyし、`cross-ingress.json`のwrong-clientと`cross-egress.json`のwrong-backendを直してapplyします。`sim kubernetes connect client -n client-ns --to=backend --to-namespace=data-ns --port=8080`で許可、送信元other-ns・宛先intruder・8081では遮断します。同じpeerのnamespaceとPod条件を分けると許可範囲が広がります。

2ミッション「NetworkPolicyで必要なPod通信だけを許可する」「namespaceとPodラベルで通信先を絞る」は初期Worldから開始できます。ファイルとライブポリシーの一致、既定遮断の維持、両方向の許可、余分な通信の遮断を確認します。後者は同じpeerのAND条件も確認します。編集だけ・片方向の修正・全許可では達成しません。全64ミッション・306コマンドです。

Snapshot v25はポリシーとクラスタの強制状態を保存します。v1〜v24には空ポリシーとAutopilot有効/Standard無効を追加し、v24のPVC/PV/StorageClass・永続データと従来の設定・Pod環境・probe・HPA・履歴・namespace/コンテキストを保持します。namespace/クラスタの削除時は関連ポリシーも削除します。

仕様の参照元: [Network Policies](https://kubernetes.io/docs/concepts/services-networking/network-policies/)、[NetworkPolicy API](https://kubernetes.io/docs/reference/kubernetes-api/networking/network-policy-v1/)、[GKE NetworkPolicy](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/network-policy)、[GKE IAM権限](https://docs.cloud.google.com/iam/docs/roles-permissions/container)。

## IngressでHTTPを振り分ける

networking.k8s.io/v1の限定IngressをYAML/JSONでcreate/apply/deleteできます。`get/describe/delete ingress`（`ingresses`・`ing`・`ingresses.networking.k8s.io`）、`-n`、`get ing -A`、メタデータラベルの`-l`、JSON/YAML、ツリーとプロパティに対応します。applyはlabels・annotations・ルール・defaultBackendを全体置換し、作成日時を保持します。途中でエラーになる複数文書は全体を取り消します。実kubectlの3-way mergeは行いません。

```sh
gcloud services enable container.googleapis.com
gcloud container clusters create-auto ingress-gke --region=us-central1
sim files load kubernetes-ingress
kubectl apply -f ingress-workloads.yaml
kubectl apply -f ingress-routes.json
kubectl describe ing app-entry
sim kubernetes request app-entry --host=app.example.test --path=/api/users
sim files replace ingress-routes.json --search=wrong-api --replacement=api
kubectl apply -f ingress-routes.json
sim kubernetes request app-entry --host=app.example.test --path=/api/health
sim kubernetes request app-entry --host=app.example.test --path=/api/health/detail
sim kubernetes request app-entry --host=app.example.test --path=/apix
kubectl get ing -o yaml
```

`app.example.test`だけを対象に、`/`はweb、`/api`以下はapi、`/api/health`のExactはhealthへ振り分けます。`/api/health/detail`はapi、`/apix`はwebです。DNS形式のhostは完全一致（入力ホストの大文字小文字は無視）で、host省略は全ホストに一致します。パスは大文字小文字を区別し、Prefixは`/`で区切った要素単位で判定します。Prefixの末尾`/`は無視します。複数一致は最長パス、同じ長さならExact、さらに同順位なら名前付きhostを優先する教材モデルです。未一致は任意のdefaultBackendへ送ります。なければ`NO_ROUTE`となり、実HTTPの応答コードや本文は生成しません。

バックエンドは同じnamespaceの`service.name`と`service.port.number`を参照します。Service port 80、targetPort 8080ならIngressの指定は80です。NodePort Serviceのみを扱い、Service selectorに一致するReadyなPodのtargetPortを接続先として表示します。参照切れ、Service type/port違い、Readyな接続先なしは`BACKEND_UNAVAILABLE`と診断します。存在しないServiceを参照するIngress自体は保存できるため、applyの順序やService削除/再作成も確認できます。リクエストは選んだ接続先だけを判定し、別ルートの障害はdescribeの診断に残ります。実LBの構成完了やヘルスチェック成功を保証する状態ではありません。

この教材はGKE外部`gce`を想定し、`kubernetes.io/ingress.class: gce`またはannotation省略を扱います。GKEはこのannotationでcontrollerを選ぶため、`spec.ingressClassName`はこの教材では拒否します。TLS、内部gce-internal/他controller、ワイルドカードhost/path、ImplementationSpecific、名前付きService port、resource backend、NEG・BackendConfig・その他annotationは未対応として拒否します。ルール/パスの合計は32件まで、同じhost/pathType/pathの重複も拒否します。pathは`/`で始め、query・fragment・空白を含められません。

`sim kubernetes request INGRESS --host=HOST [--path=/PATH] [-n NS]`は読み取り専用です。実LB、外部IP、DNS、TLS、HTTP通信・待受確認、GKE LBヘルスチェック、外部クライアントとNetworkPolicyの関係を再現しません。ADDRESSは`<simulated>`、APIの`status.loadBalancer`は空です。実GKEではNEGを使う構成や別途LBヘルスチェックがあり、Pod readinessだけでLBの状態を判断できません。

復旧ミッションは独立した初期Worldから次の手順で実施できます。

```sh
gcloud services enable container.googleapis.com
gcloud container clusters create-auto ingress-fix-gke --region=us-central1
sim files load kubernetes-ingress
kubectl apply -f ingress-recovery.yaml
kubectl apply -f ingress-broken.json
sim kubernetes request recovery-entry --host=app.example.test --path=/
sim files replace ingress-broken.json --search=8080 --replacement=80
kubectl apply -f ingress-broken.json
sim files replace ingress-recovery.yaml --search=wrong-recovery --replacement=recovery
kubectl apply -f ingress-recovery.yaml
kubectl get endpoints recovery
sim kubernetes probe recovery --status-code=200
sim kubernetes request recovery-entry --host=app.example.test --path=/
```

2ミッション「Ingressでホストとパスを振り分ける」「IngressからReadyなService接続先を復旧する」は、ファイルとライブ設定の一致、指定ルート、2個のReadyな接続先を確認します。編集だけ・portだけ・selectorだけの修正では達成しません。全64ミッション・306コマンドです。

Snapshot v26はIngressを保存し、v1〜v25に空のIngress集合を補完します。v25のNetworkPolicy/クラスタ強制状態、PVC/PVのデータ、Service・Pod環境・probe・HPA・履歴・namespace/コンテキスト・仮想ファイルを保持します。namespace/クラスタ削除時はIngressも削除し、Service単体の削除時はIngressを残して参照切れを診断します。

仕様の参照元: [Kubernetes Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/)、[Ingress API](https://kubernetes.io/docs/reference/kubernetes-api/networking/ingress-v1/)、[GKE Ingress](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/ingress)、[GKE外部Ingress](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/load-balance-ingress)、[GKE Ingress health checks](https://docs.cloud.google.com/kubernetes-engine/docs/troubleshooting/ingress-health-checks)。

## GKE Standardのノードプール運用

既定の`default-pool`も保存するリソースとして扱います。作成時のmachine type・boot disk size、ノード数、Kubernetes版、自動修復・自動更新、プール単位の自動スケール上下限をget/describe・ツリー・プロパティで確認できます。`clusters resize --node-pool=NAME`は指定プールだけを変更し、省略ならdefault-poolを対象にします。プールの削除後は一覧から消え、同名プールを新規作成できます。

```sh
gcloud services enable container.googleapis.com
gcloud container clusters create ops-gke --zone=us-central1-a --num-nodes=2
gcloud container node-pools create apps --cluster=ops-gke --zone=us-central1-a --machine-type=e2-standard-4 --disk-size=200 --num-nodes=4
gcloud container clusters resize ops-gke --zone=us-central1-a --node-pool=apps --num-nodes=3 --quiet
gcloud container clusters upgrade ops-gke --zone=us-central1-a --master --quiet
gcloud container node-pools list --cluster=ops-gke --zone=us-central1-a
gcloud container clusters upgrade ops-gke --zone=us-central1-a --node-pool=apps --quiet
```

制御プレーンと既存ノードの版を独立して保存します。`--master`で更新してもノードの版は変わりません。ノード更新は明示した`--node-pool`だけが対象で、指定版を省略すると現在の制御プレーン版になります。教材に収録した1.31.5-gke.1068000→1.32.2-gke.1182000のみを扱い、制御プレーンより新しい版・ダウングレード・未収録版・masterとnode-poolの同時指定を拒否します。省略による全プール更新は未対応です。

```sh
gcloud container node-pools update apps --cluster=ops-gke --zone=us-central1-a --enable-autoscaling --min-nodes=1 --max-nodes=4
sim gke autoscale-nodes apps --cluster=ops-gke --zone=us-central1-a --required-nodes=10
sim gke autoscale-nodes apps --cluster=ops-gke --zone=us-central1-a --required-nodes=0
gcloud container node-pools update apps --cluster=ops-gke --zone=us-central1-a --no-enable-autoscaling
gcloud container node-pools update apps --cluster=ops-gke --zone=us-central1-a --no-enable-autorepair --no-enable-autoupgrade
```

設定だけではノード数を変えません。`sim gke autoscale-nodes`が明示した必要数を上下限へ収めて1回評価し、評価前後の数を保存します。上の例は必要数10を4へ、0を1へ制限します。必要数はPod配置やCPU測定から算出せず、クラスタオートスケーラーとHPAの違いを学ぶ教材入力です。実GKEのクラスタオートスケーラーはPodのresource requestsと配置可能性を基に判断します。

上下限を指定するときは`--enable-autoscaling`が必要です。既存の上下限は片方だけ変更できます。無効化や上下限変更では前回評価を消し、管理設定だけの変更では保持します。自動スケール設定と自動修復/更新は別コマンドで変更します。自動スケール中の手動resizeは、この教材では先に無効化する必要があります。設定済みの自動修復/更新による定期処理は再現せず、ノード更新は明示したupgrade操作だけで行います。

ノード数/上下限は各プール0〜1000（最大上限は1以上）、boot diskは10〜65536 GB、必要数入力は0〜1000000です。ノード数・上下限はzoneあたりの設定値として保存し、クラスタのnodeCountはそれらの教材上の合計です。リージョン内の複数zone配置・実際の総VM数や可用性は再現しません。Autopilotのユーザー管理プール操作、total-min/max-nodes・node locations・node labels/taints・machine/disk変更・upgrade戦略/サージ・ノードSAごとのPod割り当て・Workload Identity・quota/実VM・drain/PDB/eviction・実スケジューリング/自動修復は対象外です。プール削除やサイズ0でも既存Podを変更しません。

Snapshot v27に既定プールと管理/自動スケール設定・前回評価を保存します。v1〜v26では旧クラスタの既定プールを明示化し、追加プールとノード数・disk・版を保持します。管理設定はtrue、自動スケールは無効・未評価で補完します。旧形式には既定ノード独自の版がないため、旧クラスタの保存済みmaster版を引き継ぎます。v26のIngress、NetworkPolicy、PVC/PVデータと従来の状態を保持します。

独立した2ミッションで、制御プレーン/ノードの別更新と、管理設定・上下限・明示評価を確認します。

参照: [node-pools update](https://docs.cloud.google.com/sdk/gcloud/reference/container/node-pools/update)、[clusters upgrade](https://docs.cloud.google.com/sdk/gcloud/reference/container/clusters/upgrade)、[GKE cluster autoscaling](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/cluster-autoscaler)。
