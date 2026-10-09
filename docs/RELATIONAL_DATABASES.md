# Cloud SQL・AlloyDB・DMSの教材モデル（Issue #18）

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

## SQL・接続を試す

```sh
gcloud services enable sqladmin.googleapis.com
gcloud sql instances create app-db --region=us-central1 --database-version=POSTGRES_16
gcloud sql databases create app --instance=app-db
gcloud sql users create app-reader --instance=app-db --role=reader
gcloud sql connect app-db --user=postgres
sim sql execute app-db --database=app --sql="CREATE TABLE orders (id integer PRIMARY KEY, note text); INSERT INTO orders VALUES (1, 'new')"
sim sql execute app-db --database=app --sql="BEGIN; UPDATE orders SET note = 'paid' WHERE id = 1; INSERT INTO orders VALUES (2, 'new'); COMMIT"
sim sql execute app-db --database=app --user=app-reader --sql="SELECT * FROM orders ORDER BY id LIMIT 2"
```

`sim`コマンドは現在のgcloud account/projectを使います。account/projectを変えるときは`gcloud config set`を使ってください。`--account`などのgcloud共通フラグはsimでは受けません。DBユーザー名とreader/writerは教材内の認可です。パスワード認証、IAM DB認証、接続ソケット、対話式psql/mysql、実Auth Proxyを実行しません。実際のパスワードを入力する必要はありません。従来成功扱いしていた`--root-password`/`--storage-size`は未対応として拒否します。

`--via=proxy`はCloud SQLのpublic endpointを使う教材内の接続検証です。public IPが無いと拒否します。`--via=private --network=default`は設定したVPCの存在・一致を要求します。`--via=public --source-ip=203.0.113.5`はpublic IPとauthorized-networksのCIDRを評価します。private service accessの予約レンジ/Service Networking、実ルート/Firewall、TLSハンドシェイクは再現しません。

SQLは整数、text、PostgreSQLの`vector(3)`を評価します。識別子は小文字英字始まり・英数字/underscore、63文字まで。NULL/defaultや任意SQLは扱わず、INSERTで全columnの値を指定します。

- `CREATE TABLE`、column型`integer`/`int`/`text`/`vector(3)`、単一の`PRIMARY KEY`と`NOT NULL`。
- 1行の`INSERT`、`UPDATE`の1column代入と等価WHERE、`DELETE`の等価WHERE/全行。
- `SELECT`のcolumn/`*`、単一の等価WHERE、単一columnのORDER BY ASC/DESC、LIMIT。
- `CREATE EXTENSION vector`、`embedding <=> '[1,0,0]'::vector AS distance`、距離のORDER BY。属性フィルタ後の実データで正確なcosine距離を計算。
- 同じ呼出し内で完結する`BEGIN; …; COMMIT`/`ROLLBACK`。失敗時は全変更を破棄。ROLLBACK内の書き込みもreader/replica/read poolでは拒否。

JOIN、関数/集約、DDL変更、索引、複数行VALUES、サブクエリ、SQLコメント、別の呼出しにまたがるtransactionは明示拒否します。1回30文/20,000文字、DBあたり20表、表あたり20column/200行、text 4,096文字まで。3次元vectorは有限値（絶対値1,000,000以下）・非ゼロを要求します。距離計算で埋め込み・AI回答・ANN索引・性能比較を生成しません。AlloyDBとCloud SQLで同じ距離演算を学べても、実サービスの最適化/索引/性能が同じという意味ではありません。

## HA・replica・復旧

HAは`--tier=db-custom-2-7680 --availability-type=regional`などの専用tierで作ります。`gcloud sql instances failover`はactive zoneをa/bで切り替え、DBデータを保持します。停止時間や実フェイルオーバー、HA standbyへの直接照会は再現しません。

`--master-instance-name=PRIMARY`は同じengine/versionのread replicaを作ります。primaryのDB/ユーザー作成・データ変更を即時反映し、replicaの書き込みとHA化を拒否します。SQL Server replica、replica昇格・遅延・多段replicaは対象外です。

backupは取得時のDB/schema/行データを変更しないコピーとして保持します。restoreは`BACKUP_ID --backup-instance=SOURCE --restore-instance=TARGET`で所属を指定し、同じengine/versionの書き込み可能なtargetへDB内容を置換します。DBユーザーは復元対象外です。backup IDだけで別instanceのbackupを使うことはできません。Cloud SQL instance削除は従来どおり所属backupを削除します。AlloyDB backupはsource cluster削除後も残り、同じregionの新規clusterへrestoreできます。接続前にPRIMARYを作成します。

PITRは時間経過のログを自動生成しません。`--enable-point-in-time-recovery`を有効にし、`sim sql checkpoint INSTANCE --timestamp=2026-10-01T10:00:00Z`で明示した仮想時刻のデータを保存します。時刻は単調増加が必要です。`gcloud sql instances clone SOURCE DEST --point-in-time=…`は、保存した最初/最後の時刻内で直前のcheckpointを選び、新規DESTへ復元します。binlog/WAL・保持期間・checkpoint間の変更は再現しません。

exportは既存の同一project bucketへSQLコピーを保存し、Storage objectのsize/typeと教材exportの識別子を更新します。importは、その教材exportと識別子・sizeが一致するobjectが存在し、engine/versionが一致するときだけ読み込みます。任意SQLファイルや`hello.txt`を固定結果へ変換しません。bucketのcreate/get/delete権限とAPIを再評価します。外部クラウドの転送やサービスエージェントの実非同期処理は行いません。

## DMSの段階

profileはWorld内のPostgreSQL instanceとDBユーザー・private VPCを参照します。外部host/passwordには接続しません。対応するjobは同じproject/region/engine/version/VPCの別primaryを要求し、destinationは空である必要があります。CDCには全tableのprimary keyが必要です。ユーザーや拡張の実移行制約は再現せず、教材のDB/schema/行をコピーします。

1. DRAFTで`verify`。API、接続権限、user、参照、互換性を確認します。
2. `start`でRUNNING/INITIAL_COPY。destinationへのアプリ書き込みを禁止します。
3. `sim dms advance JOB --region=…`で初期コピーを行いCDCへ。sourceの変更後、次のadvanceで追従します。
4. `sim sql writes pause SOURCE`でsourceを停止し、再advanceして同じデータになったことを確認。
5. `promote`でCOMPLETED/PROMOTED。destinationへの書き込みを許可し、sourceは停止を保持します。逆向きの同期や自動rollbackは作りません。

RUNNINGをstop/resumeできます。停止中もdestinationは保護します。API/接続権限が剥奪されたadvanceは、コピーせずエラーにします。依存jobを残したprofile削除、profileを残したinstance/user/VPC設定の変更、DBが参照するVPCの削除、replicaを残したprimary削除、read poolを残したAlloyDB primary削除を拒否します。

すべてローカルの決定的な状態評価です。実クラウド通信・課金・任意コード実行・性能測定・実並列/非同期処理は行いません。SQLとAlloyDBのresource名はproject内で一意です。各保存collectionは500件まで、照会/復旧履歴は直近100件です。
