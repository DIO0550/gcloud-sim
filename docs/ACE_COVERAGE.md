# ACE学習の公開範囲

このアプリは実在するCLIの操作練習を提供します。独自コマンドと、それを必要とする判断・構成・観測演習は公開対象から除外しました。実Cloud Shellの起動、Console/mobileの選択問題、AI実行、料金・性能・通信の測定をミッションとして提供しません。

現在の公開ミッションは74件です。HCL・YAML・JSONの編集は「ファイル」タブで行い、terraformやkubectlで適用します。古いSnapshotのリソースを読み込めますが、廃止した演習の進捗は現在の一覧・件数に含めません。

| 操作カテゴリ | 公開ミッション数 |
|---|---:|
| デプロイと実装 | 19 |
| 運用の維持 | 33 |
| アクセスとセキュリティ | 8 |
| 計画と構成 | 9 |
| 環境セットアップ | 5 |

[対応コマンド](COMMANDS.md)は公開登録簿と一致することをテストします。[資料対応表](ACE_SOURCE_MAP.md)は全48資料の対応・未対応を示します。実際の練習手順はアプリ内の公開ミッションを参照してください。

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

## 過去の段階別記録

以下の残作業の記述は各段階時点の記録。現在の対応範囲は上表と各分野のドキュメントを参照。

Phase 21（#15）: 限定IngressのHTTPホスト・最長パス・Exact/Prefix・defaultBackend、NodePort Service参照/ポート/Ready接続先の診断、namespace、CLI/ツリー/プロパティ、Snapshot v26と2ミッションを追加。実LB・IP・DNS・TLS・NEG・BackendConfig・外部クライアントのNetworkPolicyやStatefulSet等は残作業です。

Phase 22（#15）: Standardの既定/追加ノードプールを保存し、対象プールのresize/delete、管理/自動スケール設定、制御プレーンとノードの独立更新、明示した必要ノード数の上下限評価、Snapshot v27と運用2ミッションを追加。実ノード配置・regional可用性・private設定・Workload Identity・自動修復/定期更新・upgrade戦略・StatefulSet等は継続します。

Phase 23（#15）: privateノード/制御プレーンendpoint・VPC/subnet/master CIDR・公開/内部endpointの許可CIDR設定、送信元を明示する接続条件評価とコンテキスト接続先保存、Snapshot v28とセキュリティ2ミッションを追加。実通信/認証/RBAC・regional HA/実ノード配置・Workload Identity・StatefulSet/複数コンテナ・VPA/Autopilot固有要件は継続します。


Phase 24（#15）: 限定StatefulSetの固定Pod名・volumeClaimTemplatesと連番ごとのPVC/PV・データ保持、スケール/削除後のPVC再利用、headless Service、CLI/ツリー/プロパティ、Snapshot v29と運用2ミッションを追加。Parallel・単一image/PVCマウント・Retainに限定し、OrderedReady/実際の更新順序、OnDelete/partition/ControllerRevision、実DNS/アプリ複製、複数コンテナ・regional HA/Workload Identity・VPA/Autopilot固有要件は継続します。

Issue #15完了対応（2026-10-06）: 既存Issue 1件を作業単位として残項目をまとめる。複数コンテナ・WI・VPA 3モード・Autopilotの限定プロファイル・regional配置と9ミッションを追加（全79件、316コマンド）。旧24段階の残項目は上記対応範囲で更新し、実通信/HA/高度なKubernetes仕様を未対応として明記する。

Issue #16完了対応（2026-10-06）: 外部passthrough TCP LB、グローバル外部Application LB、リージョン内部Application LBの接続、正式なscoped HC、MIG named ports・backend着脱/health、URL map・HTTP/HTTPS proxy・Google-managed SSL certificate、proxy-only subnet、アプリ/FW/port/healthy数診断、zonal GCE_VM_IP_PORT NEG・backend bucket・CDN設定・Network Service Tiersと片付けを追加。7ミッション（全86件）・364コマンド・Snapshot v31。詳細な対応/非対応と教材は[LOAD_BALANCING.md](LOAD_BALANCING.md)に記載。実通信/課金/コード実行、UDP/IPv6、proxy Network LB、他NEG、実TLS/証明書発行/キャッシュ・throughput/HAは再現しません。
