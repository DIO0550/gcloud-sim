# 監視・ログの運用教材

現在の操作手順は公開ミッションと[対応コマンド](COMMANDS.md)を参照してください。アプリ独自の操作に依存した旧手順は削除しました。以下は残しているCLI・ドメインモデルの仕様です。過去のミッション数・実装時点の記録は現在の公開演習数を示しません。

Issue #12 の残機能。既存5ミッションに12ミッションを追加し、通知・欠測・複数条件・複数プロジェクト・SLI/SLO・収集・ログルーティング・監査・障害診断を学ぶ。対応コマンドは [COMMANDS.md](COMMANDS.md)。

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
