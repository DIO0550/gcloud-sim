# Firestore・Spanner・Bigtable・Memorystoreの教材

Issue #19の6項目を14件の独立ミッションで学びます。カテゴリ→ミッション→手順の画面から選択できます。インスタンスを作るだけではクリアせず、World内の実データと照会・複製・期限・復旧の結果を評価します。

追加の状態はWorldの`managedDatabases`に保存します。Firestoreのdatabase/documentとRedisの接続先は、Functionsの教材と共通の`serverlessLab`を使います。Snapshot v34はv1–v33を読めます。旧保存のFirestore/Redis・Functions・SQLデータを保持し、新しい索引・コピー・キャッシュデータ等は空で補います。旧RedisのtierはBASICとして扱います。

## 操作と再現範囲

| サービス | 対応する操作・判定 | 教材の制限 |
|---|---|---|
| Firestore | Native/Datastore mode、5地域と`nam5`/`eur3`の配置、document read/write/delete、queryの単一等価条件・ソート・limit、複合index CRUD、version条件付き数値increment、データbackup CRUD・新規DBへのrestore | データ操作はNativeのみ。queryは直接のcollection内、最上位scalar field、同じ型の数値/文字列ソート。索引は等価field＋別のorder fieldの組合せで即READYになる固定モデル。Security Rules・SDK・複数document transaction・index build時間は扱わない |
| Spanner | instance CRUD/容量更新、regional構成と`nam3`、database CRUD、schema追加、行の書込・query、backup CRUD/新規database restore、人工vectorのcosine距離 | GoogleSQLの小さなサブセット。INT64/STRING(MAX)/ARRAY<FLOAT64>の3次元vectorと単一列PRIMARY KEY、1呼出し1statement。実分散処理・並行transaction・性能・費用は再現しない |
| Bigtable | instance/cluster CRUD/容量更新、tableとcolumn family、row write/read/scan/delete、cellの複数版、GC、クラスタ別の読取checkpoint、明示replication、backup CRUD/別table restore | 最新版を返すread/row-key prefix scan、1–4クラスタ、1–100ノード、20table/20family/1000cell。更新前にstale clusterの書込を拒否する教材。実GC/複製は非同期で、このモデルから遅延やSLAは判断できない |
| Memorystore Redis | BASIC/STANDARD_HAの作成・一覧・詳細・削除、private VPC接続、SET/GET/DEL/INCR、TTL、HA failover、Functionsからのカウンタ更新 | 200key、TTL 0–86400仮想秒。wall clockで期限を進めない。実Redis protocol・AUTH/TLS・eviction・メモリ容量/レイテンシ・永続化・課金は再現しない |

`gcloud`は構成操作に使い、`sim`はSDK/SQL/Redisクライアントを動かさずデータを操作する明示教材です。`sim firestore backups create/restore`は保存内容を学ぶための手動コピーで、公式のバックアップスケジュールやCLI互換操作ではありません。`sim bigtable`の表・セル・GC・複製・restoreも固定教材です。未対応SQL・式・操作・フラグはエラーにし、任意コード・実クラウド通信・外部送信を行いません。

Firestore/Spannerの通常の読取は、書込直後のデータを返す強整合の教材です。Bigtableは選択したclusterのcheckpointを読み、複製前は古い内容を返します。Redisは期限付きの一時データです。データの形、整合性と読書き経路の違いを比較します。

## 独立ミッション

| 分野 | ミッション | クリア条件 |
|---|---|---|
| Firestore | ドキュメント更新 | `nam5`のNative DB、count=3/version=2、更新後のquery |
| Firestore | 複合索引 | tenant/total索引、aの注文20→10の結果、bを含めない |
| Firestore | 復元 | sourceの削除、コピーから新規DBへ復元、beforeのquery |
| Spanner | 構成・容量 | `nam3`/2000 PU、主キーのある表、committedのquery |
| Spanner | 復元 | sourceの行削除、新規DBへのrestore、beforeのquery |
| Bigtable | 列・GC | 2版のcell、保持時間/版数の評価、最新値のread |
| Bigtable | 複製 | 別zoneのcluster、明示advance、secondaryからの最新read |
| Bigtable | 復元 | backup後に元rowを削除、新しいtableへのrestore/read |
| Redis | TTL | SET/GET、仮想10秒経過、期限後のcache miss |
| Redis | HA | STANDARD_HAのfailover、INCR=2、GET |
| Functions | Firestore | runtime SAのviewer権限、設定先DBの実document read |
| Functions | Redis | 同地域connector/Redis/VPC、固定ハンドラの2回のINCR |
| 検索比較 | Spanner vector | id=3の等価検索とcosine距離でid=1,2になる順位の違い |
| 選定 | ワークロード | モバイルdocument→Firestore、時系列→Bigtable、cache→Redis、広域transaction→Spanner |

全手順はミッションのヒントに収録しています。サービスを有効化し、教材用ownerで進めます。初期World・途中状態・誤設定ではクリアしません。保存から復元した配列でも操作が続くことを検証します。

## 権限・API・参照

Firestoreは`datastore.entities.*`、database/index/backupの操作別権限を使います。Spannerはinstance/database/backupの操作別権限とread/write/updateDdlを分けます。`gcloud spanner databases execute-sql`はこの教材ではSELECTのみです。変更は`sim spanner execute`、schemaは`databases ddl update`に分けます。schemaはGoogleSQLの`CREATE TABLE ... PRIMARY KEY (...)`の形で作れます。

Bigtableの構成は`bigtableadmin.googleapis.com`、row操作は`bigtable.googleapis.com`を要求します。列familyが無いcell、誤ったcluster/region、未追従clusterへの書込を拒否します。backupはinstance/clusterに所属し、restoreは同じregionのcaught-up clusterにある新規tableに限定します。

Redisの構成は`redis.instances.*`を使います。直接のcache教材はinstance get権限とauthorized VPCを検証します。これは実Redisのデータ操作をIAM管理権限で認可するという意味ではありません。FunctionsのRedis操作は実行設定の同地域connectorとVPCを検証し、runtime SAにRedis adminを要求しません。Firestore操作はruntime SAのdatastore getとInvokerを別に検証します。依存APIや権限を剥奪した後も毎回確認します。HTTP ingressと実際にtrafficを受けるrevisionを使用します。

backupは取得時の内容を保持します。Firestore/Spannerのrestore先は新規databaseに限定し、既存データの上書きは拒否します。Firestoreのbackupはdocumentのみでindexは含みません。コピーは元DB/表の削除後も残り、ツリー・properties・describeから確認できます。Redis/connectorが使うVPCは削除を拒否します。

## 例とデータの制限

Firestoreの等価値はJSON scalarです。文字列を照会するときは`--equals='"a"'`を使います。`documents increment`は`--expected-version`を要求し、競合はデータ/イベントを変更せず拒否します。通常writeは最大4096文字のJSON objectです。禁止キー・非有限値・不正JSONを拒否します。

BigtableのtimestampとGCの`--at`は明示UTC時刻です。同じrow/family/qualifier/timestampのwriteはその版を置き換えます。GCはfamilyごとの版数と保持時間の両方を満たすcellを保持します。ageの境界以上は削除します。教材のGCとreplicationはコマンドを実行したときだけ進みます。

RedisでTTL=0は無期限です。SETはTTLを置き換え、INCRは既存TTLを保持します。`sim databases time advance --seconds=10`で環境共通の仮想時計を進めます。HA切替はこの演習では接続先/値を保持しますが、キャッシュを永続的な保存先やバックアップとして採点しません。

Spannerは既存SQL教材と同じ純粋な評価器を使い、GoogleSQLの型・単一列PRIMARY KEY・3次元array/COSINE_DISTANCEを限られた構文から変換します。1行INSERT、SELECT/等価WHERE/ORDER BY/LIMIT、UPDATE/等価WHERE、DELETEに対応します。JOIN・任意DDL/DML・複数statement・PostgreSQL extension・ANN/indexは拒否します。人工データのvector検索は距離の順位を確認するだけで、実embeddingやLLMを呼びません。

添付のデータベース選択資料、Functions M4、基礎コース05、試験ガイド2.2/3.2の学習目標に対応します。資料の本文・公式問題・コードは転載しません。実サービスのクライアント互換、速度・容量・可用性・課金の完全再現は対象外です。
