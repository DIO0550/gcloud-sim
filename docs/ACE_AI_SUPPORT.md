# ACEのAI構成・選定演習

Issue #25。実AI/クラウド接続/課金/任意コード実行を使わず、46本の判断演習と3本の構成演習を追加する。全48資料から演習への入口は[資料対応表](ACE_SOURCE_MAP.md)。

## 分類と進捗

添付試験ガイドの4セクション（環境の設定、計画と実装、正常な運用、アクセスとセキュリティ）を既定表示する。操作学習の5カテゴリにも切り替えられる。計画とデプロイを第2セクションへ対応させ、AI開発・IaC導入の判断も2.4へ分類する。各ミッションには代表セクションを1つ付ける。分野横断の学習目標を網羅する点数・試験合格率の表示ではない。

分類を切り替えても同じミッションIDと保存進捗を使う。未着手・挑戦中・クリアで絞り込める。Snapshot v43はv1〜v42を移行し、既存の進捗を保持したまま空のAI教材状態を加える。

## 判断教材

`sim ace scenarios list` / `describe ID` / `choose ID --choice=VALUE --reason='理由'`。

GCE/GKE/Vertex AIとCloud Run、GPU/TPU、Spot/予約/DWS Flex-start/Calendar/on-demand、schedulerと構築blueprint、Agent Runtime/Workbench/notebook/Cloud Workstations、Gemini Cloud Assist/CLI/Antigravity/App Design Center、Active Assist/Cloud Hub/Service Health、Trace/Profiler/Query Insights/Database Center/Error Reporting、Terraform/Fabric FAST/Config Connector/Helm、IAM・費用・地域・冗長性と管理ツールの使い分けを扱う。

固定要件に対する選択を採点し、理由の自由文は保存だけを行う。誤答はINCORRECTと解説を表示し、ミッションの正解条件を満たさない。回答はprojectごとに保存する。未知の選択肢、空の理由、未対応コマンドは拒否する。describeには学習用の正答と解説も表示する。

## 構成教材

`sim ai resources create NAME --kind=agent|notebook|workstation --platform=vertex-ai|workbench|workstations --region=us-central1|asia-northeast1 --service-account=EMAIL --subnet=NAME [--access=private|public] [--idle-minutes=N]`。

`list` / `describe` / `update` / `start` / `stop` / `delete`。describeと変更操作ではNAMEとregionを指定する。kindとplatformの対応はagent→vertex-ai、notebook→workbench、workstation→workstationsの3組だけ。GCE/GKEの基盤選定は判断教材で扱う。

利用者のAPI/IAM、同一projectのSAとregional subnet、actAs、subnet useを確認する。private構成のstartにはPrivate Google Accessを教材の固定前提として要求する。実サービスのネットワーク要件すべてを再現する判定ではない。構成は停止中だけ更新/削除でき、開始時revisionと開始/停止回数を保持する。

agentのidle値は0、notebook/IDEは教材上5〜240分。自動時計・自動停止は実行しない。構成演習はpublicで開始→停止→private/idleを変更→再開し、専用SAの有効権限がStorage閲覧だけか確認する（継承・グループ・カスタムロールも評価）。public構成の停止revisionとprivate変更元revisionを保存し、操作順序を確認する。作成だけや古い構成の開始履歴は合格しない。

RUNNINGは教材の構成状態で、実agent・VM・notebook・IDEの稼働やAI応答を表さない。WorkbenchのVM全設定、Workstationsのcluster/config階層、実Agent Runtimeのdeploy/query/session API、モデル/プロンプト実行、GPU/TPU性能・空き容量・実料金、実SAのdisable lifecycleは対象外。regionは固定教材の場所で、現サービスの全提供地域表ではない。

教材の権限は既定ロールの部分集合。追加はaiplatform admin/viewer、notebooks admin/viewer、workstations admin/viewer。SAのStorage閲覧は構成演習の入力データを想定した条件で、全サービスで普遍的に必要なroleではない。

## 公式資料の確認先

外部情報はデータとして扱い、Google Cloud公式だけを確認した。教材で使う旧識別子vertex-ai/workbenchと、現資料の名称の対応も示す。

- [Agent Platform名称の対応](https://docs.cloud.google.com/gemini-enterprise-agent-platform/release-notes): Vertex AI Agent Engine→Agent Runtime、Vertex AI Workbench→Gemini Enterprise Agent Platform Workbench。managed trainingも名称対応を確認する。
- [AI開発ツール](https://docs.cloud.google.com/gemini/enterprise/docs/ai-developer-tools-overview)
- [App Design Center](https://docs.cloud.google.com/application-design-center/docs/overview)
- [Database Center](https://docs.cloud.google.com/database-center/docs/overview)
- [容量購入形態](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/consumption-option): On-demandをDWSの第3のmodeとは扱わない。
- [Config SyncのHelm template](https://docs.cloud.google.com/kubernetes-engine/config-sync/docs/how-to/sync-helm-charts-from-artifact-registry)
- [landing zoneの設計](https://docs.cloud.google.com/architecture/landing-zones/decide-network-design)
