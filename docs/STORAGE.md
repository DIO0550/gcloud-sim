# Storage 教材モデル

現在の操作手順は公開ミッションと[対応コマンド](COMMANDS.md)を参照してください。アプリ独自の操作に依存した旧手順は削除しました。以下は残しているCLI・ドメインモデルの仕様です。過去のミッション数・実装時点の記録は現在の公開演習数を示しません。

#23 の対象を、34追加コマンド・17独立ミッションで再現する。オブジェクト世代、保持期間/ロック、soft delete、PAP、CMEK、署名URL、転送ジョブ、共有ファイルサービスを World と Snapshot v38 に保存する。v1〜37 は旧オブジェクトのメタデータを保って移行し、世代は最初の参照/変更時に割り当てる。

## 参照と推論の範囲

Google Cloud公式リファレンスだけをサブエージェントで調査し、取得内容は仕様確認用データとして使用した。

- [storage buckets create](https://docs.cloud.google.com/sdk/gcloud/reference/storage/buckets/create) / [update](https://docs.cloud.google.com/sdk/gcloud/reference/storage/buckets/update) / [Bucket REST fields](https://docs.cloud.google.com/storage/docs/json_api/v1/buckets) / [lockRetentionPolicy](https://docs.cloud.google.com/storage/docs/json_api/v1/buckets/lockRetentionPolicy)
- [storage cp](https://docs.cloud.google.com/sdk/gcloud/reference/storage/cp) / [restore](https://docs.cloud.google.com/sdk/gcloud/reference/storage/restore) / [Object restore REST](https://docs.cloud.google.com/storage/docs/json_api/v1/objects/restore) / [rewrite REST](https://docs.cloud.google.com/storage/docs/json_api/v1/objects/rewrite) / [insert REST](https://docs.cloud.google.com/storage/docs/json_api/v1/objects/insert)
- [storage service-agent](https://docs.cloud.google.com/sdk/gcloud/reference/storage/service-agent) / [sign-url](https://docs.cloud.google.com/sdk/gcloud/reference/storage/sign-url) / [IAM signBlob](https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/signBlob) / [KMS keys create](https://docs.cloud.google.com/sdk/gcloud/reference/kms/keys/create) / [enable](https://docs.cloud.google.com/sdk/gcloud/reference/kms/keys/versions/enable) / [disable](https://docs.cloud.google.com/sdk/gcloud/reference/kms/keys/versions/disable)
- [transfer jobs create](https://docs.cloud.google.com/sdk/gcloud/reference/transfer/jobs/create) / [update](https://docs.cloud.google.com/sdk/gcloud/reference/transfer/jobs/update) / [run](https://docs.cloud.google.com/sdk/gcloud/reference/transfer/jobs/run) / [TransferJobs REST](https://docs.cloud.google.com/storage-transfer/docs/reference/rest/v1/transferJobs) / [TransferOptions](https://docs.cloud.google.com/storage-transfer/docs/reference/rest/v1/TransferOptions) / [transferOperations](https://docs.cloud.google.com/storage-transfer/docs/reference/rest/v1/transferOperations) / [googleServiceAccounts.get](https://docs.cloud.google.com/storage-transfer/docs/reference/rest/v1/googleServiceAccounts/get)
- [Filestore create](https://docs.cloud.google.com/sdk/gcloud/reference/filestore/instances/create) / [NetApp pool create](https://docs.cloud.google.com/sdk/gcloud/reference/netapp/storage-pools/create) / [volume create](https://docs.cloud.google.com/sdk/gcloud/reference/netapp/volumes/create) / [Lustre create](https://docs.cloud.google.com/sdk/gcloud/reference/lustre/instances/create) / [Lustre REST](https://docs.cloud.google.com/managed-lustre/docs/reference/rest/v1/projects.locations.instances)
- IAMの代表的な対応権限: [Storage](https://docs.cloud.google.com/iam/docs/roles-permissions/storage) / [Storage Transfer](https://docs.cloud.google.com/iam/docs/roles-permissions/storagetransfer) / [Filestore](https://docs.cloud.google.com/iam/docs/roles-permissions/file) / [NetApp](https://docs.cloud.google.com/iam/docs/roles-permissions/netapp) / [Lustre](https://docs.cloud.google.com/iam/docs/roles-permissions/lustre)

非現行世代のコピー復旧はREST rewriteのsourceGenerationから対応付けた推論を含む。soft delete用SDK restoreそのものとして扱わない。`cp gs://...#N`は同じ世代指定の教材構文であり、SDK cpの公式例をそのまま再現したとは主張しない。
