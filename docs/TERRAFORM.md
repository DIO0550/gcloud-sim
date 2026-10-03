# Terraform 学習シミュレーター（第4段階：GCS backend・state移行）

Issue [#13](https://github.com/DIO0550/gcloud-sim/issues/13) の部分実装です。教材のネットワーク・VM・firewall・bucketの構築・変更・取り込み・モジュール化・片付けを、既存のgcloud操作と同じWorldで実行します。TerraformやGoogle providerそのものは実行しません。通信、認証情報の取得、課金、任意コードの実行はありません。

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

`import` は既存リソースの情報をstateに記録します。HCLや実リソースは変更せず、同じ実リソースの二重取り込みを拒否します。ComputeのIDは構成のproject/name/region/zoneと一致する完全な `projects/...` 形式、bucketは名前または `project/name` を指定します。bucketをimportした直後のforce_destroyはfalseです。`state mv` は同じ型のリソースアドレス間に対応し、ルートとmodule内部の間でも移せます。module呼び出し全体の一括移動やインスタンスキーには未対応です。`state rm` は実リソースを残します。そのまま再度planすると、同名リソースが存在するため再取り込みを案内します。

`terraform destroy` はstateの管理対象だけを削除し、ファイルを残します。stateから外したリソースは削除しません。依存関係はVM→firewall/subnet→VPCの順に解消します。bucketはネットワークと独立して扱います。失敗時に途中までの変更を残さない、アプリ内の一括適用です（実Terraformの部分成功とは異なります）。

## ローカルmoduleへ移行する

最初の演習で作成したVPC/subnetをそのまま使います。変更演習を先に行った場合は、tfvarsやPrivate Google Accessが初期値と異なるため、アドレス移行に加えてその変更もplanに表示されます。

```sh
sim files load terraform-modules --force
sim files read main.tf
sim files read modules/network/main.tf
terraform init
terraform fmt -recursive
terraform validate
terraform plan -out=module-plan
terraform show module-plan
terraform apply module-plan
terraform state list
terraform output
terraform plan
```

`--force` は例に含まれるmain.tfとmodules/network/main.tfを上書きします。他のファイルやtfvarsは残ります。移行前のリソースが初期値なら、planは2つの `has moved to` とリソース差分なしを表示します。planの段階ではstateを変更せず、apply後にアドレスが `module.network.google_compute_network.lab` と `module.network.google_compute_subnetwork.lab` に変わります。movedブロックを残して再実行しても再移動しません。初めて作成する環境では移動元が存在しないため、通常の新規作成になります。

- `source = "./modules/network"` などのローカル相対パスだけを読みます。子から兄弟への `../network` は仮想領域内なら使用可能です。ホストのファイルやネットワークにはアクセスしません。
- moduleのスカラー入力・出力と既定google providerの継承に対応します。子モジュールに親の変数は自動では渡りません。tfvarsの自動読込はルートだけです。
- 子module内のprovider設定、providers/depends_on/count/for_each/version引数は明示エラーです。入れ子は4段、呼び出しの展開は32個、展開後のブロックは200個・リソースは100個までです。
- movedは同じresource型のアドレス間に対応します。子内のmovedは子のスコープを基準に解決します。移行履歴の連鎖にも対応し、循環・複数の移動元/先・移動先のstate占有を拒否します。最終移動先が構成にあること、移動元が構成に残っていないことも検証します。
- moduleディレクトリは実行時に仮想ファイルから評価します。実Terraformのmoduleインストールキャッシュや、source変更後の再init要求は再現しません。fmtは通常ルートだけ、`-recursive`付きでサブディレクトリも対象です。
- 追加ミッション「既存ネットワークを壊さずモジュールへ移す」は、移行前のリソースを用意し、移行planを保存して適用する演習です。新規module作成だけ、planだけ、再作成を含む変更では完了しません。

## VM・firewall・bucketをまとめて構築する

初期状態からは次の例で5リソースを作成できます。以前の演習ファイルがある場合は内容を確認してください。`--force`でも他のtfファイルやtfvarsは残るので、重複する宣言や不要な変数を整理します。

```sh
sim files load terraform-infrastructure
sim files read main.tf
gcloud auth application-default login
terraform init
terraform fmt
terraform plan -out=infra-plan
terraform apply infra-plan
gcloud compute instances describe tf-lab-vm --zone=us-central1-a
gcloud compute firewall-rules describe tf-lab-http
gcloud storage buckets describe gs://ace-dev-01-tf-lab-assets
terraform output
terraform plan
```

| リソース | 対応属性と制約 |
|---|---|
| VM | name/project/zone/machine_type、tags、文字列metadata、allow_stopping_for_update。標準VM・boot_disk.initialize_params（image/size/type）1個・network_interface（network/subnetwork）1個。networkとsubnetworkは両方必須、同じプロジェクトとリージョンのものを指定 |
| VMの通信・認証 | 空のaccess_configがあればエフェメラル外部IP、なければ外部IPなし。service_accountを省略すると未接続。指定する場合はemailとscopesが必須で、既存アカウントとADCのiam.serviceAccounts.actAsを検証。metadataのスクリプトは保存だけで実行しない |
| firewall | network、direction、priority、IPv4 source_ranges/destination_ranges、target_tags、disabled、allowまたはdenyの一方。ルールはprotocolとports。INGRESSはsource_ranges必須でdestination_rangesはこのサブセットでは非対応。EGRESSはsource_ranges不可。ポートはtcp/udpの0〜65535と範囲指定 |
| bucket | location、storage_class（STANDARD/NEARLINE/COLDLINE/ARCHIVE）、uniform_bucket_level_access、public_access_prevention（enforced/inherited）、versioning.enabled、force_destroy。名前はWorld全体で重複拒否 |

VMはカタログ内のゾーン・machine type・公開イメージ・ディスク種別を使います。imageは `debian-cloud/debian-12` のようなproject/family、project/name、完全なイメージパスに対応します。ブートディスクはこの学習環境では10GB/pd-standardが既定で、10〜65536GBの整数を受け付けます。内部IPは同じサブネットで未使用のものを割り当てます。

VMのtags/metadataと、firewall・bucketの可変属性はその場で更新します。VMのmachine_typeまたはservice_accountを変更する際、実VMが停止中でなければ `allow_stopping_for_update = true` が必要です。稼働中の更新ではstop/start権限も確認します。名前・プロジェクト・VMゾーン・ネットワーク・subnet・イメージ・ディスクサイズ/種別・外部IPの有無、firewallのネットワーク/方向、bucketのlocationの変更はこの実装では置換です。**ディスク拡張や外部IP変更など、実providerがその場で変更できる項目も置換として扱う限定仕様**です。管理外の依存リソースがある置換・削除は拒否します。

```sh
gcloud compute instances add-tags tf-lab-vm --zone=us-central1-a --tags=extra
gcloud storage buckets update gs://ace-dev-01-tf-lab-assets --no-versioning
terraform plan
terraform apply -refresh-only -auto-approve
terraform plan
terraform apply -auto-approve
```

CLIによる対応属性の変更をドリフトとして表示します。refresh-onlyはstateだけを更新し、通常applyがHCLへ戻します。VMの実行状態・IPそのもの・作成時刻などの計算属性、bucketのオブジェクト/IAM/lifecycleはTerraformの属性として追跡しません。対応属性の更新ではbucketの既存オブジェクト・IAM・lifecycleを維持します。MIG所属VM、複数NIC/ディスク、Spot VMの取り込み・管理は明示拒否します。

## 構築したリソースを片付ける

```sh
terraform plan -destroy -out=cleanup-plan
terraform show cleanup-plan
terraform apply cleanup-plan
terraform state list
```

bucketにオブジェクトがあると削除を拒否し、一括適用を取り消します。オブジェクトを片付けるか、HCLの `force_destroy = false` を `true` に変更して**通常のapplyを先に実行**し、stateに記録してからdestroy planを作り直します。HCLだけを変更してもdestroy時の削除方針は変わりません。force_destroyでオブジェクトを消す際はstorage.objects.list/deleteも検証します。版管理は既存シミュレーターの有効/無効設定を共有します。通常のオブジェクトの世代履歴は未対応ですが、GCS backendのstateは下記の限定的な履歴を持ちます。

「TerraformでVM・firewall・bucketをまとめて構築する」と「Terraformの管理対象を依存順に片付ける」の2ミッションを追加しています。片付けは構築後の保存destroy planと適用後の空のstate・実リソースを確認します。初めから空の状態、planだけ、state rmだけでは完了しません。

## GCS backendへstateを移行する

最初の演習でローカルstateにVPC/subnetを作成した後、実リソースをそのまま保持して移行します。backend用bucketはinitより先に存在する必要があります。`terraform-backend` の例はbackend.tfだけを追加します。

```sh
gcloud storage buckets create gs://ace-dev-01-tf-state --location=us-central1 --uniform-bucket-level-access
gcloud storage buckets update gs://ace-dev-01-tf-state --versioning
sim files load terraform-backend
sim files read backend.tf
terraform init -migrate-state
yes
terraform state pull
sim terraform backend
gcloud storage ls gs://ace-dev-01-tf-state/terraform/lab/
terraform plan
```

```hcl
terraform {
  backend "gcs" {
    bucket = "ace-dev-01-tf-state"
    prefix = "terraform/lab"
  }
}
```

- rootのbackend宣言は1個、bucket/prefixはリテラル文字列のみです。prefix省略時はbucket直下、上記では `terraform/lab/default.tfstate` に保存します。明示的な `backend "local" {}` またはbackend宣言の削除でローカルへ戻せます。
- 初期化後のbucket/prefix/種別の変更には `init -migrate-state` が必要です。確認前は書き込まず、`yes` で移行、`no` でキャンセルします。`-force-copy` は移行と確認省略を兼ねます。移行前のリモートコピーは残ります。移行先の異なるstateや未知の既存オブジェクトは上書きしません。
- backendはproviderとは独立して、**bucket所属プロジェクト**のStorage APIとADCを確認します。読込にはstorage.objects.get/list、書込・ロックにはさらにcreate/deleteが必要です。bucket単位のroles/storage.objectAdminで移行でき、roles/storage.objectViewerではstateを読めますが更新できません。
- Object Versioningが無効でもinitは警告付きで成功します。有効時のstate更新は過去10世代まで保持し、`sim terraform backend` で世代・serial・リソース数を確認できます。最大8か所のリモート保存先を扱います。世代の復元コマンドは未対応です。
- apply/refresh-only/import/state mv/rmの成功時にリモートstateも更新します。planは権限とロックを確認しますが、Worldを変更しません。移行前の保存plan、stateとキャッシュの不一致、外部で削除・上書きされたstateを拒否します。
- active backend bucketをTerraformで削除・置換する計画はforce_destroy指定にかかわらず拒否します。先に別backendへ移行してください。gcloudでstateやbucketを削除した場合は、後続Terraform操作が明示エラーになります。

ロック復旧を試すには、移行後に次を実行します。

```sh
sim terraform lock
terraform plan
sim terraform backend
# 表示された実際のLock IDを指定する
terraform force-unlock tf-lock-番号
yes
terraform plan
```

`sim terraform lock` はこのアプリ専用の障害演習で、終了済み操作が残したロックを作ります。plan/apply/state変更/移行を拒否しますが、stateの読込は可能です。force-unlockはIDとロックオブジェクトの一致を確認し、`yes`（または `-force`）でロックだけを解除します。実環境でのforce-unlockは対象操作が停止したことを確認してから行うものです。

新ミッション「ローカルstateをGCS backendへ移行する」は、指定VPC/subnetの移行記録・現在の構成/state/実リソース・bucket版管理を確認します。最初からGCSで作成した場合や確認前のプレビューだけでは完了しません。

**シミュレーション上の制限:** 単一の仮想作業領域・default workspaceのみです。実GCS通信・複数クライアントの同時実行は行わず、書込とロック検証はWorldの一括更新です。state本文と世代履歴はアプリ内データに保持し、bucketにはサイズ・更新日時などのオブジェクト情報を反映します。サイズはJSON文字数の概算です。一般の `gcloud storage cp` は本文を扱わないため、任意tfstateのアップロード・復旧や世代指定のダウンロードはできません。`terraform state pull` のJSONもアプリ固有の簡略形式で、実Terraformへのstate移植には使えません。`-backend-config`、`-reconfigure`、`-lock=false`、workspace切替、CMEK、認証情報・impersonationのbackend設定は未対応として拒否します。

## 対応範囲

| 対象 | 対応 |
|---|---|
| ファイル | 単一の仮想作業領域とサブディレクトリ。`sim files list/read/write/replace/delete/load`。`.tf` / `.tfvars`、最大32ファイル、各64,000文字 |
| HCL | コメント、スカラーリテラル、ブロック、変数参照、リソース参照。対応属性の文字列リスト（各要素にスカラー参照可能）とmetadataの文字列object。空白区切りの1行入力も許容 |
| provider | 既定の `google`、`project` / `region` / `zone`。`required_providers` の `google = { source = "hashicorp/google" }` のみ |
| variable | 明示した `string` / `number` / `bool` 型、リテラルdefault、`terraform.tfvars` → ファイル名順の `*.auto.tfvars` による上書き |
| resource | `google_compute_network`（`auto_create_subnetworks = false`必須）、`google_compute_subnetwork`、`google_compute_instance`、`google_compute_firewall`、`google_storage_bucket`。既存カタログのリージョン、IPv4 /8〜/29 |
| 参照・output | `var.NAME`、resourceの `id` / `name` / `self_link`、subnetworkの `ip_cidr_range` / `private_ip_google_access`。VMのmachine_type/zone、firewallのpriority/direction/disabled、bucketのlocation/storage_class/urlなどスカラー属性も対応。配列・object・NIC内の計算属性はoutput参照不可。`module.NAME.OUTPUT`も対応。module間はスカラー型を保持し、ルート出力は文字列として記録 |
| plan | 通常／`-destroy`／`-refresh-only`、`-out`、show、保存planの適用。保存planは最大16個（同名で上書き可能） |
| 認証・権限 | gcloudログインとは別のADC主体、対象プロジェクト、Compute/Storage API、操作別権限を検証。既存bucketはbucket IAMも参照し、VMのNIC・ディスク作成・SA接続の権限を確認 |
| 状態 | list/show/pull/mv/rm/import、GCS backend移行・ロック。Snapshot v6。v4/v5の構成・state・保存planを保持し、local backendとrevision、v4のmovesを補完。v1/v2/v3は空のTerraform状態へ移行 |
| ミッション | VPC/subnet構築、変数・Private Google Access変更、既存VPCの取り込み、再作成なしのmodule移行、5リソース構築、片付け、GCS state移行の7本。構成・state・実リソースの一致で判定 |

`init` と `validate` はこのサブセットの設定済み変数も検証します。実Terraformのinit（構成の評価より前の初期化）や、入力値なしで行うvalidateの完全再現ではありません。実providerのダウンロード、バージョン解決、ロックファイル生成は行いません。

実行ディレクトリ、環境変数、ADCの秘密情報は扱いません。プロジェクトはHCLのprovider/resourceから決定します。Terraformとsimでは共通フラグのうちhelpだけを受け、gcloudの `--project` / `--account` / `--quiet` などは受け付けません。フラグの `--名前` はアプリの引数解析による別名としても受けますが、教材ではTerraformの `-名前` を使います。

## 残作業（Issue #13を閉じない）

- VM/firewall/bucketの追加属性（複数NIC・追加ディスク・Spot・削除保護・IPv6・firewallログなど）と完全なprovider挙動。
- リモートmodule、provider別名/明示providers設定、module単位のmoved、count/for_eachのインスタンス移行。
- GCS backendの世代復元、任意stateの入出力、CMEK、impersonation、複数クライアントの並行更新。
- provider/version制約、`-chdir`、workspace、`-var` / `-var-file`、複合型の変数/module入出力、関数、文字列テンプレート、for_each/count、data、locals、depends_on、lifecycle。
- 削除済みリソースを参照するoutputのrefresh。現状はoutputがある状態で構成のリソースが観測できなければ明示エラーとし、該当outputを外してから更新する。
- 保存planの実クラウド相当の競合制御、実providerの完全な差分/ForceNew規則、部分失敗と復旧。

上記の未対応ブロック・属性・式・フラグを、対応済みとして成功させません。

## 参照

- [Terraform plan](https://developer.hashicorp.com/terraform/cli/commands/plan)
- [Terraform apply](https://developer.hashicorp.com/terraform/cli/commands/apply)
- [Terraform state rm](https://developer.hashicorp.com/terraform/cli/commands/state/rm)
- [Terraform import](https://developer.hashicorp.com/terraform/cli/commands/import)
- [Google Cloud: Private Google Access](https://cloud.google.com/vpc/docs/configure-private-google-access)

- [Providers within modules](https://developer.hashicorp.com/terraform/language/modules/develop/providers)
- [Refactor modules / moved](https://developer.hashicorp.com/terraform/language/modules/develop/refactoring)

- [Google provider: compute_instance](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/compute_instance)
- [Google provider: compute_firewall](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/compute_firewall)
- [Google provider: storage_bucket](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/storage_bucket)

- [GCS backend](https://developer.hashicorp.com/terraform/language/backend/gcs)
- [Terraform init](https://developer.hashicorp.com/terraform/cli/commands/init)
- [Terraform force-unlock](https://developer.hashicorp.com/terraform/cli/commands/force-unlock)
