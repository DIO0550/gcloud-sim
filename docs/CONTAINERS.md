# Docker・Artifact Registry 学習シミュレーター（第1段階）

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
- Snapshot v7に各状態を保存します。v1〜v6は空のコンテナ教材状態を補完します。v6のTerraform GCS backend/state/ロックはそのまま保持します。
- 「Dockerイメージを作りローカルで動かす」「Artifact Registryへイメージを公開する」「イメージを読み取り専用で共有する」の3ミッションを追加しました。buildだけ、tagだけ、誤ったポート、余分な書込権限がある状態では対応するミッションを完了できません。
- 保存量の上限はイメージ/コンテナ/リポジトリ各100、ローカル参照200、リモートバージョン200、各リモートバージョンのタグ100、認証ホスト8です。

## 残作業

Cloud Buildのjob・実行サービスアカウント、GKEのイメージ存在・pull権限・失敗状態との連携は次の段階です。既存GKE/Cloud Runへのイメージ文字列指定に、この新しいレジストリ検証はまだ適用しません。Issue #14は閉じません。

任意Dockerfile、公開registryからのpull、認証トークン/docker login、対話実行・任意コマンド、マウント、環境変数、複数ポート、IPv6、build args/cache/layers、短縮ID、docker image/container系の別名、registryのイメージ削除/タグ管理・remote/virtual repository・CMEKなどは未対応です。Dockerのフラグは登録したものとhelpのみを受け付け、gcloud共通フラグを流用しません。実Dockerと異なる出力・固定のログ・一括成功/失敗の簡略モデルであることを表示します。

参照: [Docker run](https://docs.docker.com/reference/cli/docker/container/run/)、[Artifact Registry push/pull](https://docs.cloud.google.com/artifact-registry/docs/docker/pushing-and-pulling)、[Docker認証](https://docs.cloud.google.com/artifact-registry/docs/docker/authentication)、[repository作成](https://docs.cloud.google.com/sdk/gcloud/reference/artifacts/repositories/create)、[アクセス制御](https://docs.cloud.google.com/artifact-registry/docs/access-control)。
