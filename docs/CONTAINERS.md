# Docker・Artifact Registry・Cloud Build 学習シミュレーター

Issue [#14](https://github.com/DIO0550/gcloud-sim/issues/14) の部分実装です。ローカルイメージ・コンテナとクラウドのリポジトリ・イメージを別状態で扱い、ビルド、起動、タグ付け、push/pull、IAM、片付けを練習します。実Docker、ホスト上のファイル、クラウド、HTTPには接続しません。

## ローカルでビルドして起動する

```sh
sim docker example ./hello-web
docker build -t hello:v1 ./hello-web
docker images
docker run -d --name hello-local -p 8080:8080 hello:v1
docker ps
docker logs hello-local
docker inspect hello-local
sim docker request hello-local
```

`sim docker example` は組み込み教材のDockerfileとserver.jsを表示します。buildのcontextは `.` / `hello-web` / `./hello-web`（v1）、`hello-web-v2` / `./hello-web-v2`（v2）だけです。ファイルの読込やDockerfileの実行はしません。同じ教材は同じ疑似digestになり、別名のtagは同じイメージを指します。digestは実際のSHA-256計算結果ではありません。

runは `-d` 必須です。名前を省くとlesson-番号を割り当てます。`-p HOST:CONTAINER` は1組、1〜65535のTCPポートに対応し、実行中コンテナ間のホストポート重複を拒否します。アプリは教材上8080で待ち受けるため、`8080:80` では `sim docker request` が失敗します。sim docker requestは状態を検査して固定HTTP応答を表示するアプリ専用コマンドです。実際のlocalhostにアクセスするものではありません。

```sh
docker stop hello-local
docker ps -a
docker rm hello-local
docker rmi hello:v1
```

stopはコンテナを保持して公開ポートを解放し、rmはコンテナを削除します。実行中のrmは `-f` が必要です。rmiは1つのローカルタグ、または複数タグを持たないイメージIDを削除します。コンテナが参照するイメージの最後の参照は削除できません。レジストリ上のイメージは残ります。

## リポジトリへpushする

```sh
gcloud services enable artifactregistry.googleapis.com
gcloud artifacts repositories create ace-images --repository-format=docker --location=us-central1
gcloud artifacts repositories list --location=us-central1
gcloud artifacts repositories describe ace-images --location=us-central1
gcloud auth configure-docker us-central1-docker.pkg.dev
docker build -t hello:v1 ./hello-web
docker tag hello:v1 us-central1-docker.pkg.dev/ace-dev-01/ace-images/hello:v1
docker push us-central1-docker.pkg.dev/ace-dev-01/ace-images/hello:v1
gcloud artifacts docker images list us-central1-docker.pkg.dev/ace-dev-01/ace-images --include-tags
gcloud artifacts docker images describe us-central1-docker.pkg.dev/ace-dev-01/ace-images/hello:v1
```

- 対応形式はstandard Docker repositoryのみです。ロケーションは既存カタログの5リージョンとus/europe/asia。repository IDは2〜63文字の小文字英数字・ハイフンで、先頭は英字、末尾は英数字です。同名でもproject/locationが異なれば別リポジトリです。
- イメージ参照は `LOCATION-docker.pkg.dev/PROJECT/REPOSITORY/IMAGE:TAG`。タグ省略はlatest、IMAGEのサブパスも使えます。build/tag/pushはタグを指定し、pull/describeは `IMAGE@sha256:...` でも参照できます。digestはimages list/describeで確認します。
- `gcloud auth configure-docker` は指定ホストだけに疑似credential helperを設定します。カンマ区切りで複数ホストを指定できます。秘密情報や実ファイルは書き込みません。push/pullは**その時点のgcloudアカウント**を使い、Terraformで使うADCとは別です。
- API有効化、操作対象project、リポジトリの存在、project/folder/organizationから継承したIAMとrepository IAMを検証します。read-onlyユーザーのpush、別リポジトリへの権限流用、存在しないタグを拒否します。
- 通常のpushはタグの参照先を更新し、古いdigestのバージョンを残します。createの `--immutable-tags` を指定すると、同じタグを別digestに付け替えられません。ローカルのdocker tagはリモートを変更しません。

## pullと読み取り専用の共有

```sh
gcloud artifacts repositories add-iam-policy-binding ace-images --location=us-central1 --member=user:developer@example.com --role=roles/artifactregistry.reader
gcloud artifacts repositories get-iam-policy ace-images --location=us-central1
gcloud auth login developer@example.com
docker pull us-central1-docker.pkg.dev/ace-dev-01/ace-images/hello:v1
docker push us-central1-docker.pkg.dev/ace-dev-01/ace-images/hello:v1
```

最後のpushは、ほかに書込権限の付与がなければ失敗します。readerはダウンロード、writerはアップロード、adminは作成/削除とIAM設定も許します。収録する権限は学習用の部分集合です。リポジトリ単位のwriterではプロジェクト配下の新規リポジトリを作成できません。

pullはローカルのイメージを追加・更新します。runでローカルに対象イメージがなければArtifact Registryから自動pullを試します。ローカルにあればリポジトリを参照せず起動します。タグが更新されても既存コンテナは起動時のイメージIDを保持するため、表示するログ・疑似応答は変わりません。

```sh
gcloud auth login owner@example.com
gcloud artifacts repositories delete ace-images --location=us-central1
y
```

deleteはリポジトリと保存したイメージを確認後に削除します。`n` でキャンセル、`--quiet` で確認を省略できます。ローカルキャッシュ・コンテナは残り、キャッシュ済みコンテナの教材動作は継続します。

## 表示・保存・ミッション

- リソースツリーは各projectのArtifact Registryと、project外の「Docker（ローカル）」を分けて表示します。選択するとイメージ・コンテナ・リポジトリ設定とIAMを確認できます。
- Snapshot v9に各状態を保存します。v1〜v6は空のコンテナ教材状態を補完します。v6のTerraform GCS backend/state/ロックはそのまま保持します。
- 「Dockerイメージを作りローカルで動かす」「Artifact Registryへイメージを公開する」「イメージを読み取り専用で共有する」の3ミッションを追加しました。buildだけ、tagだけ、誤ったポート、余分な書込権限がある状態では対応するミッションを完了できません。
- 保存量の上限はイメージ/コンテナ/リポジトリ各100、ローカル参照200、リモートバージョン200、各リモートバージョンのタグ100、認証ホスト8です。

## Cloud BuildからGKEへ

ミッション画面は「カテゴリ → ミッション → 達成条件・手順」の順に選択します。カテゴリ別の達成数と挑戦中件数を表示し、一覧へ戻っても進捗と開いたヒントを保持します。

「Cloud Buildでイメージをビルドする」「ビルドしたイメージをGKEへデプロイする」の2ミッションを追加しました。それぞれ初期Worldから開始でき、後者には検証後の片付け手順も含みます。

```sh
gcloud services enable cloudbuild.googleapis.com artifactregistry.googleapis.com container.googleapis.com
gcloud artifacts repositories create ace-images --repository-format=docker --location=us-central1
gcloud iam service-accounts create ace-builder
gcloud iam service-accounts add-iam-policy-binding ace-builder@ace-dev-01.iam.gserviceaccount.com --member=user:owner@example.com --role=roles/iam.serviceAccountUser
gcloud artifacts repositories add-iam-policy-binding ace-images --location=us-central1 --member=serviceAccount:ace-builder@ace-dev-01.iam.gserviceaccount.com --role=roles/artifactregistry.writer
gcloud builds submit ./hello-web --tag=us-central1-docker.pkg.dev/ace-dev-01/ace-images/hello:v1 --service-account=projects/ace-dev-01/serviceAccounts/ace-builder@ace-dev-01.iam.gserviceaccount.com --region=us-central1
gcloud builds list --region=us-central1
```

- 呼出元の`cloudbuild.builds.create`と対象SAの`iam.serviceAccounts.actAs`を確認します。レジストリへ書くのは指定SAです。ユーザーのOwner権限やローカルDocker認証を流用しません。
- 学習範囲を明確にするため、同じビルドプロジェクトに作成済みの`--service-account`を必須にします。既定SAの自動選択は再現しません。
- 同期submitは即時に成功/失敗まで進めます。`--async`はQUEUEDで保存し、`sim builds advance BUILD_ID --region=us-central1`を1回実行するとWORKING、もう1回でSUCCESS/FAILUREになります。読むだけでは進みません。cancelはQUEUED/WORKINGのみ可能です。
- describe/log/cancelはlistに表示されたBUILD_IDを使います。リージョン既定値はglobalで、別リージョン・別プロジェクトのIDは見つかりません。失敗後の履歴・固定ログを残し、再submitは別IDになります。
- 任意のソース・cloudbuild.yaml・実際のDocker処理・ログ転送先/ソース用GCSバケット・Logging権限/サービスエージェント・自動進行は再現しません。実Cloud Buildで独自SAを使う場合にはログの保存先とその権限も設定が必要です。

```sh
gcloud iam service-accounts create ace-nodes
gcloud iam service-accounts add-iam-policy-binding ace-nodes@ace-dev-01.iam.gserviceaccount.com --member=user:owner@example.com --role=roles/iam.serviceAccountUser
gcloud container clusters create-auto ace-gke --region=us-central1 --service-account=ace-nodes@ace-dev-01.iam.gserviceaccount.com
kubectl create deployment hello --image=us-central1-docker.pkg.dev/ace-dev-01/ace-images/hello:v1 --replicas=2
kubectl get pods
# ImagePullBackOff: ノードSAへ読み取り権限を付与する
gcloud artifacts repositories add-iam-policy-binding ace-images --location=us-central1 --member=serviceAccount:ace-nodes@ace-dev-01.iam.gserviceaccount.com --role=roles/artifactregistry.reader
kubectl rollout status deployment/hello
kubectl expose deployment hello --type=LoadBalancer --port=80 --target-port=8080
kubectl get all
# 片付け（削除時は確認あり）
kubectl delete service hello
kubectl delete deployment hello
gcloud container clusters delete ace-gke --region=us-central1
gcloud artifacts repositories delete ace-images --location=us-central1
```

- Artifact RegistryのAPI・リポジトリ・タグ/digest・ノードSAのReader権限を現在の状態から判定します。ユーザーやビルドSAの権限は使いません。Deployment作成自体は成功してもPodは起動待ちとなり、rollout status/logsは成功扱いになりません。
- GKEのノードキャッシュ/リトライ時間/実スケジューラを持たない簡略モデルです。権限付与後は即時に回復し、登録イメージ削除や権限削除後は既存Podも起動待ちになります。node pool個別SA・OAuth scope・既定Compute SA・imagePullSecretsは未対応で、明示指定したクラスタSAを全ノードへ適用します。
- `.pkg.dev`以外の既存公開/教材イメージは従来の簡略動作です。Cloud Runには今回のpull検証を適用しません。
- Snapshot v8で追加したビルド履歴（最大100件）とノードSAは、現行のv9にも保存します。v7のDocker/レジストリ/Terraformは保持し、空の履歴と既定のノードSA設定を補います。完了履歴はリポジトリ・クラスタの片付け後も残します。

参照: [builds submit](https://docs.cloud.google.com/sdk/gcloud/reference/builds/submit)、[独自サービスアカウント](https://docs.cloud.google.com/build/docs/securing-builds/configure-user-specified-service-accounts)、[GKEのイメージ取得](https://docs.cloud.google.com/kubernetes-engine/docs/troubleshooting/image-pulls)。

## リモートのタグ管理・イメージ削除

```sh
docker build -t us-central1-docker.pkg.dev/ace-dev-01/ace-images/hello:v2 ./hello-web-v2
docker push us-central1-docker.pkg.dev/ace-dev-01/ace-images/hello:v2
gcloud artifacts docker tags add us-central1-docker.pkg.dev/ace-dev-01/ace-images/hello:v2 us-central1-docker.pkg.dev/ace-dev-01/ace-images/hello:stable
gcloud artifacts docker tags list us-central1-docker.pkg.dev/ace-dev-01/ace-images/hello
gcloud artifacts docker tags delete us-central1-docker.pkg.dev/ace-dev-01/ace-images/hello:stable
gcloud artifacts docker images delete us-central1-docker.pkg.dev/ace-dev-01/ace-images/hello:v2
```

- `tags add` は同じリポジトリ・イメージパス内でタグを作成/移動します。元は明示したタグかdigest、先は明示したタグです。ローカルの`docker tag`や認証helperを使わず、現在のgcloudアカウント（`--account`で変更可）でリモートだけを操作します。
- `tags list` / `images list` はリポジトリ全体またはイメージパスを受け付けます。タグ/digest付きの一覧指定は拒否します。未タグの版は`images list`に残り、`tags list`には出ません。
- `tags delete` はタグだけを消します。`images delete IMAGE:TAG` はそのタグの版、`IMAGE@DIGEST`は指定版、修飾なしの`IMAGE`はそのパスの全バージョンを消します。タグ指定で他にもタグがある場合、digest/パス指定でタグ付きの場合は`--delete-tags`が必要です。削除は確認に`y`、中止に`n`、省略に`--quiet`を使います。非同期削除は未対応です。
- immutable tagsを設定したリポジトリではタグ移動・タグ削除・タグ付きバージョン削除を拒否します。`--delete-tags`でも回避できません。未タグの版は削除できます。
- Readerは一覧、Writerはタグの作成/移動、`roles/artifactregistry.repoAdmin`はタグ/バージョン/パッケージの削除も許可します。repoAdminはリポジトリ自体の削除やIAM変更は許しません。継承権限も評価します。
- 削除してもローカルキャッシュ・実行中のローカルコンテナ・Cloud Buildの履歴は残ります。GKEは前述の現在状態によるモデルなので、参照先を消すとImagePullBackOffになります。Snapshot v8で追加したコンテナのスキーマをv9でも保持し、タグの移動・未タグ・削除後の状態を保存します。

新ミッションは「リリースタグを新しいイメージへ切り替える」（デプロイと実装）と「残すイメージを守りながらコンテナ教材を片付ける」（運用の維持）です。前者はv1を保持してv2/stableを同じ教材digestにします。後者は開始時に専用リポジトリcleanup-images（old:v1/keep:v2）と公開ポートなしのcleanup-localコンテナ/タグを用意します。停止だけ・タグ削除だけ・リポジトリ全削除は未達成です。他のローカルタグやコンテナは削除する必要がありません。既存のcleanup-imagesは上書きせず、リポジトリ未作成時にcleanup-local名が使われていれば開始を拒否します。

参照: [イメージの管理](https://docs.cloud.google.com/artifact-registry/docs/docker/manage-images)、[tags add](https://docs.cloud.google.com/sdk/gcloud/reference/artifacts/docker/tags/add)、[images delete](https://docs.cloud.google.com/sdk/gcloud/reference/artifacts/docker/images/delete)、[immutable tags](https://docs.cloud.google.com/artifact-registry/docs/docker/names)、[ロールと権限](https://docs.cloud.google.com/iam/docs/roles-permissions/artifactregistry)。

## 残作業

Cloud Buildの任意設定・トリガー・ログ転送/ソース保存先、GKEのキャッシュ/リトライ・ノードプールごとのSA、GKEを含む一連のクリーンアップ採点は残っています。Issue #14は閉じません。

任意Dockerfile、公開registryからのpull、認証トークン/docker login、対話実行・任意コマンド、マウント、環境変数、複数ポート、IPv6、build args/cache/layers、短縮ID、docker image/container系の別名、registryのremote/virtual repository・CMEKなどは未対応です。Dockerのフラグは登録したものとhelpのみを受け付け、gcloud共通フラグを流用しません。実Dockerと異なる出力・固定のログ・一括成功/失敗の簡略モデルであることを表示します。

参照: [Docker run](https://docs.docker.com/reference/cli/docker/container/run/)、[Artifact Registry push/pull](https://docs.cloud.google.com/artifact-registry/docs/docker/pushing-and-pulling)、[Docker認証](https://docs.cloud.google.com/artifact-registry/docs/docker/authentication)、[repository作成](https://docs.cloud.google.com/sdk/gcloud/reference/artifacts/repositories/create)、[アクセス制御](https://docs.cloud.google.com/artifact-registry/docs/access-control)。

GKEの更新履歴・ロールバック・Snapshot v9への移行は[KUBERNETES.md](KUBERNETES.md)を参照してください。
