# Docker・Artifact Registry・Cloud Build 学習シミュレーター

現在の操作手順は公開ミッションと[対応コマンド](COMMANDS.md)を参照してください。アプリ独自の操作に依存した旧手順は削除しました。以下は残しているCLI・ドメインモデルの仕様です。過去のミッション数・実装時点の記録は現在の公開演習数を示しません。

Issue [#14](https://github.com/DIO0550/gcloud-sim/issues/14) の限定教材モデルです。ローカルイメージ・コンテナとクラウドのリポジトリ・イメージを別状態で扱い、ビルド、起動、タグ付け、push/pull、IAM、片付けを練習します。実Docker、ホスト上のファイル、クラウド、HTTPには接続しません。

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
- Snapshot v10に各状態を保存します。v1〜v6は空のコンテナ教材状態を補完します。v6のTerraform GCS backend/state/ロックはそのまま保持します。
- 「Dockerイメージを作りローカルで動かす」「Artifact Registryへイメージを公開する」「イメージを読み取り専用で共有する」の3ミッションを追加しました。buildだけ、tagだけ、誤ったポート、余分な書込権限がある状態では対応するミッションを完了できません。
- 保存量の上限はイメージ/コンテナ/リポジトリ各100、ローカル参照200、リモートバージョン200、各リモートバージョンのタグ100、認証ホスト8です。

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
- 削除してもローカルキャッシュ・実行中のローカルコンテナ・Cloud Buildの履歴は残ります。GKEは前述の現在状態によるモデルなので、参照先を消すとImagePullBackOffになります。Snapshot v8で追加したコンテナのスキーマをv10でも保持し、タグの移動・未タグ・削除後の状態を保存します。

新ミッションは「リリースタグを新しいイメージへ切り替える」（デプロイと実装）と「残すイメージを守りながらコンテナ教材を片付ける」（運用の維持）です。前者はv1を保持してv2/stableを同じ教材digestにします。後者は開始時に専用リポジトリcleanup-images（old:v1/keep:v2）と公開ポートなしのcleanup-localコンテナ/タグを用意します。停止だけ・タグ削除だけ・リポジトリ全削除は未達成です。他のローカルタグやコンテナは削除する必要がありません。既存のcleanup-imagesは上書きせず、リポジトリ未作成時にcleanup-local名が使われていれば開始を拒否します。

参照: [イメージの管理](https://docs.cloud.google.com/artifact-registry/docs/docker/manage-images)、[tags add](https://docs.cloud.google.com/sdk/gcloud/reference/artifacts/docker/tags/add)、[images delete](https://docs.cloud.google.com/sdk/gcloud/reference/artifacts/docker/images/delete)、[immutable tags](https://docs.cloud.google.com/artifact-registry/docs/docker/names)、[ロールと権限](https://docs.cloud.google.com/iam/docs/roles-permissions/artifactregistry)。

## 残作業

Cloud Buildの任意設定・トリガー・ログ転送/ソース保存先、GKEのキャッシュ/リトライ・ノードプールごとのSA、固定教材では以下の一連のクリーンアップ採点を追加しました。任意設定や実キャッシュ等は再現対象外です。

任意Dockerfile、公開registryからのpull、認証トークン/docker login、対話実行・任意コマンド、マウント、環境変数、複数ポート、IPv6、build args/cache/layers、短縮ID、docker image/container系の別名、registryのremote/virtual repository・CMEKなどは未対応です。Dockerのフラグは登録したものとhelpのみを受け付け、gcloud共通フラグを流用しません。実Dockerと異なる出力・固定のログ・一括成功/失敗の簡略モデルであることを表示します。

参照: [Docker run](https://docs.docker.com/reference/cli/docker/container/run/)、[Artifact Registry push/pull](https://docs.cloud.google.com/artifact-registry/docs/docker/pushing-and-pulling)、[Docker認証](https://docs.cloud.google.com/artifact-registry/docs/docker/authentication)、[repository作成](https://docs.cloud.google.com/sdk/gcloud/reference/artifacts/repositories/create)、[アクセス制御](https://docs.cloud.google.com/artifact-registry/docs/access-control)。

GKEの更新履歴・ロールバック・Snapshot v10への移行は[KUBERNETES.md](KUBERNETES.md)を参照してください。
