# BigQuery・Pub/Sub・データ処理の教材

Issue #20の6項目を、45コマンドと15ミッションで扱います。添付ACE資料の基礎コース11、データベース選択、Operations Suite 04、試験ガイド2.2/3.2を学習範囲の根拠にしています。資料本文の転載ではなく、独立した決定的な教材モデルです。

すべてブラウザ内のWorldに保存し、実クラウド通信・課金・SDK・SQLサーバ・Kafka broker・任意のユーザーコードを実行しません。Snapshot v35はv1–v34を移行し、既存データを保ちながら`dataProcessing`を空で補います。現行版は入力バイト、表、配送状態、仮想時計、ジョブ、接続/分析履歴を保持します。

## BigQueryと入力

datasetとtableは同一プロジェクトに作成します。各bq操作に`--location`が必要で、US、EU、収録済みregionだけを受け付けます。dataset/tableの参照は`dataset.table`または選択した`project.dataset.table`です。USへの入力はUS/us-central1/us-east1、EUへの入力はEU/europe-west1、regionへの入力は同じregionのbucketに限ります。これは教材上の簡略な組合せです。

```sh
gcloud services enable bigquery.googleapis.com storage.googleapis.com
bq mk warehouse --dataset --location=US
bq mk warehouse.orders --table --location=US --schema=customer:STRING,amount:INT64
gcloud storage buckets create gs://ace-input --location=us-central1
sim storage objects write gs://ace-input/orders.csv --data='customer,amount\nalice,10\nalice,20'
bq load warehouse.orders gs://ace-input/orders.csv --location=US --source_format=CSV --skip_leading_rows=1
bq query "SELECT customer, SUM(amount) AS total FROM warehouse.orders GROUP BY customer" --location=US --use_legacy_sql=false
bq ls warehouse --location=US
bq show warehouse.orders --schema --location=US
bq ls --jobs --location=US
```

loadの`--source=URI`、lsの`--dataset=NAME`も教材の代替入力として使えます。同じ値を位置引数とフラグで重複指定することは拒否します。

`sim storage objects write`は教材用の入力バイトを作ります。文字列の`\n`を行区切りにします。既存`gcloud storage cp`の仮想ローカルファイルはメタデータだけなので、loadの実データには使えません。入力メタデータが上書きされた場合も古いバイトを読みません。bucket上の実効`storage.objects.get/create/delete`を検証します。

schemaは1–20個の一意なフィールドと`STRING/INT64/FLOAT64/BOOL`、全列nullableです。INT64はJavaScriptの安全整数、FLOAT64は有限数に限定します。CSVは引用符内のカンマと二重引用符を扱い、ヘッダskipは0/1です。改行を含むセルは未対応です。NDJSONは`--source_format=NEWLINE_DELIMITED_JSON`で、各行の列・型がschemaと完全一致する必要があります。表/結果は1000行、入力は200ファイル・各100000文字まで。`--replace`なしのloadは追記です。

SQLは単一表の`SELECT *`/列投影、単一の等価`WHERE`、`COUNT(*) AS alias`/数値`SUM(field) AS alias`、1列`GROUP BY`、出力列の`ORDER BY ASC/DESC`、`LIMIT 1..1000`を実際の行に評価します。空集合のCOUNTは0、SUMはnullです。NULLの等価条件は一致しません。JOIN/UNION、DML、任意関数、複数文、legacy SQLは拒否します。非対応SQLを固定結果で成功扱いしません。BigQueryの全SQL・型・パーティション・スロット・料金は再現しません。

`bq show --job`は保存したLOAD/QUERY/EXPORT結果を表示します。履歴は最新100件で、表を削除しても残ります。dataset削除は非空なら`--recursive`が必要で、billing export先は削除を拒否します。APIとdataset/table/job操作権限を各分岐で検証し、全文表示とqueryは`bigquery.tables.getData`、書込みは`updateData`、query/loadは`jobs.create`も要求します。

## Pub/Sub

既存publishはFunctions/Eventarc配送と、subscription別の受信状態の両方を更新します。publish時点で存在するsubscriptionにだけ配送し、後で作ったsubscriptionへは再生しません。メッセージは最大4096文字・1000件、受信状態は5000件です。

`gcloud pubsub subscriptions pull SUB --limit=1 --auto-ack`で受信/ACKします。auto-ackなしではACK IDを返し、`ack SUB --ack-ids=ID[,ID]`で確定します。期限切れ/未知/重複IDを含むACKは全体を拒否します。既定のACK期限は10秒で10–600秒の範囲です。`sim time advance --seconds=10`で共有の仮想時計を進め、未ACKのメッセージを再配送可能にします。実時間の経過では進みません。

`subscriptions update`で`--message-retention-duration`を10–604800秒、`--dead-letter-topic`を同じプロジェクトの別topic、`--max-delivery-attempts`を5–100に設定します。保持期限以降はEXPIREDです。最大試行数の次の配送操作で、Pub/Sub service agentにpublisher/subscriberがあればdead-letterへ転送します。実サービスの最善努力の試行数は再現せず、教材では決定的です。service agentは`service-PROJECT_NUMBER@gcp-sa-pubsub.iam.gserviceaccount.com`です。

pushにはHTTPS endpointを要求します。`sim pubsub push SUB --response-code=503`は未ACK、期限後の`--response-code=200`はACKです。実HTTP通信をせず、応答は受講者が明示します。pushへのpull/明示ACKは拒否します。`--clear-push-endpoint`でpullへ変更できます。使用中のtopic、activeジョブのsubscription削除も拒否します。

## Dataflow・Dataproc

教材Dataflowテンプレートは`gs://dataflow-templates/sim/GCS_to_BigQuery`と`gs://dataflow-templates/sim/PubSub_to_BigQuery`だけです。`jobs run NAME --region=REGION --gcs-location=TEMPLATE --service-account-email=SA --parameters=input=SOURCE,output=DATASET.TABLE,transform=uppercase`でQUEUEDを作ります。入力はGCSのNDJSONまたは`subscription:SUB`です。変換はidentity/uppercaseだけで、uppercaseはSTRING列に作用します。

`sim dataflow jobs advance NAME --region=REGION`の1回目でRUNNING、2回目でDONE/FAILEDになります。実行SAのworker、Storage viewerまたはPub/Sub subscriber、BigQuery write権限とAPI・同regionの入出力を確認します。失敗は診断を保存してCLIエラーを返し、入力受信のACKや出力表を変更しません。原因修復後の`sim dataflow jobs retry`でQUEUEDへ戻せます。DONEは二重確定できず、CANCELLEDはretryできません。

Dataprocは同regionのVPCと実行SA、2–20 workersを持つclusterのcreate/list/describe/update/deleteです。Sparkは`gcloud dataproc jobs submit spark --id=NAME --cluster=CLUSTER --region=REGION --jars=sim://samples/transform.jar --class=sim.Identity|sim.Uppercase --input=gs://BUCKET/OBJECT --output=DATASET.TABLE`だけを受け付けます。Dataflowと同じ明示進行/復旧モデルを`sim dataproc jobs advance/retry`で使います。activeジョブはcluster削除を妨げ、完了ジョブの履歴はcluster削除後も残ります。参照される実行SA/VPCの削除も保護します。VM群、Beam/Sparkランタイム、autoscaling/window/checkpoint、継続ストリーム処理は再現しません。

## Managed Kafkaと選定

Kafkaのclusterは同regionのsubnet、3–24 vCPU、1–4 GiB/vCPUのメモリを持ちます。topicは1–100 partitions、replication factor=3です。cluster/topicのcreate/list/describe/deleteと、`sim kafka connect CLUSTER --region=REGION --network=VPC --auth=SASL_IAM`でprivate VPC、IAM、TLSの構成を検証します。接続は教材の判定だけで、broker・実認証・produce/consumeはありません。topicが残るclusterと、clusterが使うsubnetの削除は拒否します。

`sim data-services choose WORKLOAD --service=SERVICE`は次の用途比較を記録します。最後の選定が誤りならミッションは未完了です。

| 用途 | 選定 |
|---|---|
| warehouse-sql | bigquery |
| stream-transform | dataflow |
| spark-batch | dataproc |
| async-events | pubsub |
| kafka-protocol | kafka |

## Exportとミッション

`sim billing exports configure DATASET --location=LOCATION`は現在リンクしたopenなbilling accountを保存します。`sim billing exports run`は固定の教材2行（Compute Engine 12.5 USD、Cloud Storage 2.5 USD）を`gcp_billing_export`へ置き、SQLのSUMで15を検証します。再実行は追記せず、実料金・実使用量・スケジュールを取得しません。

ログは既存`gcloud logging sinks create`でBigQuery datasetを指定し、`sim logging sinks grant-writer SINK --location=LOCATION`でsink writerへプロジェクトのdataEditorを付けます。`sim logging sinks export SINK --table=DATASET.TABLE --location=LOCATION`は実際に保存したCompute操作履歴から、既存LogFilterに一致する監査ログを転送します。insert_idで重複を除き、writer権限・API・転送先・schemaを検証します。過去履歴の明示exportであり、リアルタイムのLogging export/全ログ種別は再現しません。

15ミッションはCSV集計、条件SQL、ACK、未ACK再配送、保持期限、dead-letter、push復旧、Dataflow batch、Pub/Sub処理、不正入力修復、Dataproc処理と片付け、Kafka接続、課金分析、監査ログ分析、用途比較です。`src/engine/missions/data-processing.ts`が正解手順と状態判定を持ちます。リソースツリーとプロパティはschema/行、ジョブの入力・出力・状態・エラー、capacity/接続、受信attempt/ACK/仮想期限、分析結果を表示します。describe挿入はプロジェクト/location/親を含みます。
