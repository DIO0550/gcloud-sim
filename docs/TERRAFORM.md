# Terraform 学習シミュレーター（第1段階）

Issue [#13](https://github.com/DIO0550/gcloud-sim/issues/13) の部分実装です。教材のネットワーク構築・変更・取り込みを、既存のVPCリソースと同じWorldで操作します。TerraformやGoogle providerそのものは実行しません。通信、認証情報の取得、課金、任意コードの実行はありません。

## 最初の演習

シミュレーターのターミナルで、1行ずつ実行します。

```sh
sim files load terraform-network
sim files read main.tf
gcloud auth application-default login
terraform init
terraform fmt
terraform validate
terraform plan -out=tfplan
terraform show tfplan
terraform apply tfplan
terraform state list
terraform state show google_compute_subnetwork.lab
terraform output
terraform plan
```

`sim files` はこのアプリ専用の編集コマンドです。実際のTerraformやCloud Shellのコマンドではありません。ファイル、state、保存planはセーブデータに含まれます。作成したVPCとサブネットはリソースツリーと既存のgcloud describe/listでも確認できます。

保存planを指定しない `terraform apply` / `terraform destroy` は、変更計画を表示した後、`yes` だけで適用します。`no` または空入力でキャンセルし、`y` では適用しません。`-auto-approve` は確認を省略します。保存planの適用は追加確認なしです。stateの更新や管理対象の実リソースの変更があれば、古い保存planを拒否します。構成ファイルだけを変更した場合、保存planは保存時点の構成を適用します。

## 編集とドリフト

```sh
sim files write terraform.tfvars --content='subnet_cidr = "10.43.0.0/24"'
sim files replace main.tf --search='private_ip_google_access = false' --replacement='private_ip_google_access = true'
terraform plan
terraform apply
yes
```

Private Google Accessはその場で更新します。名前・プロジェクト・リージョン・所属ネットワーク・CIDRの変更は、この実装では削除して再作成します。**実サービスで可能なCIDRの拡張操作は未対応**です。使用中リソースの削除や重複CIDRは拒否します。

外部変更と構成への復元も試せます。

```sh
gcloud compute networks subnets update tf-lab-subnet --region=us-central1 --no-enable-private-ip-google-access
terraform plan -refresh-only
terraform apply -refresh-only
yes
terraform state show google_compute_subnetwork.lab
terraform plan
terraform apply
yes
```

`plan` はstateや実リソースを書き換えません。`apply -refresh-only` は観測した値でstateとoutputだけを更新します。続く通常の `apply` は、HCLの指定値に実リソースを合わせます。

## 既存リソースとstate

```sh
gcloud compute networks create tf-import-net --subnet-mode=custom
sim files write import.tf --content='resource "google_compute_network" "imported" { project = "ace-dev-01" name = "tf-import-net" auto_create_subnetworks = false }'
terraform init
terraform import google_compute_network.imported projects/ace-dev-01/global/networks/tf-import-net
terraform state show google_compute_network.imported
terraform state mv google_compute_network.imported google_compute_network.renamed
sim files replace import.tf --search='"imported"' --replacement='"renamed"'
terraform plan
terraform state rm google_compute_network.renamed
```

`import` は既存リソースの情報をstateに記録します。HCLや実リソースは変更せず、同じ実リソースの二重取り込みを拒否します。IDは構成のproject/name/regionと一致する完全な `projects/...` 形式を指定します。`state mv` は同じ型のルートアドレス間だけに対応します。`state rm` は実リソースを残します。そのまま再度planすると、同名リソースが存在するため再取り込みを案内します。

`terraform destroy` はstateの管理対象だけを削除し、ファイルを残します。stateから外したリソースは削除しません。依存関係はサブネット→VPCの順に解消します。失敗時に途中までの変更を残さない、アプリ内の一括適用です（実Terraformの部分成功とは異なります）。

## 対応範囲

| 対象 | 対応 |
|---|---|
| ファイル | 単一の仮想ルート。`sim files list/read/write/replace/delete/load`。`.tf` / `.tfvars`、最大32ファイル、各64,000文字 |
| HCL | コメント、スカラーリテラル、ブロック、変数参照、リソース参照。空白区切りの1行入力も許容 |
| provider | 既定の `google`、`project` / `region`。`required_providers` の `google = { source = "hashicorp/google" }` のみ |
| variable | 明示した `string` / `number` / `bool` 型、リテラルdefault、`terraform.tfvars` → ファイル名順の `*.auto.tfvars` による上書き |
| resource | `google_compute_network`（`auto_create_subnetworks = false`必須）、`google_compute_subnetwork`。既存カタログのリージョン、IPv4 /8〜/29 |
| 参照・output | `var.NAME`、resourceの `id` / `name` / `self_link`、subnetworkの `ip_cidr_range` / `private_ip_google_access`。出力は文字列として記録 |
| plan | 通常／`-destroy`／`-refresh-only`、`-out`、show、保存planの適用。保存planは最大16個（同名で上書き可能） |
| 認証・権限 | gcloudログインとは別のADC主体、対象プロジェクト、Compute API、get/create/delete/setPrivateIpGoogleAccess権限を検証 |
| 状態 | list/show/mv/rm/import、Snapshot v4。旧v1/v2/v3から空のTerraform状態へ移行 |
| ミッション | VPC/subnet構築、変数・Private Google Access変更、既存VPCの取り込みの3本。構成・state・実リソースの一致で判定 |

`init` と `validate` はこのサブセットの設定済み変数も検証します。実Terraformのinit（構成の評価より前の初期化）や、入力値なしで行うvalidateの完全再現ではありません。実providerのダウンロード、バージョン解決、ロックファイル生成は行いません。

実行ディレクトリ、環境変数、ADCの秘密情報は扱いません。プロジェクトはHCLのprovider/resourceから決定します。Terraformとsimでは共通フラグのうちhelpだけを受け、gcloudの `--project` / `--account` / `--quiet` などは受け付けません。フラグの `--名前` はアプリの引数解析による別名としても受けますが、教材ではTerraformの `-名前` を使います。

## 残作業（Issue #13を閉じない）

- VM、firewall、bucketのresource、Google providerの追加属性。
- moduleの呼び出し・入出力・provider継承、movedブロック。
- GCS backend、版管理・IAMの検証、`init -migrate-state`、リモートロック。
- provider/version制約、`-chdir`、workspace、`-var` / `-var-file`、複合型、関数、文字列テンプレート、for_each/count、data、locals、depends_on、lifecycle。
- 削除済みリソースを参照するoutputのrefresh。現状はoutputがある状態で構成のリソースが観測できなければ明示エラーとし、該当outputを外してから更新する。
- 保存planの実クラウド相当の競合制御、実providerの完全な差分/ForceNew規則、部分失敗と復旧。
- module化、GCS state移行、片付けの独立ミッション。

上記の未対応ブロック・属性・式・フラグを、対応済みとして成功させません。

## 参照

- [Terraform plan](https://developer.hashicorp.com/terraform/cli/commands/plan)
- [Terraform apply](https://developer.hashicorp.com/terraform/cli/commands/apply)
- [Terraform state rm](https://developer.hashicorp.com/terraform/cli/commands/state/rm)
- [Terraform import](https://developer.hashicorp.com/terraform/cli/commands/import)
- [Google Cloud: Private Google Access](https://cloud.google.com/vpc/docs/configure-private-google-access)
