# 添付48資料の学習目標から演習への対応表

資料の学習目標と、現在公開するCLI演習の対応です。独自コマンドでの選択回答・構成判定は公開演習から除外しています。資料の全範囲を再現したという意味ではありません。

ミッションIDは公開カタログに存在するものだけを載せます。対応する演習がない資料は「コマンド演習未対応」とします。CLI・Consoleの操作練習と通常のファイル編集で進められる範囲のみ対象です。

| 資料 | 学習目標の要約 | 公開ミッションID | CLIの入口 | 対応範囲 |
|---|---|---|---|---|
| Terraform/T-TFGC-B-Locales-m6-l2-file-ja-40.pdf.ja | リソースリンク集。Terraform M1〜M5の学習範囲案内 | `m-terraform-001` | terraform init / plan / apply | 部分対応。詳細は公開ミッションと[対応コマンド](COMMANDS.md)を参照 |
| Terraform/M5_T-TFGC-B_Introduction_to_the_Terraform_State_JA.pdf | stateの意味、ローカル/remote比較、GCS backend、lock/IAM/版管理、state保護 | `m-terraform-007` | terraform state | 部分対応。詳細は公開ミッションと[対応コマンド](COMMANDS.md)を参照 |
| Terraform/M2_T-TFGC-B_Terms_and_Concepts_JA.pdf | IaCワークフロー/HCL/provider version、init/fmt/validate/plan/apply/destroy、Terraform Validator | `m-terraform-001` / `m-terraform-008` / `m-terraform-009` | terraform plan / apply | 部分対応。詳細は公開ミッションと[対応コマンド](COMMANDS.md)を参照 |
| Terraform/M3_T-TFGC-B_Writing_Infrastructure_Code_for_Google_Cloud_JA.pdf | resource宣言、変数/CLI値指定/出力、count/for_each、明示/暗黙依存、Registry/Cloud Foundation Toolkit | `m-terraform-008` / `m-terraform-009` | terraform plan | 部分対応。詳細は公開ミッションと[対応コマンド](COMMANDS.md)を参照 |
| Terraform/M1_T-TFGC-B_Introduction_to_Terraform_for_Google_Cloud_JA.pdf | IaC定義、宣言型の特長、Terraform利用/用途/メリット | `m-terraform-001` | terraform init / validate / plan | 部分対応。詳細は公開ミッションと[対応コマンド](COMMANDS.md)を参照 |
| Terraform/M4_T-TFGC-B_Organizing_and_Reusing_Configuration_with_Terraform_Modules_JA.pdf | root/child module、ローカル/公開Registry/GitHubのsource比較、version固定、入出力、再利用 | `m-terraform-004` / `m-terraform-010` | terraform plan / apply (module/moved) | 部分対応。詳細は公開ミッションと[対応コマンド](COMMANDS.md)を参照 |
| Terraform/Terraform_Infrastructure_Google_Cloud_JA.pdf | VPC/subnet構築、plan/変更/ドリフト、再作成せずmodule移行、GCS backend/state/import/片付け | `m-terraform-007` / `m-terraform-014` | terraform refresh | 部分対応。詳細は公開ミッションと[対応コマンド](COMMANDS.md)を参照 |
| その他/T-DVCRUN-B-m4-l1-ja-file-17.ja.pdf | Cloud Run service/job、min/max/concurrency、invoker/ingress/SA、container契約、revision/traffic、VPC→Redis | コマンド演習未対応 | — | コマンド演習未対応 |
| その他/T-AIGPU-I-m2-l1-ja-file-8.ja.pdf | CPU/GPU/TPU選定、training/fine-tuning/inference、scale/latency、GCE/GKE/Cloud Run/Vertex AI制御差 | `compute-gpu` | gcloud compute instances | 部分対応。詳細は公開ミッションと[対応コマンド](COMMANDS.md)を参照 |
| その他/T-AITPU-I-m2-l1-ja-file-12.ja.pdf | TPU ASIC、Pod/slice、GPU相互運用、DWS/予約/on-demand/Spot、shape/layout/padding効率 | `compute-tpu` | gcloud compute tpus | 部分対応。詳細は公開ミッションと[対応コマンド](COMMANDS.md)を参照 |
| その他/T-AIDEP-I-m5-l1-ja-file-20.ja.pdf | GCE/GKE/Toolkit/Vertex AIのデプロイ選定、機種→利用方式→platform→orchestrator→image→作成 | コマンド演習未対応 | — | コマンド演習未対応 |
| Operations Suite/T-STACKD-B_03_Alerting_Policies.pdf | SLI/SLO/SLA、error budget、alert policy/戦略/種類、service monitoring | コマンド演習未対応 | — | コマンド演習未対応 |
| Operations Suite/T-STACKD-B_01_Introduction to Google Cloud Operations Suite.pdf | Observability、Monitoring、Logging/Error Reporting、Trace/Profilerの役割/選定 | `m-observe-001` / `m-observe-003` | gcloud logging / monitoring | 部分対応。詳細は公開ミッションと[対応コマンド](COMMANDS.md)を参照 |
| Operations Suite/T-STACKD-B_00_Course1_Introduction.pdf | Logging/Monitoring/Service MonitoringとAPMのコース全体像 | `m-observe-001` | gcloud logging / monitoring | 部分対応。詳細は公開ミッションと[対応コマンド](COMMANDS.md)を参照 |
| Operations Suite/T-STACKD-B_04_Advanced_Logging_and_Analysis.pdf | Logs Explorer、log-based metrics、sink inclusion/exclusion、BigQueryログ分析、Log Analytics | `m-observe-001` | gcloud logging buckets / views / sinks / bq query | 部分対応。詳細は公開ミッションと[対応コマンド](COMMANDS.md)を参照 |
| Operations Suite/T-STACKD-B_00_Course1_Summary.pdf | multi-project monitoring、alert/uptime、ログ収集/エクスポートの復習 | コマンド演習未対応 | — | コマンド演習未対応 |
| Operations Suite/T-STACKD-B-m7-l1-ja-file-39.ja.pdf | Operations Suite各モジュールと復習のリンク集 | コマンド演習未対応 | — | コマンド演習未対応 |
| Operations Suite/T-STACKD-B_02_Monitoring_Critical_Systems.pdf | 複数project metrics scope、dashboard/chart、uptime、PromQLの目的 | `m-observe-003` | gcloud monitoring dashboards | 部分対応。詳細は公開ミッションと[対応コマンド](COMMANDS.md)を参照 |
| Operations Suite/T-STACKD-B_05_Working with Cloud Audit Logs.pdf | Admin Activity/Data Access/System Event/Policy Denied、監査ログ構成/閲覧/IAM/ベストプラクティス | コマンド演習未対応 | — | コマンド演習未対応 |
| 負荷分散/Compute_Engine_Load_Balancing_JA.pdf | 外部passthrough TCP/global外部HTTP/region内部HTTP、MIG/HC/FW/URL map/診断/片付け | コマンド演習未対応 | — | コマンド演習未対応 |
| GKE/Deploy_Kubernetes_Applications_Google_Cloud_JA.pdf | Docker build/run/push→Artifact Registry→GKE Deployment/Service、scale/update/undo/config/障害/片付け | `m-gke-001` / `m-gke-002` / `m-deploy-004` | kubectl apply / rollout / get | 部分対応。詳細は公開ミッションと[対応コマンド](COMMANDS.md)を参照 |
| GKE/ACE_GKE_Study_Guide_JA.pdf | Image/Container/Pod/Deployment/Service、Standard/Autopilot、gcloud/kubectl、状態/イベント/log診断 | `m-deploy-003` | gcloud container clusters / kubectl | 部分対応。詳細は公開ミッションと[対応コマンド](COMMANDS.md)を参照 |
| 試験ガイド/associate_cloud_engineer_exam_guide_japanese.pdf | 添付試験ガイド4セクション。設定/計画実装/運用/アクセスセキュリティ、各目標に分野を対応 | コマンド演習未対応 | — | コマンド演習未対応 |
| データベース/Google_Cloud_Database_Selection_JA.pdf | SQL/AlloyDB/Spanner対NoSQL/cache/分析、人工vector検索、DMS移行、選定/片付け | コマンド演習未対応 | — | コマンド演習未対応 |
| Cloud Run Functions/M2_Calling_and_Connecting_Cloud_Run_Functions.pdf | HTTP/PubSub/Storage/Firestore/Eventarc trigger、Workflows、VPC connector→Redis/VM | コマンド演習未対応 | — | コマンド演習未対応 |
| Cloud Run Functions/M5_Best_Practices_for_Functions.pdf | 冪等性、HTTP応答、cold start/connection再利用、retry終了条件、timeout/memory/concurrency、scale/traffic | コマンド演習未対応 | — | コマンド演習未対応 |
| Cloud Run Functions/M6_Course_Review.pdf | functions作成/test/deploy、trigger、Workflows/VPC、IAM/CMEK、env/secrets/Firestore/Redis復習 | コマンド演習未対応 | — | コマンド演習未対応 |
| Cloud Run Functions/M3_Securing_Cloud_Run_Functions.pdf | identity/network制御、authentication/authorization、invoker/runtime SA、CMEK保護 | コマンド演習未対応 | — | コマンド演習未対応 |
| Cloud Run Functions/M1_Introduction_to_Cloud_Run_Functions.pdf | functions特長/利用ケース、作成/deploy、構成/monitoring/log、世代比較 | コマンド演習未対応 | — | コマンド演習未対応 |
| Cloud Run Functions/M4_Integrating_Cloud_Databases.pdf | env、Secret Manager/secretAccessor/version、Redis authorized VPC、Firestoreイベント/CRUD | コマンド演習未対応 | — | コマンド演習未対応 |
| Cloud Run Functions/T-DVFUNC-I-m7-l1-ja-file-21.ja.pdf | functionsコースM0〜M6リンク集 | コマンド演習未対応 | — | コマンド演習未対応 |
| Cloud Run Functions/M0_Course_Introduction.pdf | functions用途、build/test/deploy、secure/connect/databases、best practicesという全体目標 | コマンド演習未対応 | — | コマンド演習未対応 |
| 基礎コース/10_Infrastructure_Automation_JA.pdf | Terraform auto-mode VPC/firewall/VM2台構築/確認、Cloud Marketplaceの目的/既存配置更新責任 | `m-terraform-001` / `m-terraform-010` | terraform | 部分対応。詳細は公開ミッションと[対応コマンド](COMMANDS.md)を参照 |
| 基礎コース/11_Managed_Services_JA.pdf | BigQuery/Dataflow/Dataprep/Dataprocのmanaged分析処理選定と管理分担（Dataprepの操作は未対応） | コマンド演習未対応 | — | コマンド演習未対応 |
| 基礎コース/T-ECISA-I-5-l1-ja-file-47.ja.pdf | scaling/automationコースの相互接続/LB/Terraform/managed servicesリンク集 | `m-terraform-001` | gcloud compute / terraform / gcloud functions | 部分対応。詳細は公開ミッションと[対応コマンド](COMMANDS.md)を参照 |
| 基礎コース/06_Resource_Management_2.2.7_JA.pdf | Resource Manager、quota、labels、billing/budget/alert、BigQuery課金分析 | コマンド演習未対応 | — | コマンド演習未対応 |
| 基礎コース/T-ESSCICS-I-4-l1-ja-file-54.ja.pdf | core servicesのIAM/storage/database/resource management/monitoringリンク集 | コマンド演習未対応 | — | コマンド演習未対応 |
| 基礎コース/T-ESSCIF-I-Locales-0-l2-file-ja-2.pdf.ja | foundation/core/scalingのコース案内、cloud操作/VPC/VMとmanaged servicesの配置 | コマンド演習未対応 | — | コマンド演習未対応 |
| 基礎コース/03_Virtual_Machines_v2.2.7_JA.pdf | VM作成/操作、CPU/memory/custom、images/disks、availability/Spot、接続/保護/選定 | `compute-custom` | gcloud compute instances / disks / images / ssh | 部分対応。詳細は公開ミッションと[対応コマンド](COMMANDS.md)を参照 |
| 基礎コース/02_Virtual_Networks_2.2.7_JA.pdf | VPC/project/network/subnet、IP/route/FW、料金/設計、Private Google Access/Cloud NAT | コマンド演習未対応 | — | コマンド演習未対応 |
| 基礎コース/04_IAM_2.2.7_JA.pdf | IAM org/roles/members/service account、継承/最小権限/組織アクセス制限 | `m-iam-001` | gcloud projects / iam / org-policies | 部分対応。詳細は公開ミッションと[対応コマンド](COMMANDS.md)を参照 |
| 基礎コース/05_Storage_and_Database_Services_v2.2.7_JA.pdf | object/file/SQL/Spanner/AlloyDB/Firestore/Bigtable/cache/BigQueryの用途比較、Storage/SQL演習 | コマンド演習未対応 | — | コマンド演習未対応 |
| 基礎コース/08_Interconnecting_Networks_2.2.7_JA.pdf | HA VPN/Interconnect/peering、Shared VPC、要件に応じた接続選定 | コマンド演習未対応 | — | コマンド演習未対応 |
| 基礎コース/09_Load_Balancing_and_Autoscaling_2.2.7_JA.pdf | MIG/autoscale、Application/proxy/passthrough/internal LB、CDN、LB選定 | コマンド演習未対応 | — | コマンド演習未対応 |
| 基礎コース/01_Interacting_with_Google_Cloud_JA.pdf | Console/Cloud Shell/CLI/API/mobileの使い分け、Marketplace配置、project/API/事前確認 | `admin-apibilling` | gcloud config / services | 部分対応。詳細は公開ミッションと[対応コマンド](COMMANDS.md)を参照 |
| 基礎コース/00_Course_Introduction_JA.pdf | Compute中心学習の全体像、IaaS/PaaS/SaaS/compute選定/region-zone、公式ラボ手続き除外 | コマンド演習未対応 | — | コマンド演習未対応 |
| 基礎コース/T-ESSCIF-I-4-l1-ja-file-45.ja.pdf | foundationのcloud操作/VPC/VMリンク集 | `compute-custom` | gcloud config / compute | 部分対応。詳細は公開ミッションと[対応コマンド](COMMANDS.md)を参照 |
| 基礎コース/07_Resource_Monitoring_2.2.7_JA.pdf | Monitoring/Logging/Error Reporting/Trace/Profiler、resource監視の演習と診断選定 | `m-observe-003` | gcloud monitoring | 部分対応。詳細は公開ミッションと[対応コマンド](COMMANDS.md)を参照 |
