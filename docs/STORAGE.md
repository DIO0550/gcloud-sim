# Storage 教材モデル

#23 の対象を、34追加コマンド・17独立ミッションで再現する。オブジェクト世代、保持期間/ロック、soft delete、PAP、CMEK、署名URL、転送ジョブ、共有ファイルサービスを World と Snapshot v38 に保存する。v1〜37 は旧オブジェクトのメタデータを保って移行し、世代は最初の参照/変更時に割り当てる。

## 世代と保護

| 操作 | 判定・結果 |
|---|---|
| `gcloud storage cp ./report.json gs://bucket/report.json` | ローカル入力は既存仕様の1,024 byteの教材メタデータ。実ファイルを読み取らず、内容は保存しない。新しいlive世代を作る |
| `--if-generation-match=N` | コピー先のlive世代を照合。0はlive世代が存在しない場合だけ許可 |
| Versioning有効で上書き/世代を指定しない削除 | 旧live世代をNONCURRENTへ移す |
| `sim storage versions restore gs://bucket/report.json#N` | NONCURRENT世代から新しいlive世代を作る。SDK restoreと区別した教材コマンド。既存liveの置換は`--allow-overwrite`とdelete権限が必要 |
| `gcloud storage restore gs://bucket/report.json#N` | 期限内のSOFT_DELETED世代から新しいlive世代を作る。get/create/restore、上書き時delete権限が必要 |
| `gcloud storage ls gs://bucket --all-versions` / `--soft-deleted` | 世代と状態を表示。期限後のsoft-deleted世代は表示/復旧できない |
| `buckets update --retention-period=1h --lock-retention-period` | 保持中の置換/削除を拒否。ロック後は短縮/解除できず、延長だけ許可 |
| `--soft-delete-duration=7d` / `0` | 既定7日。0は無効。REST範囲に従い7日以上90日未満。変更前の削除世代の期限は変えない |
| `--public-access-prevention` | 公開IAM/ACLの追加を拒否し、既存の公開バインディングも匿名・認証済み利用者の権限判定から除外。組織ポリシーによる継承は#24で扱う |

保持期間は正の秒数から100年未満まで。対象の作成時刻と仮想時刻を比較する。バケット復元、object retention、metageneration、実ACLの全エンティティ、暗号鍵の複数version・ローテーションは対象外。バケット自体のsoft deleteは再現しない。オブジェクトクラス変更は新世代として扱い、content-typeの変更は現在世代のメタデータを更新する。

`sim storage time advance --seconds=2592000`は既存の共有仮想時計を進める。自動ジョブは起動しない。`sim storage lifecycle run gs://bucket`でliveオブジェクトのage条件を明示評価する。SetStorageClass/Deleteの既存サンプルに対応し、保持とCMEKを検証する。ルール全般・非現行世代用条件・自動スケジュールは対象外。

## CMEK と署名

```sh
gcloud services enable cloudkms.googleapis.com iamcredentials.googleapis.com
gcloud kms keyrings create storage-ring --location=us-central1
gcloud kms keys create storage-key --keyring=storage-ring --location=us-central1 --purpose=encryption
gcloud storage service-agent --authorize-cmek=projects/ace-dev-01/locations/us-central1/keyRings/storage-ring/cryptoKeys/storage-key
gcloud storage buckets create gs://lesson-cmek --location=us-central1 --default-encryption-key=projects/ace-dev-01/locations/us-central1/keyRings/storage-ring/cryptoKeys/storage-key
```

既存のKMS教材キーを共有する。キーは同じロケーションで有効である必要があり、Cloud StorageサービスエージェントのEncrypt/Decrypt権限をキーIAMで確認する。バケット既定キーは以降の新規オブジェクトに適用し、`cp --encryption-key=FULL_KEY`が優先する。既存オブジェクトを自動的に再暗号化しない。`kms keys versions enable/disable 1 --key=KEY --keyring=RING --location=LOCATION`は既存のprimary versionの状態を変更する。

`gcloud storage sign-url gs://bucket/object --impersonate-service-account=SA --duration=10m`は、既存SA、IAM Credentials API、呼び出し元のsignBlob権限、署名SAのobjects.get権限を確認する。system-managed signingの1秒〜12時間、既定1時間だけに対応する。private-key-fileや特定世代の署名は明示的に拒否する。URLには`SIMULATED`の署名を出し、実認証には使えない。

`sim storage signed-url check signed-N`は現在の世代、署名SAの権限、CMEK、期限を照合する。PAPはこの署名経路を匿名アクセスと混同しない。`sim storage access check gs://bucket/object --principal=SA --transport=https`では既存liveオブジェクトのIAM/legacy ACL/PAP/CMEKを評価する。HTTPSはこの演習の安全な通信選択基準であり、Cloud Storage全般がHTTPを拒否するというモデルではない。

## Storage Transfer

```sh
gcloud services enable storagetransfer.googleapis.com
sim storage transfer-service-agent
gcloud transfer jobs create gs://source gs://destination --name=transferJobs/example --do-not-run
gcloud transfer jobs run transferJobs/example --no-async
gcloud transfer jobs describe transferJobs/example
```

既存バケットのroot同士だけを扱う。CLI createは`--do-not-run`がなければその場で実行する。Callerのjobs権限と別に、転送SAのコピー元buckets.get/objects.list/get、コピー先buckets.get/objects.create、置換時objects.deleteを確認する。参照ロールのうちlegacyBucketReaderのbuckets.get/objects.list、Object Viewer、Object Creatorを別々に付けられる。

1回の明示実行でメタデータを同期し、SUCCESS/FAILED・コピー数・byte数・失敗理由を記録する。部分変更は保存せず、失敗時はコピー前の状態を維持する。overwrite-whenはalways/different/never。DIFFERENTの比較はsize/content-type/updatedだけで、実checksum比較とは異なる。disabledは失敗として記録する。updateでsource/destination/status/overwriteを変更でき、deleteまたはstatus=deletedで教材ジョブを取り除く。

他クラウド、URL/ローカルディレクトリ、prefix、agent pool、スケジュール、実非同期・並行operation、削除済みジョブの履歴は対象外。Cloud Storage→Cloud Storageの代表的な転送権限はGCS REST操作の権限から対応付けた限定モデルであり、STSの全権限要件を網羅したものではない。

## 共有ファイルサービスの選定

| 用途 | 対応する参照構成 | 作成の主なフラグ |
|---|---|---|
| NFS共有 | Filestore / us-central1-c / BASIC_HDD 1〜63.9TiB、BASIC_SSD 2.5〜63.9TiB / NFS_V3 | `--file-share=name=my_vol,capacity=1TB --network=name=default --zone=us-central1-c --tier=BASIC_HDD` |
| エンタープライズNFS | NetApp STANDARD / us-central1 / pool 2048GiB、volume 1024GiB / NFSV3,NFSV4 | pool:`--capacity=2048 --service-level=standard --network=name=default`、volume:`--capacity=1024 --protocols=nfsv3,nfsv4 --share-name=share1 --storage-pool=POOL` |
| HPC | Managed Lustre / us-central1-a / 18000GiB / per-unit throughput 1000 | `--capacity-gib=18000 --per-unit-storage-throughput=1000 --filesystem=lustrefs --network=projects/PROJECT/global/networks/default` |

いずれもcreate/list/describe/delete、project/API/IAM/location/networkの検証、保存・表示に対応する。NetAppではプールとボリュームの参照、合計容量、削除順序も検証する。`sim storage choose --workload=nfs|enterprise-nfs|hpc|object|bulk-transfer --resource=NAME`は実際に構成済みのリソースへ用途を対応付ける。NetApp/Lustreの数値は公式CLI例の教材プロファイルであり、サービスの最小容量や全有効構成を意味しない。private IP割り当て、Private Service Access、mount、NFSデータ操作、SMB/AD、性能測定、請求計算、構成例以外のtier/場所は対象外。

統合演習は、誤削除復旧、最小IAM、低頻度アクセス、stateファイル保護を扱う。stateバケットはUBLA/PAP/Versioning・専用SAのObject Adminを使い、保持期間を0にする。Terraform GCS backendも世代/CMEKを共有し、保持期間によるstate置換やlock削除の妨害を診断する。任意のstate内容を復旧するモデルではない。

## 参照と推論の範囲

Google Cloud公式リファレンスだけをサブエージェントで調査し、取得内容は仕様確認用データとして使用した。

- [storage buckets create](https://docs.cloud.google.com/sdk/gcloud/reference/storage/buckets/create) / [update](https://docs.cloud.google.com/sdk/gcloud/reference/storage/buckets/update) / [Bucket REST fields](https://docs.cloud.google.com/storage/docs/json_api/v1/buckets) / [lockRetentionPolicy](https://docs.cloud.google.com/storage/docs/json_api/v1/buckets/lockRetentionPolicy)
- [storage cp](https://docs.cloud.google.com/sdk/gcloud/reference/storage/cp) / [restore](https://docs.cloud.google.com/sdk/gcloud/reference/storage/restore) / [Object restore REST](https://docs.cloud.google.com/storage/docs/json_api/v1/objects/restore) / [rewrite REST](https://docs.cloud.google.com/storage/docs/json_api/v1/objects/rewrite) / [insert REST](https://docs.cloud.google.com/storage/docs/json_api/v1/objects/insert)
- [storage service-agent](https://docs.cloud.google.com/sdk/gcloud/reference/storage/service-agent) / [sign-url](https://docs.cloud.google.com/sdk/gcloud/reference/storage/sign-url) / [IAM signBlob](https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/signBlob) / [KMS keys create](https://docs.cloud.google.com/sdk/gcloud/reference/kms/keys/create) / [enable](https://docs.cloud.google.com/sdk/gcloud/reference/kms/keys/versions/enable) / [disable](https://docs.cloud.google.com/sdk/gcloud/reference/kms/keys/versions/disable)
- [transfer jobs create](https://docs.cloud.google.com/sdk/gcloud/reference/transfer/jobs/create) / [update](https://docs.cloud.google.com/sdk/gcloud/reference/transfer/jobs/update) / [run](https://docs.cloud.google.com/sdk/gcloud/reference/transfer/jobs/run) / [TransferJobs REST](https://docs.cloud.google.com/storage-transfer/docs/reference/rest/v1/transferJobs) / [TransferOptions](https://docs.cloud.google.com/storage-transfer/docs/reference/rest/v1/TransferOptions) / [transferOperations](https://docs.cloud.google.com/storage-transfer/docs/reference/rest/v1/transferOperations) / [googleServiceAccounts.get](https://docs.cloud.google.com/storage-transfer/docs/reference/rest/v1/googleServiceAccounts/get)
- [Filestore create](https://docs.cloud.google.com/sdk/gcloud/reference/filestore/instances/create) / [NetApp pool create](https://docs.cloud.google.com/sdk/gcloud/reference/netapp/storage-pools/create) / [volume create](https://docs.cloud.google.com/sdk/gcloud/reference/netapp/volumes/create) / [Lustre create](https://docs.cloud.google.com/sdk/gcloud/reference/lustre/instances/create) / [Lustre REST](https://docs.cloud.google.com/managed-lustre/docs/reference/rest/v1/projects.locations.instances)
- IAMの代表的な対応権限: [Storage](https://docs.cloud.google.com/iam/docs/roles-permissions/storage) / [Storage Transfer](https://docs.cloud.google.com/iam/docs/roles-permissions/storagetransfer) / [Filestore](https://docs.cloud.google.com/iam/docs/roles-permissions/file) / [NetApp](https://docs.cloud.google.com/iam/docs/roles-permissions/netapp) / [Lustre](https://docs.cloud.google.com/iam/docs/roles-permissions/lustre)

非現行世代のコピー復旧はREST rewriteのsourceGenerationから対応付けた推論を含む。soft delete用SDK restoreそのものとして扱わない。`cp gs://...#N`は同じ世代指定の教材構文であり、SDK cpの公式例をそのまま再現したとは主張しない。
