# GKEの更新とロールバック

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

## 権限・保存・再現範囲

- history/statusは`container.deployments.get`、set image/restart/undoは`container.deployments.update`を要求します。学習用のcontainer.viewerにDeployment/Pod/Serviceの読み取り権限を補い、更新権限と分離しました。クラスタ/API/プロジェクト/アカウントも検証します。
- namespaceはdefaultのみで、別namespaceを指定した操作は拒否します。`get -o json`はJSONの単一リソースまたはList、`-o yaml`は従来のYAML表示です。出力には教材用の列も含みます。
- Snapshot v9に履歴とPod識別子を保存します。v1〜v8は現在のイメージ・世代を1件の履歴として移行し、過去のイメージは推測しません。v8のDocker/レジストリ/ビルド履歴・ノードSA・Terraform状態を保持します。移行後に新しく更新した分からrollbackできます。
- PodはDeploymentから導出します。レプリカ上限はシミュレーターの表示・保存保護のため1000です。実際のKubernetesの上限を表す値ではありません。
- 即時に切り替わる簡略モデルです。ローリング更新中の旧/新Podの共存、maxSurge/maxUnavailable、スケジューラ、進行待ち・timeout、probe、実ネットワーク通信は再現しません。失敗した更新中に旧Podを稼働させ続ける動作も未対応です。
- ReplicaSetは読み取り専用の導出状態です。templateの識別子/Pod名は疑似値で、実際のハッシュ・annotationsは再現しません。イメージ変更/restartごとに新しいtemplateを作り、undoでは保存したtemplateを再利用します。
- `.pkg.dev`以外のイメージは従来の簡略な成功モデルです。実在タグ/コンテナの起動可否の確認はしません。異常系ミッションでは存在確認できる教材レジストリを使います。

namespace、ConfigMap/Secret・環境変数、任意manifest、readiness/liveness、HPA/VPA、StatefulSet/PVC、NetworkPolicy、ノードプール設定やWorkload Identity等は残作業です。Issue #15は閉じません。

参照: [Deploymentの更新とロールバック](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)、[kubectl set image](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_set/kubectl_set_image/)、[kubectl rollout undo](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_undo/)、[GKEのロールと権限](https://docs.cloud.google.com/iam/docs/roles-permissions/container)。
