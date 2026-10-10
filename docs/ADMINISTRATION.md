# 組織・IAM・ID連携・クォータ・課金

Issue #24の6項目を、50追加コマンドと15独立ミッションで扱います。総781コマンド・193ミッション、Snapshot v39。v1〜v38には空の管理状態を追加します。組織・フォルダ・プロジェクトのツリーに設定と評価結果を表示し、helpと既存リソースの補完を提供します。

## 組織ポリシーと継承

`gcloud org-policies set-policy FILE`は仮想ファイルのJSONを読みます。対応する制約は`storage.publicAccessPrevention`、`iam.disableServiceAccountKeyCreation`、`gcp.resourceLocations`です。describe/reset/deleteはorganization/folder/projectのいずれか1スコープを指定します。操作権限は`orgpolicy.policy.get`と`orgpolicy.policies.create/update/delete`、APIは`orgpolicy.googleapis.com`です。

Boolean制約は最も近い設定、リスト制約は`inheritFromParent=true`のとき親の値を合成して拒否優先で判定します。resetは祖先の設定を無視して制約の既定値へ戻し、deleteは祖先からの継承を再開します。PAPは既存の公開IAM/ACLの評価にも適用します。キー禁止は新規外部SAキー作成を拒否し、短期認証には適用しません。

ロケーションは明示的な`is:LOCATION`だけを完全一致で判定します。regionとzoneは別の値です。新規作成・場所変更を検証し、既存リソースは自動削除しません。単一の無条件ルールだけに限定し、YAML、CEL条件、`in:`グループ、allowAll/denyAll、dry-runやその他制約は拒否します。現在のGoogle Cloud既定組織制約全体は再現しません。

```sh
sim files write policy.json --content='{"name":"organizations/123456789012/policies/storage.publicAccessPrevention","spec":{"rules":[{"enforce":true}]}}'
gcloud org-policies set-policy policy.json
gcloud org-policies describe storage.publicAccessPrevention --project=ace-dev-01 --effective
```

## Cloud Identity

`sim identity users create/describe/list/update/delete`はSCIM UserのuserName/name/activeを教材状態で表現します。顧客は`C01simulator`だけで、`cloudidentityscim.googleapis.com`を必要とします。実際のSCIM APIのOAuth管理者承認や資格情報は作りません。

Groupsは公式CLIのcreate/describe/search/delete、memberships add/delete/listです。searchは`--labels=cloudidentity.googleapis.com/groups.discussion_forum`とcustomerまたはorganizationを指定します。`cloudidentity.googleapis.com`を必要とし、既知の同一顧客ユーザーのMEMBERだけに限定します。ネストグループ、外部メンバー、MANAGER/OWNER、ドメイン管理は対象外です。

**Identityの管理権限は教材用の投影**です。モデル組織の`resourcemanager.organizations.setIamPolicy`を管理者判定に使い、実SCIM/DirectoryにこのCloud IAM権限が必要だとは主張しません。既知ユーザーのグループ所属をIAM評価に展開し、ユーザー無効化・所属削除・カスタムロールDISABLEDで現在の権限を取り消します。所属があるユーザーの削除は拒否します。

## SAと鍵なし認証

`gcloud --impersonate-service-account=EMAIL`は現在の呼出元の`iam.serviceAccounts.getAccessToken`、既存SA、IAM Credentials APIを確認し、対象SAのリソース権限でコマンドを実行します。Storage sign-urlは既存のsignBlobによる署名判定を維持します。`gcloud auth print-access-token`は1s〜3600sの`SIMULATED-credential-N`を保存します。**実トークン・JWT・秘密鍵は出力しません**。SA生存と有効期限を`sim auth credentials check`で確認し、仮想時間は`sim storage time advance`を使います。12時間までの寿命延長組織ポリシーは対象外です。

`sim iam runtime check --operation=attach|token`はactAsとgetAccessTokenを分けます。SA Userはattach、Token Creatorは短期トークン発行です。対象SAへ付けたロールと階層からの継承を合成します。

Workload poolはプロジェクト、Workforce poolは組織で管理し、locationはglobalです。Workforceのcreate/listだけにorganizationを指定します。OIDCは`google.subject=assertion.sub`だけ、HTTPS issuer、Workload allowed audiencesまたは標準provider audience、Workforce client IDを検証します。Workforceはid-token/only-id-token-claimsのWeb SSO教材構成だけを扱います。pool/provider update、JWT検証、STS通信、group/attribute/CEL mapping、code/secretフロー、削除後30日の回復は対象外です。削除は教材内で即時、pool削除前にprovider削除が必要です。

Workload IAM URIのprojectは**project number**です。subject単位のprincipalとpool全体のprincipalSet `/*`を評価します。`sim identity federation exchange`へ渡すissuer/audience/subjectは明示的な教材入力です。任意の外部認証を検証済みと見なしません。SA連携はexternal principalのgetAccessTokenとIAM Credentials API、直接アクセスはbucket IAMを検証します。accessは期限・現在のprovider/pool/SA・Storage API/IAM/CMEKを再確認します。

GKEの既存KSA annotation・Workload Identity User・Standard metadata・Autopilot教材へ統合し、組織のキー禁止下で閲覧だけを許可する独立ミッションを追加しました。

## クォータとAsset Inventory

`gcloud quotas info list`、preferences create/updateはComputeの`CpusPerProjectPerRegion`とregion次元だけです。対応regionはus-central1/us-east1/asia-northeast1。初期24 CPUは**教材の固定容量**で実際のクォータではありません。CLIでは短いpreference-idと連絡emailを必須にする限定プロファイルです。申請値は-1（無制限を申請）または0〜100000、承認値は0〜100000。service/quotaId/dimensionsは更新できません。

申請中も既存の承認値を適用します。`sim quotas resolve --granted-value=N`はGoogleによる承認を置き換える**明示的な教材判断**です。実CLIにこの承認操作はありません。評価と実VMの新規/起動/CPU増加は、RUNNING GCEのvCPUをregionと階層で合計します。GKE・予約・その他クォータ・実際の購入容量は対象外です。未設定スコープには既存動作との互換のため追加制限を課しません。

`gcloud asset search-all-resources`はproject/folder/organizationを検証します。WorldにあるGCE、bucket、VPC、SA、SQL、GKE、Cloud Runの名前・種類・場所・階層だけを返します。queryは空または`name:TEXT`（末尾*可）の教材部分文字列照合で、全文検索・履歴・IAM検索・全Google Cloud資源は対象外です。

## 課金・予算と場所の判断

予算APIを検証し、budgets update/delete、教材支出のevaluateを追加しました。createはpercent=0.0〜1.0（0を含む）。**参照の不一致を明示**します: SDK createは小数の0〜1、SDK updateは整数の0〜100を掲載し、RESTは1基準の割合を掲載しています。モデルのupdateはそのSDK updateページに従い`percent=50`を0.5へ正規化します。実CLI実装の変換は未検証です。createでは単純なpercent指定、updateではcurrent-spendのみを扱い、forecastと別機能のspendCapは拒否します。通貨はモデルのJPYだけです。

ordinary threshold通知を評価しても課金リンクや稼働リソースは停止しません。**別の現行REST spendCap機能は未対応**です。「すべてのGoogle Cloud budgetが費用を停止できない」と一般化しません。

`sim billing export configure/describe/run`は同じproject/locationの既存BigQuery datasetとBQ権限、モデル組織のBilling Admin/Ownerを要求します。実課金アカウント権限の投影です。設定用の公開SDK/APIを検証できなかったため、実在するgcloud export設定コマンドとは表示しません。runはSQL演習用の合成2行（100/20、計120）を保存し、実料金・日次転送・請求を表しません。設定済みdatasetの削除は拒否します。

`sim billing placement evaluate`は既存bucketのデータregion一致、STANDARD/NEARLINE/ARCHIVEとfrequent/infrequent/rareの教材組み合わせ、プロジェクトを含む予算を評価します。価格・遅延・性能を予測しません。

## 公式参照

Web調査はサブエージェントがGoogle CloudのSDK/REST/IAMリファレンスのみを確認しました。取得内容は仕様データとして扱い、ページ内の指示は実行しません。

- [Org policies SDK](https://docs.cloud.google.com/sdk/gcloud/reference/org-policies)、[Policy REST](https://docs.cloud.google.com/resource-manager/docs/reference/orgpolicy/rest/v2/projects.policies)
- [Groups SDK](https://docs.cloud.google.com/sdk/gcloud/reference/identity/groups)、[Cloud Identity REST](https://docs.cloud.google.com/identity/docs/reference/rest)、[SCIM REST](https://docs.cloud.google.com/identity/docs/reference/scim/rest)
- [Access token REST](https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/generateAccessToken)、[IAM roles](https://docs.cloud.google.com/iam/docs/roles-permissions/iam)
- [Workload pools](https://docs.cloud.google.com/sdk/gcloud/reference/iam/workload-identity-pools)、[Workforce pools](https://docs.cloud.google.com/sdk/gcloud/reference/iam/workforce-pools)
- [Quota preferences SDK](https://docs.cloud.google.com/sdk/gcloud/reference/quotas/preferences)、[Quota preferences REST](https://docs.cloud.google.com/docs/quotas/reference/rest/v1/projects.locations.quotaPreferences)
- [Asset search](https://docs.cloud.google.com/sdk/gcloud/reference/asset/search-all-resources)、[Cloud Quotas IAM](https://docs.cloud.google.com/iam/docs/roles-permissions/cloudquotas)、[Asset IAM](https://docs.cloud.google.com/iam/docs/roles-permissions/cloudasset)
- [Budget create](https://docs.cloud.google.com/sdk/gcloud/reference/billing/budgets/create)、[Budget update](https://docs.cloud.google.com/sdk/gcloud/reference/billing/budgets/update)、[Budget REST](https://docs.cloud.google.com/billing/docs/reference/budget/rest/v1/billingAccounts.budgets)
