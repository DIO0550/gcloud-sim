# Terraformの操作演習

HCLを編集し、gcloudと同じWorldにVPC・サブネット・VM・firewall・bucketを構築します。実TerraformやGoogle providerを起動するものではなく、対応した構文と状態変化を再現します。

## 初回の構築

CLI画面の「ファイル」タブでterraform-networkを選び、「テンプレートを読み込む」を押します。main.tfの内容を確認してから、ターミナルで実行します。

```sh
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

保存planの適用には追加確認がありません。planを指定しないapply/destroyでは、計画を確認してから`yes`で適用します。`-auto-approve`は確認を省きます。古いstateやリソース状態を基にしたplanは拒否します。

## 設定の編集

「ファイル」タブでterraform.tfvarsを作成し、次の内容を保存します。

```hcl
subnet_cidr = "10.43.0.0/24"
```

main.tfの`private_ip_google_access = false`を`true`へ変更して保存し、`terraform plan`→`terraform apply`→`yes`で適用します。ファイルの保存だけではリソースは変わりません。

テンプレートの同名ファイルを更新するときは「同名のファイルを置き換える」にチェックを入れます。テンプレートに含まれないファイルは残ります。ファイル・state・保存planは自動保存され、Snapshotへ含まれます。

## 既存リソースのimport

```sh
gcloud compute networks create tf-import-net --subnet-mode=custom
```

「ファイル」タブでimport.tfを作成して保存します。

```hcl
resource "google_compute_network" "imported" {
  project                 = "ace-dev-01"
  name                    = "tf-import-net"
  auto_create_subnetworks = false
}
```

```sh
terraform import google_compute_network.imported projects/ace-dev-01/global/networks/tf-import-net
terraform state show google_compute_network.imported
terraform plan
```

importは既存リソースをstateへ記録します。`terraform state rm`はstateの管理対象から外し、リソースを残します。`terraform destroy`は管理対象のリソースを削除し、構成ファイルを残します。

## moduleへの移行

最初の演習でVPCとサブネットを作った後、「ファイル」タブでterraform-modulesを同名置き換え付きで読み込みます。main.tfとmodules/network/main.tfを確認します。

```sh
terraform init
terraform fmt -recursive
terraform validate
terraform plan -out=module-plan
terraform show module-plan
terraform apply module-plan
terraform state list
terraform output
```

movedブロックによってstateのアドレスを移し、既存のVPCとサブネットを保持します。他のtfvarsやimport.tfはそのまま残ります。

## GCS backendへの移行

ローカルstateでリソースを作った後、移行先を用意します。

```sh
gcloud storage buckets create gs://ace-dev-01-tf-state --location=us-central1 --uniform-bucket-level-access
gcloud storage buckets update gs://ace-dev-01-tf-state --versioning
```

「ファイル」タブでterraform-backendを読み込み、backend.tfを確認します。

```sh
terraform init -migrate-state
yes
terraform state list
terraform state pull
terraform plan
```

`yes`は移行確認への回答です。アプリ独自のロック注入・state破損・世代復旧コマンドは提供しません。

## 対応範囲

変数・tfvars・count/for_each・ローカルmodule・限定moduleカタログ・moved・state/import・GCS backendを扱います。任意provider・workspace・実クラウドの並行更新・任意コード実行は未対応です。正確なコマンド一覧は[COMMANDS.md](COMMANDS.md)、学習目標の対応・未対応は[ACE_SOURCE_MAP.md](ACE_SOURCE_MAP.md)を参照してください。
