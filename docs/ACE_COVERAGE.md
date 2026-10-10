# ACE 資料とシミュレーターの対応計画

2026-10-03 添付 `Associate Cloud Engineer.zip` の48 PDFを、mainの215コマンド・18ミッションと照合。資料の本文・図・設問そのものはリポジトリへ転載しない。以下は学習目標から作る独自演習の実装計画であり、完了済みの機能一覧ではない。

## 完了の定義

全体追跡: [#11](https://github.com/DIO0550/gcloud-sim/issues/11)。分野別Issue: [#12](https://github.com/DIO0550/gcloud-sim/issues/12) / [#13](https://github.com/DIO0550/gcloud-sim/issues/13) / [#14](https://github.com/DIO0550/gcloud-sim/issues/14) / [#15](https://github.com/DIO0550/gcloud-sim/issues/15) / [#16](https://github.com/DIO0550/gcloud-sim/issues/16) / [#17](https://github.com/DIO0550/gcloud-sim/issues/17) / [#18](https://github.com/DIO0550/gcloud-sim/issues/18) / [#19](https://github.com/DIO0550/gcloud-sim/issues/19) / [#20](https://github.com/DIO0550/gcloud-sim/issues/20) / [#21](https://github.com/DIO0550/gcloud-sim/issues/21) / [#22](https://github.com/DIO0550/gcloud-sim/issues/22) / [#23](https://github.com/DIO0550/gcloud-sim/issues/23) / [#24](https://github.com/DIO0550/gcloud-sim/issues/24) / [#25](https://github.com/DIO0550/gcloud-sim/issues/25)。

- CLIの構文、リソース間参照、権限、API有効化、プロジェクト/ロケーションを検証する。
- 未対応入力を成功扱いしない。通信・課金・コード実行は行わず、再現範囲をhelp/対応コマンド表へ明示する。
- Worldの状態を保存・復元できる。旧Snapshotを移行する。
- ミッションは操作文字列ではなく結果の状態を判定する。初期状態から解け、途中/誤設定ではクリアしないことをテストする。
- 分野ごとのPRで実装とミッションを組にする。部分対応を分野全体の完了と数えない。

## 分野別の差分

| 分野 | 既存の対応 | 追加する操作・判断とミッション | 状態 |
|---|---|---|---|
| Logging / Monitoring | Compute監査ログ、sink作成。dashboard/policyは空一覧のみ | positional log filter・昇順、ログ指標、sink更新/削除、dashboard・alert policy・uptime・通知、metrics scope、ログバケット/保持/除外、ログルーター、SLI/SLO/予算、監査ログ種類と有効化 | 部分実装: 指標/sink変更・監視3種と5ミッション。通知・metrics scope・ログbucket・SLI/SLO・監査設定は残作業 |
| Terraform | 未対応（Deployment Managerのみ） | HCL/変数/出力、init/fmt/validate/plan/apply/destroy、保存plan、ドリフト/refresh-only、module/moved、state list/show/mv/rm、import、GCS backend移行と権限 | 部分実装: VPC/subnet/VM/firewall/bucket・HCL/変数/出力・plan/apply・ドリフト・state/import・ローカルmodule/moved・GCS backend/state移行・ロック復旧と7ミッション。workspaceや実並行処理などは残作業（#13、詳細はTERRAFORM.md） |
| Docker / Artifact Registry | 未対応 | build/run/ps/logs/stop/rm/tag/push、repository作成・認証・イメージ参照、Cloud Build、GKEへのpull権限 | 部分実装: ローカルDocker・Artifact Registry・認証/IAM・タグ/digest・保存/表示・3ミッション。Cloud Build履歴/実行SA、GKEの存在/pull権限判定と2ミッションを追加。リモートタグ管理/イメージ削除・repoAdminとリリース切替/片付けの2ミッションも追加（計7）。任意build設定やノードキャッシュ等は残作業（#14、CONTAINERS.md） |
| GKE / Kubernetes | Standard/Autopilot、Deployment/Service/Pod、scale/restart、固定manifest | namespace・ConfigMap/Secret・環境/ファイル、更新/undo、probe/resources/HPA/VPA、StatefulSet/PVC、Ingress/NetworkPolicy、private/regional・node pool・Workload Identity・最小権限 | #15の教材モデルを実装: 複数コンテナの個別runtimeと全体Ready、WIのKSA/IAM連携・閲覧だけの権限、Standard metadata、VPA Off/Initial/Recreate、単一Autopilot resource補正、regional zone別ノード数、既存の保存/表示/CLI/復旧教材を統合。GKE関連42ミッション・Snapshot v30。高度なStatefulSet/Service・実scheduler/HA・通信/実測・定期controllerは対象外。具体的な対応と拒否範囲は[KUBERNETES.md](KUBERNETES.md)。PRマージ後にIssueを完了する |
| Load Balancing | health check/backend/forwarding ruleを単独作成 | 正式なHC構文、MIG/named ports、backend add/remove/get-health、URL map/proxy、外部passthrough・global外部/region内部Application LB、proxy-only subnet、HC/data通信障害、managed SSL/CDN/zonal NEG/backend bucket・Tier選択と片付け | #16の教材モデルを実装: 7ミッション、Snapshot v31、CLI/権限/参照/保存/表示。IPv4・TCP passthrough・global managed TLS等に限定。具体的な対応・拒否範囲は[LOAD_BALANCING.md](LOAD_BALANCING.md)。PRマージ後にIssueを完了する |
| Cloud Run / Functions | deploy/list/describe、HTTP/PubSub trigger、単純call | 環境変数・min/max/concurrency・timeout・revision/traffic・jobs、runtime SAとinvoker IAM、認証付き呼出し、Storage/Eventarc、retry、VPC connector/ingress/egress、Workflows、Secret Manager/CMEK、Firestore/Redis接続 | 未完了 |
| Cloud SQL / AlloyDB / DMS | SQL instance作成・backup作成/一覧 | DB/user/接続、SQL評価、HA/replica/failover、backup restore/PITR、import/export、AlloyDB cluster/instance、DMS migration | #18の6項目を教材モデルで実装: 11ミッション、Snapshot v33、CLI/API/IAM/参照/保存/表示。仮想PITR checkpoint・明示CDC・人工vectorを評価。詳細は[RELATIONAL_DATABASES.md](RELATIONAL_DATABASES.md)。PRマージ後にIssueを完了する |
| Firestore / Spanner / Bigtable / Memorystore | Functions連携用のFirestore/Redis最小構成 | 選定・作成・読書き/照会・バックアップ/復元、整合性・可用性・容量の構成、Redis接続 | #19の6項目を教材モデルで実装: 14ミッション、61コマンド、Snapshot v34、CLI/API/IAM/参照/保存/表示。複合索引・単一ドキュメントのversion条件更新・人工vector・明示GC/複製・仮想TTL・Functionsから実データを評価。詳細は[MANAGED_DATABASES.md](MANAGED_DATABASES.md)。PRマージ後にIssueを完了する |
| BigQuery / データ処理 | Pub/Sub topic/subscription作成のみ | bq dataset/table/load/query/job、Pub/Sub publish/pull/ack、Dataflow jobとDataproc、Kafkaの選定・構成、課金export/ログ分析 | #20の6項目を教材モデルで実装: 15ミッション、45コマンド、Snapshot v35、CLI/API/IAM/プロジェクト/location/参照/保存/表示。実データSQL、配送・期限・隔離、明示ジョブ進行/復旧、private Kafka、課金/監査ログ分析。詳細は[DATA_PROCESSING.md](DATA_PROCESSING.md)。PRマージ後にIssueを完了する |
| Compute / ディスク | VM lifecycle/metadata/SSH、disk/snapshot、MIG autoscaling | カスタムmachine/GPU/TPU、可用性/Spot、image・snapshot schedule/restore、regional disk/Hyperdisk、OS Login・VM Manager、MIG更新/autohealing | 未完了 |
| VPC / 接続 | subnet/firewall/address/router/NAT/peering | subnet拡張、Private Google Access・flow logs、静的route、Shared VPC、VPN/Interconnect/BGP、DNS record、firewall SA/secure tag/NGFW、接続不良の診断 | 未完了 |
| Storage | bucket/object/class/versioning/lifecycle/ACL/IAM | 世代復元・保持/lock/soft delete、CMEK、署名URL、transfer、Filestore/NetApp/Lustreの選定・構成、既存操作の独立したミッション | 未完了 |
| IAM / 組織 / 課金 | 階層/IAM継承/SA/custom role、API/budget | org policy、Cloud Identity、impersonation/短期credentials、Workforce/Workload Identity、quota、asset inventory、billing export、最小権限トラブルシュート | 未完了 |
| AI / 運用支援 / 設計判断 | 未対応 | GPU対TPU、GCE/GKE/Vertex AIの選定、agent runtime/notebook/workstation、Gemini/Active Assist/Cloud Hub・診断のシナリオ、費用/ロケーション/冗長性判断 | 未完了 |

CLIを持たない管理手続きや性能測定、AI推論/外部API、公式ラボの採点、実課金は再現しない。これらの学習目標は設定・障害・選定シナリオとして扱う。教材に登場するサービスの現行名称/可用性は実装時に公式資料で再確認する。既存の「ACEの5ドメイン」は添付試験ガイドの4セクションと別分類なので、教材分類も更新対象。

## 資料台帳

リソースリンク集・導入/復習PDFも含めて確認対象。詳細な実装範囲は上表と各PRで追跡する。

| 資料 | 頁数 |
|---|---:|
| Cloud Run Functions/M0_Course_Introduction.pdf | 10 |
| Cloud Run Functions/M1_Introduction_to_Cloud_Run_Functions.pdf | 40 |
| Cloud Run Functions/M2_Calling_and_Connecting_Cloud_Run_Functions.pdf | 29 |
| Cloud Run Functions/M3_Securing_Cloud_Run_Functions.pdf | 26 |
| Cloud Run Functions/M4_Integrating_Cloud_Databases.pdf | 29 |
| Cloud Run Functions/M5_Best_Practices_for_Functions.pdf | 22 |
| Cloud Run Functions/M6_Course_Review.pdf | 8 |
| Cloud Run Functions/T-DVFUNC-I-m7-l1-ja-file-21.ja.pdf | 1 |
| GKE/ACE_GKE_Study_Guide_JA.pdf | 20 |
| GKE/Deploy_Kubernetes_Applications_Google_Cloud_JA.pdf | 18 |
| Operations Suite/T-STACKD-B-m7-l1-ja-file-39.ja.pdf | 1 |
| Operations Suite/T-STACKD-B_00_Course1_Introduction.pdf | 4 |
| Operations Suite/T-STACKD-B_00_Course1_Summary.pdf | 4 |
| Operations Suite/T-STACKD-B_01_Introduction to Google Cloud Operations Suite.pdf | 39 |
| Operations Suite/T-STACKD-B_02_Monitoring_Critical_Systems.pdf | 47 |
| Operations Suite/T-STACKD-B_03_Alerting_Policies.pdf | 46 |
| Operations Suite/T-STACKD-B_04_Advanced_Logging_and_Analysis.pdf | 57 |
| Operations Suite/T-STACKD-B_05_Working with Cloud Audit Logs.pdf | 28 |
| Terraform/M1_T-TFGC-B_Introduction_to_Terraform_for_Google_Cloud_JA.pdf | 37 |
| Terraform/M2_T-TFGC-B_Terms_and_Concepts_JA.pdf | 49 |
| Terraform/M3_T-TFGC-B_Writing_Infrastructure_Code_for_Google_Cloud_JA.pdf | 70 |
| Terraform/M4_T-TFGC-B_Organizing_and_Reusing_Configuration_with_Terraform_Modules_JA.pdf | 51 |
| Terraform/M5_T-TFGC-B_Introduction_to_the_Terraform_State_JA.pdf | 24 |
| Terraform/T-TFGC-B-Locales-m6-l2-file-ja-40.pdf.ja | 1 |
| Terraform/Terraform_Infrastructure_Google_Cloud_JA.pdf | 20 |
| 試験ガイド/associate_cloud_engineer_exam_guide_japanese.pdf | 5 |
| 負荷分散/Compute_Engine_Load_Balancing_JA.pdf | 16 |
| データベース/Google_Cloud_Database_Selection_JA.pdf | 20 |
| その他/T-AIDEP-I-m5-l1-ja-file-20.ja.pdf | 2 |
| その他/T-AIGPU-I-m2-l1-ja-file-8.ja.pdf | 2 |
| その他/T-AITPU-I-m2-l1-ja-file-12.ja.pdf | 2 |
| その他/T-DVCRUN-B-m4-l1-ja-file-17.ja.pdf | 10 |
| 基礎コース/00_Course_Introduction_JA.pdf | 26 |
| 基礎コース/01_Interacting_with_Google_Cloud_JA.pdf | 20 |
| 基礎コース/02_Virtual_Networks_2.2.7_JA.pdf | 55 |
| 基礎コース/03_Virtual_Machines_v2.2.7_JA.pdf | 79 |
| 基礎コース/04_IAM_2.2.7_JA.pdf | 49 |
| 基礎コース/05_Storage_and_Database_Services_v2.2.7_JA.pdf | 73 |
| 基礎コース/06_Resource_Management_2.2.7_JA.pdf | 31 |
| 基礎コース/07_Resource_Monitoring_2.2.7_JA.pdf | 38 |
| 基礎コース/08_Interconnecting_Networks_2.2.7_JA.pdf | 51 |
| 基礎コース/09_Load_Balancing_and_Autoscaling_2.2.7_JA.pdf | 64 |
| 基礎コース/10_Infrastructure_Automation_JA.pdf | 26 |
| 基礎コース/11_Managed_Services_JA.pdf | 25 |
| 基礎コース/T-ECISA-I-5-l1-ja-file-47.ja.pdf | 1 |
| 基礎コース/T-ESSCICS-I-4-l1-ja-file-54.ja.pdf | 1 |
| 基礎コース/T-ESSCIF-I-4-l1-ja-file-45.ja.pdf | 1 |
| 基礎コース/T-ESSCIF-I-Locales-0-l2-file-ja-2.pdf.ja | 1 |

Phase 21（#15）: 限定IngressのHTTPホスト・最長パス・Exact/Prefix・defaultBackend、NodePort Service参照/ポート/Ready接続先の診断、namespace、CLI/ツリー/プロパティ、Snapshot v26と2ミッションを追加。実LB・IP・DNS・TLS・NEG・BackendConfig・外部クライアントのNetworkPolicyやStatefulSet等は残作業です。

Phase 22（#15）: Standardの既定/追加ノードプールを保存し、対象プールのresize/delete、管理/自動スケール設定、制御プレーンとノードの独立更新、明示した必要ノード数の上下限評価、Snapshot v27と運用2ミッションを追加。実ノード配置・regional可用性・private設定・Workload Identity・自動修復/定期更新・upgrade戦略・StatefulSet等は継続します。

Phase 23（#15）: privateノード/制御プレーンendpoint・VPC/subnet/master CIDR・公開/内部endpointの許可CIDR設定、送信元を明示する接続条件評価とコンテキスト接続先保存、Snapshot v28とセキュリティ2ミッションを追加。実通信/認証/RBAC・regional HA/実ノード配置・Workload Identity・StatefulSet/複数コンテナ・VPA/Autopilot固有要件は継続します。


Phase 24（#15）: 限定StatefulSetの固定Pod名・volumeClaimTemplatesと連番ごとのPVC/PV・データ保持、スケール/削除後のPVC再利用、headless Service、CLI/ツリー/プロパティ、Snapshot v29と運用2ミッションを追加。Parallel・単一image/PVCマウント・Retainに限定し、OrderedReady/実際の更新順序、OnDelete/partition/ControllerRevision、実DNS/アプリ複製、複数コンテナ・regional HA/Workload Identity・VPA/Autopilot固有要件は継続します。

Issue #15完了対応（2026-10-06）: 既存Issue 1件を作業単位として残項目をまとめる。複数コンテナ・WI・VPA 3モード・Autopilotの限定プロファイル・regional配置と9ミッションを追加（全79件、316コマンド）。旧24段階の残項目は上記対応範囲で更新し、実通信/HA/高度なKubernetes仕様を未対応として明記する。

Issue #16完了対応（2026-10-06）: 外部passthrough TCP LB、グローバル外部Application LB、リージョン内部Application LBの接続、正式なscoped HC、MIG named ports・backend着脱/health、URL map・HTTP/HTTPS proxy・Google-managed SSL certificate、proxy-only subnet、アプリ/FW/port/healthy数診断、zonal GCE_VM_IP_PORT NEG・backend bucket・CDN設定・Network Service Tiersと片付けを追加。7ミッション（全86件）・364コマンド・Snapshot v31。詳細な対応/非対応と教材は[LOAD_BALANCING.md](LOAD_BALANCING.md)に記載。実通信/課金/コード実行、UDP/IPv6、proxy Network LB、他NEG、実TLS/証明書発行/キャッシュ・throughput/HAは再現しません。
