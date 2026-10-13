# GKE・Kubernetesの操作演習

実在するgcloud・kubectlの構文で、クラスタとワークロードの設定・更新・復旧を練習します。実クラスタへの接続や、HTTP応答・CPU・通信・データ書き込みの独自注入コマンドは提供しません。

## クラスタとDeployment

```sh
gcloud services enable container.googleapis.com
gcloud container clusters create-auto config-gke --region=us-central1
gcloud container clusters get-credentials config-gke --region=us-central1
kubectl create deployment config-web --image=nginx:1 --replicas=2
kubectl get deployments
kubectl get pods
```

## 設定ファイルの編集・適用

CLI画面の「ファイル」タブでkubernetes-configを読み込みます。app-config.yamlとapp-secret.yamlを確認して、ターミナルで適用します。

```sh
kubectl apply -f app-config.yaml
kubectl apply -f app-secret.yaml
kubectl set env deployment/config-web --from=configmap/app-config
kubectl set env deployment/config-web --from=secret/app-secret
kubectl exec deployment/config-web -- printenv APP_MODE
```

「ファイル」タブでapp-config.yamlの`staging`を`production`に変更して保存します。ファイルの保存はクラスタの変更と別の操作です。

```sh
kubectl apply -f app-config.yaml
kubectl exec deployment/config-web -- printenv APP_MODE
kubectl rollout restart deployment/config-web
kubectl rollout status deployment/config-web
kubectl exec deployment/config-web -- printenv APP_MODE
kubectl exec deployment/config-web -- printenv API_TOKEN
```

環境変数は起動時の設定を保持するため、ConfigMapの変更は再起動後に反映されます。Secretには学習用の架空の値を使います。

同名のファイルをテンプレートで更新する場合は、内容を確認して「同名のファイルを置き換える」にチェックを入れます。ファイルの削除は適用済みリソースを削除しません。リソースの削除には`kubectl delete -f FILE`を使います。

## 更新・ロールバック

```sh
kubectl set image deployment/config-web config-web=nginx:2
kubectl rollout status deployment/config-web
kubectl rollout history deployment/config-web
kubectl rollout undo deployment/config-web
kubectl rollout status deployment/config-web
```

コンテナ名は`kubectl describe deployment config-web`で確認できます。更新後のDeployment・ReplicaSet・Podの状態を表示します。

## 他の設定演習

公開ミッションでは、ラベルによるServiceの接続先切り替え、namespaceとコンテキスト、ConfigMap/Secretの分類、immutable設定、テキストとbinaryData、設定ファイルのマウント、requests/limitsとQoS、制御プレーンとノードプールの更新、regional配置を扱います。必要なYAML/JSONは「ファイル」タブから準備します。

設定ファイルは安全な相対パスの.yaml・.yml・.json、32ファイル・1ファイル64,000文字までです。Snapshotに保存され、Terraformとは別の作業領域です。

CPUの実測、probeの実HTTP、実scheduler、NetworkPolicyのパケット検証、外部LB・DNS・TLS接続、実際の永続データ処理は再現しません。これらの独自操作を必要とする旧ミッションは公開一覧から外しています。

[対応コマンド](COMMANDS.md)・[公開範囲](ACE_COVERAGE.md)・[資料対応表](ACE_SOURCE_MAP.md)を参照してください。
