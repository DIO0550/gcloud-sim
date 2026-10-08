# Cloud Run・Functions・Eventarcの教材

Issue #17の教材では、固定ハンドラの設定、IAM、依存リソースと実行結果を練習できます。ミッションはカテゴリから1件選び、その手順・ヒントを順に表示します。

## 設定とリビジョン

`gcloud run deploy`、`gcloud run services update`、`gcloud functions deploy`で環境変数、min/max instances、concurrency、CPU、memory、timeout、runtime SA、ingress、VPC connector、egress、Secret参照、CMEKを設定します。既存サービスの変更には更新権限が必要です。

Cloud Runのデプロイは設定を保持する新しいリビジョンを作ります。`--no-traffic`で既存リビジョンを配信し続け、`gcloud run services update-traffic --to-revisions=REVISION=PERCENT,...`で合計100%の配分を設定できます。教材では1サービスにつき最大100リビジョンを保持し、上限を超えるデプロイは変更を加えず拒否します。

`gcloud run jobs create/update/execute`では固定タスクの設定と実行履歴を練習できます。タスク数は1〜100です。

## 呼び出しと権限

`sim run invoke`と`gcloud functions call`はInvoker IAM、呼び出し元、ingress、runtime SAと依存リソースを評価し、成功・失敗と理由を記録します。Gen2 Functionsの呼び出しには`roles/run.invoker`を使います。runtime SAの指定にはSAの存在と`iam.serviceAccounts.actAs`を検証します。

`--anonymous`は匿名呼び出し、`--source=external/internal/load-balancer`は教材の呼び出し元です。Cloud Runは`--revision`で配信中のリビジョンを選べます。権限剥奪や依存リソースの無効化は次の呼び出しに反映され、実行失敗はCLIでも失敗として返ります。

## イベント配送

Pub/Subへのpublish、Storageへのcp/rsync、教材用Firestoreドキュメント操作からイベントを生成します。FunctionsのイベントトリガーとEventarcの参照・イベントフィルタに一致する宛先へ配送します。FirestoreはNativeモードのcreated/updated/deleted/writtenを扱います。

`sim events list`でIDと配送履歴を確認し、原因を修復した後に`sim events retry EVENT_ID`で保留中の配送を再試行します。`sim events replay EVENT_ID`は同じIDを再配送します。`sim serverless handler NAME --kind=function --idempotent`で固定ハンドラに重複排除を設定し、attempts・effects・duplicatesの違いを比較できます。

## DB・Secret・鍵・Workflows

VPC connectorとRedisは同一プロジェクト・リージョン・ネットワークの参照を確認します。Firestore接続ではNativeモードと実行SAの権限を確認します。

Secretは`--set-secrets=ENV=SECRET:VERSION`で参照し、バージョンの状態と実行SAのSecret Accessor権限を評価します。Secretの値はプロパティ画面とaccess結果では伏せます。破棄したバージョンは再有効化できません。CMEKは同一リージョンの鍵、鍵の有効状態、実行SAとCloud Runサービスエージェントの権限を確認します。

Workflowsは`sim files write`で作成した教材用定義の`run:NAME`・`function:NAME`を順に呼び出します。失敗した段階で停止し、後続の宛先を呼び出さず、実行履歴に原因を記録します。

## 保存と再現範囲

Snapshot v32に設定、リビジョン、トラフィック、依存リソース、イベント配送と実行履歴を保存します。v31以前のCloud Run・Functionsは旧設定から移行します。不正な設定値、配分、参照、履歴は読み込み時に拒否します。

実際のクラウド通信、課金、トークン発行、SDK・ソース・コンテナ・任意コードの実行は行いません。リクエストは固定ハンドラで評価し、負荷に応じた自動スケール、待ち時間、ランダムなトラフィック配分、継続的なイベント配信は再現しません。FunctionsはGen2のみ、Workflowsは教材用の固定手順、CMEKは主バージョン1のみです。対応していない操作や不正なフラグは成功扱いしません。
