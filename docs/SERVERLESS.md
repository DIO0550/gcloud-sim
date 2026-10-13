# Cloud Run・Functions・Eventarcの教材

現在の操作手順は公開ミッションと[対応コマンド](COMMANDS.md)を参照してください。アプリ独自の操作に依存した旧手順は削除しました。以下は残しているCLI・ドメインモデルの仕様です。過去のミッション数・実装時点の記録は現在の公開演習数を示しません。

Issue #17の教材では、固定ハンドラの設定、IAM、依存リソースと実行結果を練習できます。ミッションはカテゴリから1件選び、その手順・ヒントを順に表示します。

## 設定とリビジョン

`gcloud run deploy`、`gcloud run services update`、`gcloud functions deploy`で環境変数、min/max instances、concurrency、CPU、memory、timeout、runtime SA、ingress、VPC connector、egress、Secret参照、CMEKを設定します。既存サービスの変更には更新権限が必要です。

Cloud Runのデプロイは設定を保持する新しいリビジョンを作ります。`--no-traffic`で既存リビジョンを配信し続け、`gcloud run services update-traffic --to-revisions=REVISION=PERCENT,...`で合計100%の配分を設定できます。教材では1サービスにつき最大100リビジョンを保持し、上限を超えるデプロイは変更を加えず拒否します。

`gcloud run jobs create/update/execute`では固定タスクの設定と実行履歴を練習できます。タスク数は1〜100です。

## 保存と再現範囲

Snapshot v32に設定、リビジョン、トラフィック、依存リソース、イベント配送と実行履歴を保存します。v31以前のCloud Run・Functionsは旧設定から移行します。不正な設定値、配分、参照、履歴は読み込み時に拒否します。

実際のクラウド通信、課金、トークン発行、SDK・ソース・コンテナ・任意コードの実行は行いません。リクエストは固定ハンドラで評価し、負荷に応じた自動スケール、待ち時間、ランダムなトラフィック配分、継続的なイベント配信は再現しません。FunctionsはGen2のみ、Workflowsは教材用の固定手順、CMEKは主バージョン1のみです。対応していない操作や不正なフラグは成功扱いしません。
