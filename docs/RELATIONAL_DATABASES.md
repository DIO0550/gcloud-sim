# Cloud SQL・AlloyDB・DMSの教材モデル（Issue #18）

現在の操作手順は公開ミッションと[対応コマンド](COMMANDS.md)を参照してください。アプリ独自の操作に依存した旧手順は削除しました。以下は残しているCLI・ドメインモデルの仕様です。過去のミッション数・実装時点の記録は現在の公開演習数を示しません。

11件のミッションはカテゴリ→ミッション→手順の既存画面で選べます。操作の文字列ではなく、構成・データ・実行/復旧履歴を採点します。DBデータはWorldの`relational`に置き、Snapshot v33で保存します。旧v1–v32のSQLインスタンスとバックアップは保持し、従来は存在しなかった設定・DBユーザー・空のバックアップ内容を補います。

## 操作とミッション

| 範囲 | 操作・検証 | ミッション |
|---|---|---|
| Cloud SQL | instances create/list/describe/patch/delete、database create/list/describe/delete、user create/list/delete、connect、SQLデータ評価 | トランザクション |
| 可用性・接続 | 専用tierのREGIONAL、private VPC、public CIDR、read replica、failover、読み取り専用拒否 | private HA、read replica |
| 復旧・転送 | backup create/list/describe/restore、PITR clone、Storage export/import、所属・engine・target・bucket IAM | backup復元、時点復旧、export/import |
| AlloyDB | cluster create/list/describe/delete/restore、primary/read pool create/list/describe/delete、users、教材database/SQL、backup create/list/describe/delete | read pool照会、別clusterへの復元 |
| DMS | profile/job create/list/describe/delete、verify/start/stop/resume/promote、明示したadvance、データ追従・source停止 | 初期コピー→CDC→切替 |
| 選定・ベクトル | 要件別選択、人工3次元データの属性検索と正確なcosine距離 | 用途選定、属性検索との比較 |

必要なAPIは`sqladmin.googleapis.com`、`alloydb.googleapis.com`、`datamigration.googleapis.com`です。private VPCにはCompute APIと`compute.networks.get`が必要です。各操作はcloudsql/alloydb/datamigrationの操作別IAMを要求し、DBユーザーのreader/writerとは区別します。`roles/cloudsql.client`と`roles/alloydb.client`は接続用で、DBやclusterの管理権限は与えません。
