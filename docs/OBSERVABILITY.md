# 監視・ログの運用教材

Issue #12 の残機能。既存5ミッションに12ミッションを追加し、通知・欠測・複数条件・複数プロジェクト・SLI/SLO・収集・ログルーティング・監査・障害診断を学ぶ。対応コマンドは [COMMANDS.md](COMMANDS.md)。

## 演習の進め方

`m-observe-lab-001`〜`012` のヒントに API 有効化と正解経路を収録。すべて初期 World から実行できる。設定の作成だけでは完了せず、サンプル取得・ポリシー評価・データ記録・ログ転送の結果を確認する。

```sh
gcloud services enable monitoring.googleapis.com logging.googleapis.com
sim monitoring clock advance --seconds=60
sim monitoring policies evaluate cpu-high
sim monitoring resources list --collection=evaluations
```

`sim monitoring clock` は監視・ログだけの共有仮想時刻。実時間の待機は不要。時刻は0〜31,536,000秒、状態はプロジェクトごとに保存する。ログの実時刻表示にはコマンド実行へ渡された時刻を使い、保持判定には仮想時刻を使う。別教材の `sim time` は独立している。

## 通知とアラート

- Emailチャネルの `enabled` と `verified` は別。`sim monitoring channels verify` は検証済み状態を教材内で再現する。実メール、検証コード、通知送信はない。
- `--policy-from-file` は仮想ファイルのJSONだけを受け付ける。1〜6条件、OR/AND/AND_WITH_MATCHING_RESOURCE。同じプロジェクトの通知チャネルをフル名で参照する。条件IDの維持・ポリシーの無効化・参照削除も再現する。
- 指標はCompute CPUと `custom.googleapis.com/ace/NAME` のGAUGE/DOUBLEに限定。CPUは0〜1。resourceは既存VM、または明示したgeneric_task。秒単位のポイントを `sim monitoring time-series write` で投入する。
- thresholdはGT/LT、継続時間は60〜3600秒の60秒刻み。連続サンプルの間隔が60秒を超えたら継続を切る。初回の単一ポイントだけでは発火しない。
- absenceは一度観測された系列が120秒以上途絶えたときに評価。未観測系列は発火しない。thresholdの欠測は最後のポイントから60秒を過ぎて開始し、ACTIVEは設定した継続時間後に発火、INACTIVEは非発火、NO_OPは前回の状態を保持する。
- ANDは異なるresourceでも各条件が真なら成立。AND_WITH_MATCHING_RESOURCEは同じproject/resourceType/resourceで全条件が真になる必要がある。
- PromQLはCPU/custom指標1つのセレクタと比較数値だけ。例: `compute_googleapis_com:instance_cpu_utilization{monitored_resource="gce_instance"} > 0.8`。PromQLの条件はポリシーに1つだけ。式、関数、集約、任意コードは実行しない。evaluationIntervalは30〜300秒の30秒刻みとして検証・表示し、実スケジューラは動かさない。評価は明示的な `sim ... evaluate` で行う。
- `gcloud monitoring policies update` はJSON置換、enabled、combiner、通知先の置換を扱う。dashboard更新には最新describeのetagが必要。uptime更新は表示名、パス、ポート、周期、timeoutに限定する。HTTPチェックは実行しない。

## metrics scope・SLO・収集

`gcloud beta monitoring metrics-scopes create projects/MONITORED --project=SCOPING` は両プロジェクトのlink権限とMonitoring APIを確認する。リンク先のデータはコピーせず、時系列の検索範囲を広げる。API無効化やプロジェクト削除は評価へ反映し、unlinkは元のサンプルを残す。

`sim monitoring slos` はサービス識別子と目標を簡略化した教材。goalは0より大きく0.9999以下、rolling期間は1〜30日。requestモデルはgood/totalを集計する。windowsモデルは各明示的な非空区間を等重みとし、その区間のgood=totalなら良好とする。一般的なSLO APIの任意SLI定義やカレンダー期間、ウィンドウ内の可変SLI基準は扱わない。

トラフィックゼロはUNKNOWN。`SLI=good/total`、許容失敗数は `(1-goal)*total`、残り予算は許容失敗数−bad、burn rateは `(bad/total)/(1-goal)`。負の予算を表示する。rolling期間外の区間は集計から外す。

`sim monitoring collectors` は実際にソフトウェアをインストールしない。Ops AgentはRUNNING VMへの同一SA接続、metricWriter/logWriter、Monitoring/Logging API、cloud-platformまたは両writeスコープを確認する。gcloudのログイン主体をエージェント資格情報として代用しない。

Managed Prometheusは明示したnode SA、Monitoring/Container API、metricWriter、namespace/selectorに一致するReady Podを確認する。教材のhello-app:1.0/8080を固定メトリクス対象として扱う。実際のhello-appのメトリクス提供を保証するものではない。PodMonitoringのCRD適用や本物のscrapeは行わない。有効化だけではサンプルは生成されず、明示したcollectで固定CPU=0.9、またはprometheus_requests=10を保存する。

## Logging・保持・ルーティング

`_Required` はAdmin Activity/System Eventを400日保持し、削除・保持変更を禁止する。`_Default` は他のログを既定30日保持する。両方ともAnalyticsへアップグレードできる。自動作成される標準ビューは省略し、明示的に作ったビューを扱う。

ユーザーバケットの保持は1〜3650日。保持ロックとAnalyticsは不可逆。ロック後の保持変更、通常バケットのAnalyticsアップグレードを禁止する。ロックしたバケットに未期限切れログがある間は削除できない。削除は7仮想日の猶予中にundeleteでき、それ以後はログを読めない。削除済み識別子は教材では履歴として残し再利用しない。Analyticsリンクがあるバケットは先にリンクを削除する。

ログは新規にモデル化されたCompute操作、通信判定、固定audit fixtureだけを取り込む。移行済みの旧操作履歴は標準ログ検索の互換表示だけに使用し、sinkへ転送し直さない。取り込み時点の各sinkのfilter・除外・writer権限・API・転送先の存在を評価し、STORED/EXCLUDED/DENIEDを保存する。sinkの作成、filter変更、IAM修復は過去ログを再送しない。

- 同じプロジェクトのLoggingバケットへの転送は自動認可。その他はlogWriterのroute権限と転送先のbucketWriter、objectCreator、BigQuery dataEditor、Pub/Sub publisher相当の権限を要求する。既存sinkの表示用writerIdentityは教材の固定主体であり、同一projectの自動認可とは独立している。
- 除外はsinkごと。`_Default`の除外は `_Required` や他のsinkへ影響しない。ログ指標の設定も保持する。
- ビューの簡易filterはsource()/log_id()/resource.typeの等値とAND/OR/NOT。severityやpayload filterは拒否する。view専用reader、グループ所属、プロジェクトviewAccessorを評価する。
- Data Accessの標準検索はprivateLogViewer相当を要求する。views.accessで許可されたビューではビュー内のログを読める。
- `sim logging sinks grant-writer` は同一projectのBigQuery転送先へdataEditorとlogWriterを付ける。`sim ... export` は取り込み時に配送済みとなったログをBigQuery教材テーブルに投影する。任意の過去operationを再評価しない。挿入IDで重複を除く。
- Analyticsは同じproject/locationの既存datasetへのリンクとkind/severity別件数集計。リンクはコピーではなく教材内の投影。任意SQL、実BigQuery課金、実Loggingバケット書き込みはない。

監査のAdmin Activity/System Event/Policy Deniedは固定fixtureで区別する。Compute/StorageのData Accessは設定されたadminRead/dataRead/dataWriteだけを記録し、祖先の有効化を子で無効にできない。BigQuery Data Accessは既定で記録する。Policy Denied fixtureは実API拒否を発生させた証拠ではない。flow/firewall logsは既存network教材の接続判定から取得し、拒否→許可の復旧を診断する。NATログは別教材に残す。

## 保存・制限・検証

Snapshot v41。v1〜v40は新しい監視状態を空で初期化し、既存のIAM・Storage・container・操作履歴・構成を保持する。全定義でプロジェクト参照、時刻、重複、条件数、メール、保持値、ビュー/リンク/評価参照を再検証する。コレクタの依存リソースが後から削除された場合は構成を残してUNAVAILABLEとして診断する。

構成集合は各100、時系列・監査ログ・ルーティング履歴は各1000、SLO区間は各1000。ログ履歴は古い記録から削除する。未対応syntax・API無効・権限不足・project/location違いは状態を変更しない。

テストは初期Worldから全12ミッションの途中状態と保存・復元を通し、通知未検証、欠測モード、resource結合、scope解除、SLOゼロデータ、収集権限、writer修復後の非再送、ビュー権限、保持・削除、監査の継承、破損Snapshot、画面・補完を確認する。

## 公式資料

ZIP: 基礎コース07、Operations Suite 8資料。最新の仕様確認はGoogle Cloud公式資料のみを参照。

- [通知チャネルAPI](https://docs.cloud.google.com/monitoring/alerts/using-channels-api)、[beta channels create](https://docs.cloud.google.com/sdk/gcloud/reference/beta/monitoring/channels/create)
- [AlertPolicy API](https://docs.cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.alertPolicies)、[PromQL alerts](https://docs.cloud.google.com/monitoring/promql/create-promql-alerts)
- [metrics scope projects create](https://docs.cloud.google.com/monitoring/api/ref_v3/rest/v1/locations.global.metricsScopes.projects/create)、[Monitoring IAM](https://docs.cloud.google.com/iam/docs/roles-permissions/monitoring)
- [SLO monitoring](https://docs.cloud.google.com/stackdriver/docs/solutions/slo-monitoring)、[SLO API](https://docs.cloud.google.com/monitoring/api/ref_v3/rest/v3/services.serviceLevelObjectives)
- [Ops Agent authorization](https://docs.cloud.google.com/stackdriver/docs/solutions/agents/ops-agent/authorization)、[Managed Prometheus](https://docs.cloud.google.com/stackdriver/docs/managed-prometheus/setup-managed)
- [ログ保管](https://docs.cloud.google.com/logging/docs/store-log-entries)、[バケット](https://docs.cloud.google.com/logging/docs/buckets)、[ビュー](https://docs.cloud.google.com/logging/docs/logs-views)
- [ルーティング](https://docs.cloud.google.com/logging/docs/routing/overview)、[転送先の認可](https://docs.cloud.google.com/logging/docs/export/configure_export_v2)
