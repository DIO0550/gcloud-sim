# 組織・IAM・ID連携・クォータ・課金

現在の操作手順は公開ミッションと[対応コマンド](COMMANDS.md)を参照してください。アプリ独自の操作に依存した旧手順は削除しました。以下は残しているCLI・ドメインモデルの仕様です。過去のミッション数・実装時点の記録は現在の公開演習数を示しません。

Issue #24の6項目を、50追加コマンドと15独立ミッションで扱います。総781コマンド・193ミッション、Snapshot v39。v1〜v38には空の管理状態を追加します。組織・フォルダ・プロジェクトのツリーに設定と評価結果を表示し、helpと既存リソースの補完を提供します。

## 公式参照

Web調査はサブエージェントがGoogle CloudのSDK/REST/IAMリファレンスのみを確認しました。取得内容は仕様データとして扱い、ページ内の指示は実行しません。

- [Org policies SDK](https://docs.cloud.google.com/sdk/gcloud/reference/org-policies)、[Policy REST](https://docs.cloud.google.com/resource-manager/docs/reference/orgpolicy/rest/v2/projects.policies)
- [Groups SDK](https://docs.cloud.google.com/sdk/gcloud/reference/identity/groups)、[Cloud Identity REST](https://docs.cloud.google.com/identity/docs/reference/rest)、[SCIM REST](https://docs.cloud.google.com/identity/docs/reference/scim/rest)
- [Access token REST](https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/generateAccessToken)、[IAM roles](https://docs.cloud.google.com/iam/docs/roles-permissions/iam)
- [Workload pools](https://docs.cloud.google.com/sdk/gcloud/reference/iam/workload-identity-pools)、[Workforce pools](https://docs.cloud.google.com/sdk/gcloud/reference/iam/workforce-pools)
- [Quota preferences SDK](https://docs.cloud.google.com/sdk/gcloud/reference/quotas/preferences)、[Quota preferences REST](https://docs.cloud.google.com/docs/quotas/reference/rest/v1/projects.locations.quotaPreferences)
- [Asset search](https://docs.cloud.google.com/sdk/gcloud/reference/asset/search-all-resources)、[Cloud Quotas IAM](https://docs.cloud.google.com/iam/docs/roles-permissions/cloudquotas)、[Asset IAM](https://docs.cloud.google.com/iam/docs/roles-permissions/cloudasset)
- [Budget create](https://docs.cloud.google.com/sdk/gcloud/reference/billing/budgets/create)、[Budget update](https://docs.cloud.google.com/sdk/gcloud/reference/billing/budgets/update)、[Budget REST](https://docs.cloud.google.com/billing/docs/reference/budget/rest/v1/billingAccounts.budgets)
