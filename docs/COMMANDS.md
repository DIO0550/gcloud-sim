# 対応コマンド

gcloud-sim が解釈するコマンドの一覧。**本物の一部だけ**を再現している（設計書 DJ-005: 未対応は
それっぽく成功させず、明示的にエラーにする）。

- **基準にした gcloud のバージョン**（TBD-001）: 2026-09 時点の公式リファレンス
  （`cloud.google.com/sdk/gcloud/reference`）。出力の綴りとフラグ名はこれに合わせ、差異は
  この表と Issue に記録する
- **IAM の判定はロールカタログに収録した権限だけで行う**（DJ-006 / TBD-006）。収録しているのは
  ACE 頻出の約 45 の事前定義ロールと、それが含む代表的な権限。**収録外の権限は許可に倒す**
  （学習を止めないため）。収録内容は `gcloud iam roles describe ROLE` で見られる
- ここに無いコマンドは `ERROR: (gcloud) Invalid choice: 'xxx'.`（E-001）になる。「未実装」の表に
  あるものは `gcloud-sim: command not implemented yet: ...`（E-002）になる
- グローバルフラグ `--project` `--account` `--format` `--filter` `--limit` `--sort-by`
  `--quiet`/`-q` `--help`/`-h` `--verbosity` はgcloud/gsutil/kubectlが受ける（Terraform/sim/Dockerはhelpのみ）
- `--format` は `json` / `yaml` / `value(FIELDS)` / `table(FIELDS)` / `none`、`--filter` は
  `key=value` / `key!=value` / `key:substring` / `NOT` / `AND` / `OR` の簡易版（DJ-009）
- `gcloud beta` / `gcloud alpha` は警告を出して `gcloud` と同じに扱う
- `delete` などの破壊的操作は `--quiet` が無ければ `Do you want to continue (Y/n)?` を挟む

この表は `src/engine/commands/` の登録簿から作っている。登録簿と食い違うと
`src/engine/__tests__/commands-doc.test.ts` が落ちる。

## 実装済み（316）

ConfigMap/SecretのYAML/JSONは`immutable: true`に対応します。保護後はデータ更新とfalseへの変更を拒否し、ラベル更新・削除/再作成は可能です。get/describe・プロパティにもフラグを表示します。詳細と教材は[KUBERNETES.md](KUBERNETES.md)に記載しています。

ConfigMapの`binaryData`もYAML/JSONで保存できます。getはbase64、describe・プロパティは復号後のサイズを表示します。`data`とのキー重複を拒否し、環境変数のキー参照・`set env --from`はテキストの`data`だけを扱います。`immutable: true`は両方のフィールドを保護します。

Kubernetesは`kubectl create/get/describe/delete namespace`（`ns`別名）とNamespace manifestに対応します。各kubectl操作と`sim kubernetes probe/reconcile`で`-n/--namespace`を使い、`kubectl get -A/--all-namespaces`でnamespaceを横断した一覧を確認できます。省略時はコンテキストの既定namespace（未設定なら`default`）です。`kubectl config set-context --current --namespace=staging`または既存CONTEXT名で設定し、空文字で解除できます。詳細は[KUBERNETES.md](KUBERNETES.md)。

PVC/StorageClassの仮想create/apply/deleteと、PVC/PV/StorageClassのget/describe/delete（pvc/pv/sc別名）に対応します。動的割り当て、WaitForFirstConsumer、容量拡張、削除保護、Delete/Retainを教材として再現します。アプリの書き込みは`sim kubernetes write-file DEPLOYMENT --path=PATH --content=TEXT`、確認は`kubectl exec -- cat/base64 PATH`です。操作ごとにcontainer.persistentVolumeClaims.* / container.persistentVolumes.* / container.storageClasses.*を要求します。制限と2ミッションは[KUBERNETES.md](KUBERNETES.md)に記載しています。

Ingressはnetworking.k8s.io/v1の仮想YAML/JSONによるcreate/apply/deleteとget/describe/delete（ingress/ingresses/ing）に対応します。権限は`container.ingresses.create/get/list/update/delete`、`-n`、`-A`、`-l`とJSON/YAML出力も使えます。`sim kubernetes request INGRESS --host=example.test --path=/`はHTTPの振り分けを確認します。`container.ingresses.get`、`container.services.get`、`container.deployments.list`、`container.pods.list`を要求します。ホスト・最長パス・Exact/PrefixとReadyなNodePort Service接続先を判定し、実LB・IP・DNS・TLS・ヘルスチェック・外部クライアントのNetworkPolicyは作成/判定しません。`get all`にはIngressを含めません。2ミッションの手順は[KUBERNETES.md](KUBERNETES.md)を参照してください。

NetworkPolicyはnetworking.k8s.io/v1の仮想YAML/JSONによるcreate/apply/deleteと、get/describe/delete（networkpolicy/networkpolicies/netpol別名）に対応します。操作ごとに`container.networkPolicies.create/get/list/update/delete`を要求し、`get -A`、`-l`、JSON/YAML出力を使えます。Autopilotは強制有効、Standardは作成時の`--enable-network-policy`で有効にします。`sim kubernetes connect SOURCE --to=DESTINATION --port=N`は両Deploymentの先頭Pod間の新規TCP通信を判定します。実通信や待受ポートの確認は行いません。既定遮断・許可の合算・両方向の許可と2ミッションは[KUBERNETES.md](KUBERNETES.md)に記載しています。`get all`にはNetworkPolicyを含めません。

Deploymentは1〜10個の名前付きコンテナに対応し、exec/logs/probeで対象を選べます。ServiceAccount（sa）・VerticalPodAutoscaler（vpa）のmanifest、get/describe/delete、namespace/-A・権限・保存/表示に対応します。VPAのOff/Initial/Recreate、GKE Workload Identity、Autopilotの単一コンテナのリソース補正、regionalのzone別ノード数は明示教材モデルです。手順と制限は[KUBERNETES.md](KUBERNETES.md)を参照してください。

### Cloud Build

固定教材をビルドしてArtifact Registryへ登録します。呼び出し元のbuilds権限とサービスアカウントのactAs、実行SAのレジストリ書込権限は別に検証します。操作例・制約は[CONTAINERS.md](CONTAINERS.md)。

| コマンド | 必要な権限 | 必要な API | フラグ |
|---|---|---|---|
| `gcloud builds submit` | cloudbuild.builds.create + iam.serviceAccounts.actAs | Cloud Build（登録時Artifact Registry） | --tag/-t, --service-account, --region, --async |
| `gcloud builds list` | cloudbuild.builds.list | Cloud Build | --region |
| `gcloud builds describe` | cloudbuild.builds.get | Cloud Build | --region |
| `gcloud builds log` | cloudbuild.builds.get | Cloud Build | --region |
| `gcloud builds cancel` | cloudbuild.builds.update | Cloud Build | --region |
| `sim builds advance` | cloudbuild.builds.update | Cloud Build（完了時Artifact Registry） | --region |

GKE clusters create/create-autoは`--service-account=EMAIL`で既存ノードSAを指定でき、作成者のactAsを確認します。Artifact Registry参照はノードSAのReader権限とタグ/digestの存在を検証し、取得できないDeployment/Podは`ImagePullBackOff`、rollout status/logsはエラーになります。

### Docker / Artifact Registry

ローカルのイメージ・コンテナとクラウドの保存先を分けて扱う学習用サブセットです。固定教材のみを使用し、実プロセス/クラウド通信は行いません。操作例・制限は [CONTAINERS.md](CONTAINERS.md)。

| コマンド | 必要な権限 | 必要な API | フラグ |
|---|---|---|---|
| `sim docker example` | — | — | — |
| `sim docker request` | — | — | — |
| `docker build` | — | — | --tag/-t（必須） |
| `docker images` | — | — | — |
| `docker tag` | — | — | — |
| `docker push` | artifactregistry.repositories.uploadArtifacts | artifactregistry.googleapis.com | — |
| `docker pull` | artifactregistry.repositories.downloadArtifacts | artifactregistry.googleapis.com | — |
| `docker run` | キャッシュなし時はpull権限 | キャッシュなし時はartifactregistry.googleapis.com | --detach/-d（必須）、--name、--publish/-p |
| `docker ps` | — | — | --all/-a |
| `docker logs` | — | — | — |
| `docker inspect` | — | — | — |
| `docker stop` | — | — | — |
| `docker rm` | — | — | --force/-f |
| `docker rmi` | — | — | — |
| `gcloud auth configure-docker` | ログイン済みアカウント | — | — |
| `gcloud artifacts repositories create` | artifactregistry.repositories.create | artifactregistry.googleapis.com | --repository-format=docker（必須）、--location、--description、--immutable-tags |
| `gcloud artifacts repositories list` | artifactregistry.repositories.list | artifactregistry.googleapis.com | --location |
| `gcloud artifacts repositories describe` | artifactregistry.repositories.get | artifactregistry.googleapis.com | --location |
| `gcloud artifacts repositories delete` | artifactregistry.repositories.delete | artifactregistry.googleapis.com | --location |
| `gcloud artifacts repositories get-iam-policy` | artifactregistry.repositories.getIamPolicy | artifactregistry.googleapis.com | --location |
| `gcloud artifacts repositories add-iam-policy-binding` | artifactregistry.repositories.setIamPolicy | artifactregistry.googleapis.com | --location、--member、--role |
| `gcloud artifacts repositories remove-iam-policy-binding` | artifactregistry.repositories.setIamPolicy | artifactregistry.googleapis.com | --location、--member、--role |
| `gcloud artifacts docker images list` | artifactregistry.dockerimages.list | artifactregistry.googleapis.com | --include-tags |
| `gcloud artifacts docker images describe` | artifactregistry.dockerimages.get | artifactregistry.googleapis.com | — |
| `gcloud artifacts docker tags list` | artifactregistry.tags.list | artifactregistry.googleapis.com | — |
| `gcloud artifacts docker tags add` | artifactregistry.tags.create/update | artifactregistry.googleapis.com | — |
| `gcloud artifacts docker tags delete` | artifactregistry.tags.delete | artifactregistry.googleapis.com | — |
| `gcloud artifacts docker images delete` | artifactregistry.versions.delete（版）/packages.delete（全体） | artifactregistry.googleapis.com | --delete-tags |

tags addは同一imageパス内のタグ作成/移動、tags deleteはタグだけを削除してdigestを保持します。images deleteは指定版またはimageパス全体を削除し、付随タグには--delete-tagsが必要です。immutable制約、repoAdmin権限、削除確認を検証します。非同期削除は未対応です。

repository操作の位置引数はID＋--location、または完全名projects/PROJECT/locations/LOCATION/repositories/ID。Dockerのpush/pullには対象ホストのconfigure-docker設定が必要で、ADCではなく現在のgcloudアカウントを使用します。v1〜v6のSnapshotは空のDocker/Artifact Registry状態を補完します。

### Terraform / 学習用ファイル

`sim files load terraform-infrastructure` でVPC/subnet/VM/firewall/bucketの構築・片付けを練習できます。

対応範囲・通常のTerraformとの差異・操作例は [TERRAFORM.md](TERRAFORM.md) を参照。

| コマンド | 必要な権限 | 必要な API | フラグ |
|---|---|---|---|
| `sim files list` | — | — | — |
| `sim files read` | — | — | — |
| `sim files write` | — | — | --content |
| `sim files replace` | — | — | --search, --replacement |
| `sim files delete` | — | — | — |
| `sim files load` | — | — | --force |
| `terraform init` | GCS時: ADCのstorage.objects.get/list/create/delete | GCS時: storage.googleapis.com（bucket所属project） | -migrate-state, -force-copy |
| `terraform state pull` | GCS時: ADCのstorage.objects.get/list | GCS時: storage.googleapis.com | — |
| `terraform force-unlock` | ADCのstorage.objects.get/list/create/delete | storage.googleapis.com | -force |
| `sim terraform backend` | GCS時: ADCのstorage.objects.get/list | GCS時: storage.googleapis.com | — |
| `sim terraform lock` | ADCのstorage.objects.get/list/create/delete | storage.googleapis.com | — |
| `terraform validate` | — | — | — |
| `terraform fmt` | — | — | -check, -recursive |
| `terraform plan` | ADCの管理対象操作権限・GCS state権限（下記） | 管理対象API・GCS時Storage API | -out, -destroy, -refresh-only |
| `terraform apply` | ADCの管理対象操作権限・GCS state権限（下記） | 管理対象API・GCS時Storage API | -auto-approve, -destroy, -refresh-only |
| `terraform destroy` | ADCの管理対象操作権限・GCS state権限（下記） | 管理対象API・GCS時Storage API | -auto-approve |
| `terraform show` | GCS state読込権限（下記） | GCS時Storage API | — |
| `terraform output` | GCS state読込権限（下記） | GCS時Storage API | — |
| `terraform state list` | GCS state読込権限（下記） | GCS時Storage API | — |
| `terraform state show` | GCS state読込権限（下記） | GCS時Storage API | — |
| `terraform state mv` | ADCの管理対象操作権限・GCS state権限（下記） | 管理対象API・GCS時Storage API | — |
| `terraform state rm` | ADCの管理対象操作権限・GCS state権限（下記） | 管理対象API・GCS時Storage API | — |
| `terraform import` | ADCの管理対象操作権限・GCS state権限（下記） | 管理対象API・GCS時Storage API | — |
| `gcloud compute networks subnets update` | compute.subnetworks.setPrivateIpGoogleAccess | compute.googleapis.com | --region, --enable-private-ip-google-access |

GCS backend使用時、stateを読むshow/output/state list/showにもstorage.objects.get/listが必要です。plan/apply/destroy/import/state mv/rmはさらにcreate/deleteを確認します。Compute/Storageの実リソース操作権限は管理対象ごとに別途確認します。local backendのstate読込とfmt/validate自体にはクラウド権限は不要です。保存planのshowもクラウド参照なしです。

### `gcloud config`

| コマンド | 必要な権限 | 必要な API | フラグ |
|---|---|---|---|
| `gcloud config set` | — | — | — |
| `gcloud config unset` | — | — | — |
| `gcloud config get` | — | — | — |
| `gcloud config get-value` | — | — | — |
| `gcloud config list` | — | — | `--all` |
| `gcloud config configurations list` | — | — | — |
| `gcloud config configurations create` | — | — | `--activate` |
| `gcloud config configurations activate` | — | — | — |
| `gcloud config configurations describe` | — | — | — |
| `gcloud config configurations delete` | — | — | — |

### `gcloud auth`

| コマンド | 必要な権限 | 必要な API | フラグ |
|---|---|---|---|
| `gcloud auth activate-service-account` | — | — | `--key-file` |
| `gcloud auth application-default login` | — | — | `--no-launch-browser` |
| `gcloud auth login` | — | — | `--brief` `--no-launch-browser` |
| `gcloud auth list` | — | — | — |
| `gcloud auth revoke` | — | — | — |

### `gcloud version`

| コマンド | 必要な権限 | 必要な API | フラグ |
|---|---|---|---|
| `gcloud version` | — | — | — |

### `gcloud info`

| コマンド | 必要な権限 | 必要な API | フラグ |
|---|---|---|---|
| `gcloud info` | — | — | `--run-diagnostics` |

### `gcloud init`

| コマンド | 必要な権限 | 必要な API | フラグ |
|---|---|---|---|
| `gcloud init` | — | — | `--skip-diagnostics` `--console-only` |

### `gcloud components`

| コマンド | 必要な権限 | 必要な API | フラグ |
|---|---|---|---|
| `gcloud components list` | — | — | — |
| `gcloud components install` | — | — | — |
| `gcloud components update` | — | — | — |

### `gcloud projects`

| コマンド | 必要な権限 | 必要な API | フラグ |
|---|---|---|---|
| `gcloud projects list` | — | — | — |
| `gcloud projects describe` | `resourcemanager.projects.get` | — | — |
| `gcloud projects create` | `resourcemanager.projects.create` | — | `--name` `--organization` `--folder` `--set-as-default` `--labels` |
| `gcloud projects delete` | `resourcemanager.projects.delete` | — | — |
| `gcloud projects undelete` | `resourcemanager.projects.undelete` | — | — |
| `gcloud projects get-iam-policy` | `resourcemanager.projects.getIamPolicy` | — | — |
| `gcloud projects add-iam-policy-binding` | `resourcemanager.projects.setIamPolicy` | — | `--member` `--role` |
| `gcloud projects remove-iam-policy-binding` | `resourcemanager.projects.setIamPolicy` | — | `--member` `--role` |

### `gcloud organizations`

| コマンド | 必要な権限 | 必要な API | フラグ |
|---|---|---|---|
| `gcloud organizations list` | — | — | — |
| `gcloud organizations describe` | `resourcemanager.organizations.get` | — | — |
| `gcloud organizations get-iam-policy` | `resourcemanager.organizations.getIamPolicy` | — | — |
| `gcloud organizations add-iam-policy-binding` | `resourcemanager.organizations.setIamPolicy` | — | `--member` `--role` |
| `gcloud organizations remove-iam-policy-binding` | `resourcemanager.organizations.setIamPolicy` | — | `--member` `--role` |

### `gcloud resource-manager`

| コマンド | 必要な権限 | 必要な API | フラグ |
|---|---|---|---|
| `gcloud resource-manager folders list` | — | — | `--organization` `--folder` |
| `gcloud resource-manager folders create` | `resourcemanager.folders.create` | — | `--display-name` `--organization` `--folder` |
| `gcloud resource-manager folders describe` | `resourcemanager.folders.get` | — | — |
| `gcloud resource-manager folders get-iam-policy` | `resourcemanager.folders.getIamPolicy` | — | — |
| `gcloud resource-manager folders add-iam-policy-binding` | `resourcemanager.folders.setIamPolicy` | — | `--member` `--role` |
| `gcloud resource-manager folders remove-iam-policy-binding` | `resourcemanager.folders.setIamPolicy` | — | `--member` `--role` |

### `gcloud billing`

| コマンド | 必要な権限 | 必要な API | フラグ |
|---|---|---|---|
| `gcloud billing accounts list` | — | — | — |
| `gcloud billing accounts describe` | — | — | — |
| `gcloud billing projects describe` | `billing.resourceAssociations.list` | — | — |
| `gcloud billing projects link` | `billing.resourceAssociations.create` | — | `--billing-account` |
| `gcloud billing projects unlink` | `billing.resourceAssociations.delete` | — | — |
| `gcloud billing budgets create` | `billing.budgets.create` | — | `--billing-account` `--display-name` `--budget-amount` `--threshold-rule` `--filter-projects` |
| `gcloud billing budgets list` | `billing.budgets.list` | — | `--billing-account` |
| `gcloud billing budgets describe` | `billing.budgets.get` | — | `--billing-account` |

### `gcloud services`

| コマンド | 必要な権限 | 必要な API | フラグ |
|---|---|---|---|
| `gcloud services enable` | `serviceusage.services.enable` | — | `--async` |
| `gcloud services disable` | `serviceusage.services.disable` | — | `--force` |
| `gcloud services list` | `serviceusage.services.list` | — | `--enabled` `--available` |

### `gcloud compute`

| コマンド | 必要な権限 | 必要な API | フラグ |
|---|---|---|---|
| `gcloud compute instances create` | `compute.instances.create` | `compute.googleapis.com` | `--zone` `--machine-type` `--image-family` `--image-project` `--network` `--subnet` `--tags` `--service-account` `--scopes` `--preemptible` `--provisioning-model` `--metadata` `--boot-disk-size` `--boot-disk-type` `--address` `--async` |
| `gcloud compute instances list` | `compute.instances.list` | `compute.googleapis.com` | — |
| `gcloud compute instances describe` | `compute.instances.get` | `compute.googleapis.com` | `--zone` |
| `gcloud compute instances start` | `compute.instances.start` | `compute.googleapis.com` | `--zone` `--async` |
| `gcloud compute instances stop` | `compute.instances.stop` | `compute.googleapis.com` | `--zone` `--async` |
| `gcloud compute instances suspend` | `compute.instances.suspend` | `compute.googleapis.com` | `--zone` `--async` |
| `gcloud compute instances resume` | `compute.instances.resume` | `compute.googleapis.com` | `--zone` `--async` |
| `gcloud compute instances delete` | `compute.instances.delete` | `compute.googleapis.com` | `--zone` `--keep-disks` `--delete-disks` `--async` |
| `gcloud compute instances add-tags` | `compute.instances.setTags` | `compute.googleapis.com` | `--zone` `--tags` |
| `gcloud compute instances add-metadata` | `compute.instances.setMetadata` | `compute.googleapis.com` | `--zone` `--metadata` |
| `gcloud compute instances set-machine-type` | `compute.instances.setMachineType` | `compute.googleapis.com` | `--zone` `--machine-type` |
| `gcloud compute instances attach-disk` | `compute.instances.attachDisk` | `compute.googleapis.com` | `--zone` `--disk` `--device-name` `--mode` |
| `gcloud compute ssh` | `compute.instances.get` `compute.instances.osLogin` | `compute.googleapis.com` | `--zone` `--internal-ip` `--tunnel-through-iap` `--plain` `--command` `--dry-run` |
| `gcloud compute scp` | `compute.instances.get` `compute.instances.osLogin` | `compute.googleapis.com` | `--zone` `--internal-ip` `--tunnel-through-iap` `--plain` `--recurse` |
| `gcloud compute project-info describe` | `compute.projects.get` | `compute.googleapis.com` | — |
| `gcloud compute project-info add-metadata` | `compute.projects.setCommonInstanceMetadata` | `compute.googleapis.com` | `--metadata` |
| `gcloud compute os-login ssh-keys add` | `compute.instances.osLogin` | `compute.googleapis.com` | `--key` `--ttl` |
| `gcloud compute zones list` | `compute.zones.list` | `compute.googleapis.com` | — |
| `gcloud compute regions list` | `compute.regions.list` | `compute.googleapis.com` | — |
| `gcloud compute machine-types list` | `compute.machineTypes.list` | `compute.googleapis.com` | `--zones` |
| `gcloud compute images list` | `compute.images.list` | `compute.googleapis.com` | — |
| `gcloud compute operations list` | `compute.zoneOperations.list` | `compute.googleapis.com` | — |
| `gcloud compute disks list` | `compute.disks.list` | `compute.googleapis.com` | — |
| `gcloud compute disks create` | `compute.disks.create` | `compute.googleapis.com` | `--zone` `--size` `--type` `--image-family` `--image-project` `--image` |
| `gcloud compute disks describe` | `compute.disks.get` | `compute.googleapis.com` | `--zone` |
| `gcloud compute disks snapshot` | `compute.disks.createSnapshot` | `compute.googleapis.com` | `--zone` `--snapshot-names` |
| `gcloud compute disks resize` | `compute.disks.update` | `compute.googleapis.com` | `--zone` `--size` |
| `gcloud compute snapshots create` | `compute.disks.createSnapshot` | `compute.googleapis.com` | `--source-disk` `--source-disk-zone` `--zone` |
| `gcloud compute snapshots list` | `compute.snapshots.list` | `compute.googleapis.com` | — |
| `gcloud compute snapshots describe` | `compute.snapshots.get` | `compute.googleapis.com` | — |
| `gcloud compute networks create` | `compute.networks.create` | `compute.googleapis.com` | `--subnet-mode` `--bgp-routing-mode` |
| `gcloud compute networks list` | `compute.networks.list` | `compute.googleapis.com` | — |
| `gcloud compute networks describe` | `compute.networks.get` | `compute.googleapis.com` | — |
| `gcloud compute networks delete` | `compute.networks.delete` | `compute.googleapis.com` | — |
| `gcloud compute networks subnets create` | `compute.subnetworks.create` | `compute.googleapis.com` | `--network` `--range` `--region` `--enable-private-ip-google-access` |
| `gcloud compute networks subnets list` | `compute.subnetworks.list` | `compute.googleapis.com` | — |
| `gcloud compute networks subnets describe` | `compute.subnetworks.get` | `compute.googleapis.com` | `--region` |
| `gcloud compute networks peerings create` | `compute.networks.addPeering` | `compute.googleapis.com` | `--network` `--peer-network` `--peer-project` `--export-custom-routes` `--import-custom-routes` |
| `gcloud compute firewall-rules create` | `compute.firewalls.create` | `compute.googleapis.com` | `--network` `--allow` `--action` `--rules` `--direction` `--priority` `--source-ranges` `--target-tags` `--destination-ranges` `--disabled` |
| `gcloud compute firewall-rules list` | `compute.firewalls.list` | `compute.googleapis.com` | — |
| `gcloud compute firewall-rules describe` | `compute.firewalls.get` | `compute.googleapis.com` | — |
| `gcloud compute firewall-rules delete` | `compute.firewalls.delete` | `compute.googleapis.com` | — |
| `gcloud compute addresses create` | `compute.addresses.create` | `compute.googleapis.com` | `--region` `--global` `--address-type` `--addresses` `--network-tier` |
| `gcloud compute addresses list` | `compute.addresses.list` | `compute.googleapis.com` | — |
| `gcloud compute addresses describe` | `compute.addresses.get` | `compute.googleapis.com` | `--region` `--global` |
| `gcloud compute routers create` | `compute.routers.create` | `compute.googleapis.com` | `--network` `--region` `--asn` |
| `gcloud compute routers list` | `compute.routers.list` | `compute.googleapis.com` | — |
| `gcloud compute routers describe` | `compute.routers.get` | `compute.googleapis.com` | `--region` |
| `gcloud compute health-checks create` | `compute.healthChecks.create` | `compute.googleapis.com` | `--tcp` `--http` `--https` `--port` `--global` |
| `gcloud compute health-checks list` | `compute.healthChecks.list` | `compute.googleapis.com` | — |
| `gcloud compute health-checks describe` | `compute.healthChecks.get` | `compute.googleapis.com` | `--global` |
| `gcloud compute backend-services create` | `compute.backendServices.create` | `compute.googleapis.com` | `--global` `--region` `--protocol` `--health-checks` `--load-balancing-scheme` `--timeout` |
| `gcloud compute backend-services list` | `compute.backendServices.list` | `compute.googleapis.com` | — |
| `gcloud compute backend-services describe` | `compute.backendServices.get` | `compute.googleapis.com` | `--global` `--region` |
| `gcloud compute forwarding-rules create` | `compute.forwardingRules.create` | `compute.googleapis.com` | `--global` `--region` `--backend-service` `--address` `--ports` `--load-balancing-scheme` |
| `gcloud compute forwarding-rules list` | `compute.forwardingRules.list` | `compute.googleapis.com` | — |
| `gcloud compute forwarding-rules describe` | `compute.forwardingRules.get` | `compute.googleapis.com` | `--global` `--region` |
| `gcloud compute instance-templates create` | `compute.instanceTemplates.create` | `compute.googleapis.com` | `--machine-type` `--image-family` `--image-project` `--network` `--subnet` `--tags` `--service-account` `--scopes` `--preemptible` `--provisioning-model` `--metadata` `--boot-disk-size` `--boot-disk-type` `--address` |
| `gcloud compute instance-templates list` | `compute.instanceTemplates.list` | `compute.googleapis.com` | — |
| `gcloud compute instance-templates describe` | `compute.instanceTemplates.get` | `compute.googleapis.com` | — |
| `gcloud compute instance-groups managed create` | `compute.instanceGroupManagers.create` | `compute.googleapis.com` | `--zone` `--region` `--template` `--size` `--base-instance-name` |
| `gcloud compute instance-groups managed list` | `compute.instanceGroupManagers.list` | `compute.googleapis.com` | — |
| `gcloud compute instance-groups managed describe` | `compute.instanceGroupManagers.get` | `compute.googleapis.com` | `--zone` `--region` |
| `gcloud compute instance-groups managed set-autoscaling` | `compute.autoscalers.create` | `compute.googleapis.com` | `--zone` `--region` `--max-num-replicas` `--min-num-replicas` `--target-cpu-utilization` `--cool-down-period` |

### `gcloud storage`

| コマンド | 必要な権限 | 必要な API | フラグ |
|---|---|---|---|
| `gcloud storage buckets create` | `storage.buckets.create` | — | `--location` `--default-storage-class` `--uniform-bucket-level-access` `--public-access-prevention` |
| `gcloud storage buckets list` | `storage.buckets.list` | — | — |
| `gcloud storage buckets describe` | `storage.buckets.get` | — | — |
| `gcloud storage buckets delete` | `storage.buckets.delete` | — | `--recursive` |
| `gcloud storage buckets get-iam-policy` | `storage.buckets.getIamPolicy` | — | — |
| `gcloud storage buckets add-iam-policy-binding` | `storage.buckets.setIamPolicy` | — | `--member` `--role` |
| `gcloud storage buckets remove-iam-policy-binding` | `storage.buckets.setIamPolicy` | — | `--member` `--role` |
| `gcloud storage ls` | `storage.objects.list` | — | `--long` `--recursive` |
| `gcloud storage cp` | `storage.objects.create` | — | `--recursive` |
| `gcloud storage rm` | `storage.objects.delete` | — | `--recursive` |
| `gcloud storage buckets update` | `storage.buckets.update` | — | `--versioning` `--lifecycle-file` `--default-storage-class` `--uniform-bucket-level-access` `--public-access-prevention` |
| `gcloud storage objects update` | `storage.objects.update` | — | `--storage-class` `--content-type` |
| `gcloud storage rsync` | `storage.objects.create` | — | `--recursive` `--delete-unmatched-destination-objects` |
| `gcloud storage sign-url` | `storage.objects.get` | — | `--duration` `--private-key-file` `--impersonate-service-account` |

### `gsutil`

| コマンド | 必要な権限 | 必要な API | フラグ |
|---|---|---|---|
| `gsutil mb` | `storage.buckets.create` | — | `--l` `--c` `--b` `--public-access-prevention` |
| `gsutil ls` | `storage.objects.list` | — | `--long` `--recursive` |
| `gsutil cp` | `storage.objects.create` | — | `--recursive` `--m` |
| `gsutil rm` | `storage.objects.delete` | — | `--recursive` `--m` |
| `gsutil iam get` | `storage.buckets.getIamPolicy` | — | — |
| `gsutil iam ch` | `storage.buckets.setIamPolicy` | — | `--d` |
| `gsutil rsync` | `storage.objects.create` | — | `--recursive` `--d` `--m` |
| `gsutil lifecycle set` | `storage.buckets.update` | — | — |
| `gsutil versioning set` | `storage.buckets.update` | — | — |
| `gsutil acl ch` | `storage.buckets.update` | — | `--u` `--g` |

### `gcloud iam`

| コマンド | 必要な権限 | 必要な API | フラグ |
|---|---|---|---|
| `gcloud iam service-accounts create` | `iam.serviceAccounts.create` | — | `--display-name` `--description` |
| `gcloud iam service-accounts list` | `iam.serviceAccounts.list` | — | — |
| `gcloud iam service-accounts describe` | `iam.serviceAccounts.get` | — | — |
| `gcloud iam service-accounts delete` | `iam.serviceAccounts.delete` | — | — |
| `gcloud iam roles list` | — | — | `--show-deleted` |
| `gcloud iam roles describe` | — | — | — |
| `gcloud iam roles create` | `iam.roles.create` | — | `--permissions` `--title` `--description` `--stage` |
| `gcloud iam roles copy` | `iam.roles.create` | — | `--source` `--destination` `--dest-project` |
| `gcloud iam service-accounts keys create` | `iam.serviceAccountKeys.create` | — | `--iam-account` `--key-file-type` |
| `gcloud iam service-accounts keys list` | `iam.serviceAccountKeys.list` | — | `--iam-account` |
| `gcloud iam service-accounts get-iam-policy` | `iam.serviceAccounts.getIamPolicy` | — | — |
| `gcloud iam service-accounts add-iam-policy-binding` | `iam.serviceAccounts.setIamPolicy` | — | `--member` `--role` |
| `gcloud iam service-accounts remove-iam-policy-binding` | `iam.serviceAccounts.setIamPolicy` | — | `--member` `--role` |

### `gcloud container`

| コマンド | 必要な権限 | 必要な API | フラグ |
|---|---|---|---|
| `gcloud container clusters create` | `container.clusters.create` | `container.googleapis.com` | `--zone` `--region` `--num-nodes` `--machine-type` `--release-channel` `--enable-network-policy` `--enable-private-nodes` `--enable-private-endpoint` `--master-ipv4-cidr` `--network` `--subnetwork` `--enable-master-authorized-networks` `--master-authorized-networks` `--enable-authorized-networks-on-private-endpoint` `--enable-ip-alias`  `--node-locations` `--workload-pool` `--enable-vertical-pod-autoscaling` |
| `gcloud container clusters create-auto` | `container.clusters.create` | `container.googleapis.com` | `--region` `--release-channel` `--enable-private-nodes` `--enable-private-endpoint` `--master-ipv4-cidr` `--network` `--subnetwork` `--enable-master-authorized-networks` `--master-authorized-networks` `--enable-authorized-networks-on-private-endpoint` |
| `gcloud container clusters list` | `container.clusters.list` | `container.googleapis.com` | — |
| `gcloud container clusters describe` | `container.clusters.get` | `container.googleapis.com` | `--zone` `--region` |
| `gcloud container clusters update` | `container.clusters.update` | `container.googleapis.com` | `--zone` `--region` `--enable-private-endpoint` `--enable-master-authorized-networks` `--master-authorized-networks` `--enable-authorized-networks-on-private-endpoint`  `--workload-pool` `--enable-vertical-pod-autoscaling` |
| `gcloud container clusters delete` | `container.clusters.delete` | `container.googleapis.com` | `--zone` `--region` `--async` |
| `gcloud container clusters get-credentials` | `container.clusters.get` `container.clusters.getCredentials` | `container.googleapis.com` | `--zone` `--region` `--internal-ip` |
| `gcloud container clusters resize` | `container.clusters.update` | `container.googleapis.com` | `--zone` `--region` `--num-nodes` `--node-pool` |
| `gcloud container clusters upgrade` | `container.clusters.update` | `container.googleapis.com` | `--zone` `--region` `--master` `--node-pool` `--cluster-version` |
| `gcloud container node-pools create` | `container.clusters.update` | `container.googleapis.com` | `--zone` `--region` `--cluster` `--machine-type` `--num-nodes` `--disk-size` `--enable-autoscaling` `--min-nodes` `--max-nodes` `--enable-autorepair` `--enable-autoupgrade`  `--workload-metadata=GCE_METADATA\|GKE_METADATA` |
| `gcloud container node-pools list` | `container.clusters.get` | `container.googleapis.com` | `--zone` `--region` `--cluster` |
| `gcloud container node-pools describe` | `container.clusters.get` | `container.googleapis.com` | `--zone` `--region` `--cluster` |
| `gcloud container node-pools update` | `container.clusters.update` | `container.googleapis.com` | `--zone` `--region` `--cluster` `--enable-autoscaling` `--min-nodes` `--max-nodes` `--enable-autorepair` `--enable-autoupgrade`  `--workload-metadata=GCE_METADATA\|GKE_METADATA` |
| `gcloud container node-pools delete` | `container.clusters.update` | `container.googleapis.com` | `--zone` `--region` `--cluster` |
| `sim gke autoscale-nodes` | `container.clusters.update` | `container.googleapis.com` | `--zone` `--region` `--cluster` `--required-nodes` |
| `sim gke check-control-plane` | `container.clusters.get` | `container.googleapis.com` | `--zone` `--region` `--endpoint` `--source-ip` `--source-network` |

### `kubectl`

StatefulSetは`sts/statefulset/statefulsets.apps`のget/describe/delete、仮想manifestのcreate/apply/deleteとscaleに対応します。対象の`container.statefulSets.get/list/create/update/delete`を要求し、Pod操作はpodsの権限を使います。`get all`はStatefulSetのlist権限も必要です。`sim files load kubernetes-statefulset`で教材を読めます。`sim kubernetes write-file pod/NAME`は指定PodのPVCへ書き込みます。Parallel、Retain、単一image/PVCマウントに限定し、詳しい再現範囲は[KUBERNETES.md](KUBERNETES.md)を参照してください。

HPAは`autoscale`またはautoscaling/v2の仮想YAML/JSONで作成し、`get/describe/delete hpa`で確認・削除できます。HPAファイルの`create/apply/delete -f`にも対応し、applyは目標値・レプリカ範囲・対象を置き換えます。`get all`はHPAのlist権限も要求します。CPU使用量は`sim kubernetes reconcile NAME --cpu=250m`で1 Podあたりの値を明示し、1回だけ評価します（実測や定期実行はありません）。


| コマンド | 必要な権限 | 必要な API | フラグ |
|---|---|---|---|
| `kubectl create configmap` | `container.configMaps.create` | `container.googleapis.com` | `--from-literal`（繰り返し可） `--namespace` |
| `kubectl create secret generic` | `container.secrets.create` | `container.googleapis.com` | `--from-literal`（繰り返し可） `--namespace` |
| `kubectl label` | ConfigMap/Secretのgetとupdate | `container.googleapis.com` | `--overwrite` `--namespace`（1リソースのKEY=VALUE / KEY-） |
| `kubectl set env` | 更新: `container.deployments.update`、一覧: `container.deployments.get`、取込元のgetも必要 | `container.googleapis.com` | `--from` `--keys` `--prefix` `--list` `--namespace`  `--containers` |
| `kubectl exec` | `container.pods.exec` | `container.googleapis.com` | `--namespace`（printenv/envのみ）  `--container/-c` |
| `kubectl get` | Deployment/StatefulSet/Service/ConfigMap/Secret/HPA/NetworkPolicy/Ingress: 対象のget/list、その他: `container.pods.list` | `container.googleapis.com` | `--output` `--selector` (`-l`) `--namespace` |
| `kubectl apply` | 仮想ファイル: 対象のgetとcreate/update、固定教材: `container.deployments.update` | `container.googleapis.com` | `--filename` `--namespace` |
| `kubectl create` | 仮想ファイル: 対象のcreate、Deployment/固定教材: `container.deployments.create` | `container.googleapis.com` | `--filename` `--image` `--replicas` `--namespace` |
| `kubectl delete` | Deployment/StatefulSet/Service/ConfigMap/Secret/HPA/NetworkPolicy/Ingress: 対象のdelete、その他・固定教材: `container.deployments.delete` | `container.googleapis.com` | `--filename` `--namespace` |
| `kubectl describe` | Deployment/StatefulSet/Service/ConfigMap/Secret/HPA/NetworkPolicy/Ingress: 対象のget/list、その他: `container.pods.get` | `container.googleapis.com` | `--namespace` |
| `kubectl expose` | `container.services.create` | `container.googleapis.com` | `--type` `--port` `--target-port` `--name` `--namespace` |
| `kubectl autoscale` | `container.horizontalPodAutoscalers.create`、`container.deployments.get` | `container.googleapis.com` | `--min` `--max` `--cpu-percent` `--name` `--namespace` |
| `kubectl create serviceaccount` | `container.serviceAccounts.create` | `container.googleapis.com` | `--namespace/-n` |
| `kubectl annotate` | `container.serviceAccounts.update` + `container.serviceAccounts.get` | `container.googleapis.com` | `--namespace/-n`, `--overwrite`（Workload Identity annotationのみ） |
| `sim kubernetes check-access` | `container.deployments.get` | `container.googleapis.com`（連携先はIAM Credentials APIも有効化） | `--bucket`, `--permission`（必須）, `--node-pool`, `--namespace/-n` |
| `sim kubernetes recommend-vpa` | `container.thirdPartyObjects.update` + `container.deployments.get` | `container.googleapis.com` | `--cpu`, `--memory`（必須）, `--namespace/-n` |
| `sim kubernetes admit-autopilot` | `container.deployments.update` | `container.googleapis.com` | `--namespace/-n`（単一コンテナの明示教材評価） |
| `sim kubernetes probe` | `container.deployments.update` | `container.googleapis.com` | `--status-code`（必須）、`--pod`（省略時は対象Deploymentの全Pod）、`--kind=readiness|liveness|startup`（既定readiness）  `--container/-c` |
| `sim kubernetes write-file` | 対象の`container.deployments.get` / `container.statefulSets.get` + `container.pods.exec` | `container.googleapis.com` | `--namespace/-n`, `--path`, `--content` |
| `sim kubernetes connect` | `container.deployments.get` + `container.pods.exec` + `container.networkPolicies.list` | `container.googleapis.com` | `--to`, `--port`（両方必須）、`--namespace/-n`（送信元）、`--to-namespace`（省略時は送信元と同じ） |
| `sim kubernetes request` | `container.ingresses.get` + `container.services.get` + `container.deployments.list` + `container.pods.list` | `container.googleapis.com` | `--host`（必須）、`--path`（既定/）、`--namespace/-n` |
| `sim kubernetes reconcile` | `container.horizontalPodAutoscalers.update`、`container.deployments.update` | `container.googleapis.com` | `--cpu`（1 Podあたりの教材用使用量） |
| `kubectl scale` | 対象の`container.deployments.update` / `container.statefulSets.update` | `container.googleapis.com` | `--replicas` `--namespace` |
| `kubectl set resources` | `container.deployments.update` | `container.googleapis.com` | `--requests` `--limits` `--containers` (`-c`) `--namespace` |
| `kubectl set image` | `container.deployments.update` | `container.googleapis.com` | `--namespace` |
| `kubectl rollout status` | `container.deployments.get` | `container.googleapis.com` | `--namespace` |
| `kubectl rollout history` | `container.deployments.get` | `container.googleapis.com` | `--revision` `--namespace` |
| `kubectl rollout restart` | `container.deployments.update` | `container.googleapis.com` | `--namespace` |
| `kubectl rollout undo` | `container.deployments.update` | `container.googleapis.com` | `--to-revision` `--namespace` |
| `kubectl logs` | `container.pods.get` | `container.googleapis.com` | `--follow` `--namespace`  `--container/-c` |
| `kubectl config` | `container.clusters.get` | `container.googleapis.com` | `--current` `--namespace`（set-contextのみ） |

### `gcloud run`

| コマンド | 必要な権限 | 必要な API | フラグ |
|---|---|---|---|
| `gcloud run deploy` | `run.services.create` | `run.googleapis.com` | `--image` `--region` `--platform` `--allow-unauthenticated` |
| `gcloud run services list` | `run.services.list` | `run.googleapis.com` | `--region` `--platform` |
| `gcloud run services describe` | `run.services.get` | `run.googleapis.com` | `--region` `--platform` |
| `gcloud run services delete` | `run.services.delete` | `run.googleapis.com` | `--region` `--platform` |

### `gcloud functions`

| コマンド | 必要な権限 | 必要な API | フラグ |
|---|---|---|---|
| `gcloud functions deploy` | `cloudfunctions.functions.create` | `cloudfunctions.googleapis.com` | `--region` `--runtime` `--trigger-http` `--trigger-topic` `--entry-point` `--memory` `--allow-unauthenticated` `--gen2` `--source` |
| `gcloud functions list` | `cloudfunctions.functions.list` | `cloudfunctions.googleapis.com` | `--regions` |
| `gcloud functions describe` | `cloudfunctions.functions.get` | `cloudfunctions.googleapis.com` | `--region` |
| `gcloud functions delete` | `cloudfunctions.functions.delete` | `cloudfunctions.googleapis.com` | `--region` |
| `gcloud functions call` | `cloudfunctions.functions.call` | `cloudfunctions.googleapis.com` | `--region` `--data` |

### `gcloud app`

| コマンド | 必要な権限 | 必要な API | フラグ |
|---|---|---|---|
| `gcloud app deploy` | `appengine.applications.create` `appengine.versions.create` | `appengine.googleapis.com` | `--region` `--version` `--promote` |
| `gcloud app browse` | `appengine.applications.get` | `appengine.googleapis.com` | `--service` |
| `gcloud app describe` | `appengine.applications.get` | `appengine.googleapis.com` | — |
| `gcloud app versions list` | `appengine.versions.list` | `appengine.googleapis.com` | `--service` |
| `gcloud app services set-traffic` | `appengine.services.update` | `appengine.googleapis.com` | `--splits` `--split-by` |

### `gcloud sql`

| コマンド | 必要な権限 | 必要な API | フラグ |
|---|---|---|---|
| `gcloud sql instances create` | `cloudsql.instances.create` | `sqladmin.googleapis.com` | `--database-version` `--tier` `--region` `--root-password` `--storage-size` `--availability-type` |
| `gcloud sql instances list` | `cloudsql.instances.list` | `sqladmin.googleapis.com` | — |
| `gcloud sql instances describe` | `cloudsql.instances.get` | `sqladmin.googleapis.com` | — |
| `gcloud sql instances delete` | `cloudsql.instances.delete` | `sqladmin.googleapis.com` | — |
| `gcloud sql backups create` | `cloudsql.backupRuns.create` | `sqladmin.googleapis.com` | `--instance` `--description` `--async` |
| `gcloud sql backups list` | `cloudsql.instances.get` | `sqladmin.googleapis.com` | `--instance` |

### `gcloud pubsub`

| コマンド | 必要な権限 | 必要な API | フラグ |
|---|---|---|---|
| `gcloud pubsub topics create` | `pubsub.topics.create` | `pubsub.googleapis.com` | — |
| `gcloud pubsub topics list` | `pubsub.topics.list` | `pubsub.googleapis.com` | — |
| `gcloud pubsub topics describe` | `pubsub.topics.get` | `pubsub.googleapis.com` | — |
| `gcloud pubsub subscriptions create` | `pubsub.subscriptions.create` | `pubsub.googleapis.com` | `--topic` `--ack-deadline` `--push-endpoint` |
| `gcloud pubsub subscriptions list` | `pubsub.topics.list` | `pubsub.googleapis.com` | — |
| `gcloud pubsub subscriptions describe` | `pubsub.subscriptions.get` | `pubsub.googleapis.com` | — |

### `gcloud logging`

| コマンド | 必要な権限 | 必要な API | フラグ |
|---|---|---|---|
| `gcloud logging read` | `logging.logEntries.list` | `logging.googleapis.com` | `--freshness` `--order` |
| `gcloud logging logs list` | `logging.logs.list` | `logging.googleapis.com` | — |
| `gcloud logging sinks create` | `logging.sinks.create` | `logging.googleapis.com` | `--log-filter` |
| `gcloud logging sinks list` | `logging.sinks.list` | `logging.googleapis.com` | — |
| `gcloud logging sinks describe` | `logging.sinks.get` | `logging.googleapis.com` | — |
| `gcloud logging metrics create` | `logging.logMetrics.create` | `logging.googleapis.com` | `--log-filter` `--description` |
| `gcloud logging metrics update` | `logging.logMetrics.update` | `logging.googleapis.com` | `--log-filter` `--description` |
| `gcloud logging metrics delete` | `logging.logMetrics.delete` | `logging.googleapis.com` | — |
| `gcloud logging metrics describe` | `logging.logMetrics.get` | `logging.googleapis.com` | — |
| `gcloud logging metrics list` | `logging.logMetrics.list` | `logging.googleapis.com` | — |
| `gcloud logging sinks update` | `logging.sinks.update` | `logging.googleapis.com` | `--log-filter` |
| `gcloud logging sinks delete` | `logging.sinks.delete` | `logging.googleapis.com` | — |

### `gcloud monitoring`

| コマンド | 必要な権限 | 必要な API | フラグ |
|---|---|---|---|
| `gcloud monitoring dashboards list` | `monitoring.dashboards.list` | `monitoring.googleapis.com` | — |
| `gcloud monitoring policies list` | `monitoring.alertPolicies.list` | `monitoring.googleapis.com` | — |
| `gcloud monitoring dashboards create` | `monitoring.dashboards.create` | `monitoring.googleapis.com` | `--config` `--config-from-file` `--validate-only` |
| `gcloud monitoring dashboards describe` | `monitoring.dashboards.get` | `monitoring.googleapis.com` | — |
| `gcloud monitoring dashboards delete` | `monitoring.dashboards.delete` | `monitoring.googleapis.com` | — |
| `gcloud monitoring policies create` | `monitoring.alertPolicies.create` | `monitoring.googleapis.com` | `--display-name` `--condition-display-name` `--condition-filter` `--if` `--duration` `--combiner` `--enabled` |
| `gcloud monitoring policies describe` | `monitoring.alertPolicies.get` | `monitoring.googleapis.com` | — |
| `gcloud monitoring policies delete` | `monitoring.alertPolicies.delete` | `monitoring.googleapis.com` | — |
| `gcloud monitoring uptime create` | `monitoring.uptimeCheckConfigs.create` | `monitoring.googleapis.com` | `--resource-type` `--resource-labels` `--protocol` `--path` `--port` `--period` `--timeout` |
| `gcloud monitoring uptime describe` | `monitoring.uptimeCheckConfigs.get` | `monitoring.googleapis.com` | — |
| `gcloud monitoring uptime delete` | `monitoring.uptimeCheckConfigs.delete` | `monitoring.googleapis.com` | — |
| `gcloud monitoring uptime list` | `monitoring.uptimeCheckConfigs.list` | `monitoring.googleapis.com` | — |

### `gcloud kms`

| コマンド | 必要な権限 | 必要な API | フラグ |
|---|---|---|---|
| `gcloud kms keyrings create` | `cloudkms.keyRings.create` | `cloudkms.googleapis.com` | `--location` |
| `gcloud kms keyrings list` | `cloudkms.keyRings.list` | `cloudkms.googleapis.com` | `--location` |
| `gcloud kms keyrings describe` | `cloudkms.keyRings.get` | `cloudkms.googleapis.com` | `--location` |

### `gcloud dns`

| コマンド | 必要な権限 | 必要な API | フラグ |
|---|---|---|---|
| `gcloud dns managed-zones create` | `dns.managedZones.create` | `dns.googleapis.com` | `--dns-name` `--description` `--visibility` |
| `gcloud dns managed-zones list` | `dns.managedZones.list` | `dns.googleapis.com` | — |
| `gcloud dns managed-zones describe` | `dns.managedZones.get` | `dns.googleapis.com` | — |

### `gcloud deployment-manager`

| コマンド | 必要な権限 | 必要な API | フラグ |
|---|---|---|---|
| `gcloud deployment-manager deployments create` | `deploymentmanager.deployments.create` | `deploymentmanager.googleapis.com` | `--config` `--preview` |
| `gcloud deployment-manager deployments list` | `deploymentmanager.deployments.list` | `deploymentmanager.googleapis.com` | — |
| `gcloud deployment-manager deployments describe` | `deploymentmanager.deployments.get` | `deploymentmanager.googleapis.com` | — |

## 解決はできるが未実装（0）

設計書 3.1 の範囲はすべて実装済み。次に足すコマンドは、実装するまで `src/engine/commands/not-implemented/` に並べると、打ったときに E-002（`gcloud-sim: command not implemented yet`）になる。

## サンプルファイル

gcloud-simはホストのファイルを読みません。TerraformとConfigMap/Secret/Deployment/Service/HPAは `sim files` で編集できる仮想ファイルを読みます。`sim files load kubernetes-config` 、`sim files load kubernetes-workload` 、`sim files load kubernetes-labels` 、`sim files load kubernetes-resources` 、`sim files load kubernetes-hpa` 、`sim files load kubernetes-readiness` 、`sim files load kubernetes-liveness` または `sim files load kubernetes-startup` でYAML教材を読み込み、`kubectl create/apply/delete -f FILE` で操作できます（詳細は [KUBERNETES.md](KUBERNETES.md)）。Kubernetesのファイルは正規化した相対パスで一致し、同名の仮想ファイルが固定教材より優先します。仮想ファイルがない場合の `deployment.yaml` / `service.yaml` と、他サービスの次の操作は固定サンプルを使います（kubectl以外はディレクトリ部分を無視）。無い名前は本物と同じ `No such file or directory`（E-005）になる。`gcloud storage cp ./x gs://b` のように名前しか使わない経路は任意のパスを受ける。

| ファイル | 受けるコマンド | 中身 |
|---|---|---|
| `app.yaml` | `gcloud app deploy` | `runtime: python312` / `service: default` |
| `deployment.yaml` | `kubectl apply -f` / `kubectl delete -f` | Deployment `web`（image `nginx:1.27`、replicas 2） |
| `service.yaml` | `kubectl apply -f` / `kubectl delete -f` | Service `web`（type LoadBalancer、port 80 → 80、selector app=web） |
| `config.yaml` | `gcloud deployment-manager deployments create --config` | `compute.v1.instance` の `dm-vm`（asia-northeast1-a） |
| `lifecycle.json` | `gsutil lifecycle set` / `gcloud storage buckets update --lifecycle-file` | 365 日で Delete |
| `lifecycle-nearline.json` | 同上 | 30 日で SetStorageClass NEARLINE |
| `key.json` | `gcloud auth activate-service-account --key-file` | `web-sa@ace-dev-01.iam.gserviceaccount.com` の鍵。`keys create OUTPUT` で書き出した名前も使える |


## 監視・ログ演習の再現範囲

- `logging read 'LOG_FILTER'` は比較、AND/OR/NOT、括弧を解釈し、severityの順序も考慮する。`--order=asc|desc` に対応。ログはCompute操作履歴由来の管理アクティビティのみ。実クラウドから収集しない。フルLoggingクエリ言語（関数や正規表現等）は未対応でエラー。
- `logging metrics` はカウンタ指標の設定。時系列の取り込み・遡及集計はしない。`sinks update/delete` は転送設定の変更で、実際の配送はしない。
- `monitoring dashboards create` はJSONの `gridLayout`（columns=1、xyChart 1つ、timeSeriesFilter 1つ）のみ。未対応フィールド/レイアウトを黙って捨てずエラーにする。`--validate-only` は保存しない。
- `monitoring policies create` は1つのしきい値条件（`--if='> 0.8'` / `'< 1'`、`--duration=300s`、OR）。通知先・複数条件・欠測/PromQL・インシデント評価は未対応。
- `monitoring uptime create` はpublic URLのHTTP/HTTPS設定。periodは分（1/5/10/15）、timeoutは秒（1〜60）。外部URLへアクセスせず、稼働状況の値は生成しない。
- 上記設定はリソースツリーとプロパティ、一覧/describe、JSON保存/復元に反映する。Snapshot v8（監視リソースはv3、Terraformはv4で追加）。v1/v2は監視集合、v1/v2/v3は空のTerraform状態を補完し、v4/v5のTerraform状態はlocal backendとplanのbackendRevision（v4はmoved情報も）を補って保持する。
- 新ミッション5本はログ指標、uptime、CPUダッシュボード、CPUアラート、sinkと転送先IAM。残る資料対応は [ACE_COVERAGE.md](ACE_COVERAGE.md)。

### 組み込み cpu-dashboard.json

`gcloud monitoring dashboards create --config-from-file=cpu-dashboard.json` が読む学習用サンプル。任意のローカルファイルを読む機能ではない。次のJSONを `--config` に渡しても同じ設定になる。

```json
{
  "displayName": "VM CPU",
  "gridLayout": {
    "columns": 1,
    "widgets": [{
      "title": "CPU utilization",
      "xyChart": {
        "dataSets": [{
          "timeSeriesQuery": {
            "timeSeriesFilter": {
              "filter": "metric.type=\"compute.googleapis.com/instance/cpu/utilization\" AND resource.type=\"gce_instance\""
            }
          }
        }]
      }
    }]
  }
}
```

構文確認に使用した公式資料:
- https://docs.cloud.google.com/sdk/gcloud/reference/monitoring/dashboards/create
- https://docs.cloud.google.com/sdk/gcloud/reference/monitoring/policies/create
- https://docs.cloud.google.com/sdk/gcloud/reference/monitoring/uptime/create
- https://docs.cloud.google.com/sdk/gcloud/reference/logging/metrics/create

PodのQoSは`kubectl get pods -o json` / `-o yaml` / `kubectl describe pods`の`status.qosClass`で確認できます。CPU・メモリのrequests/limitsから導出する読み取り専用の分類です。`status`はオブジェクト、一覧表示用の状態文字列は`displayStatus`です（詳細は[KUBERNETES.md](KUBERNETES.md)）。

`sim kubernetes probe NAME --status-code=200`はHTTP readiness応答を1回評価します。設定はDeployment manifestのreadinessProbeで管理し、READY・Service接続先・rollout status・HPA評価に反映します。`--kind=liveness`はliveness応答を評価し、連続失敗が閾値に達したPodのコンテナだけを即時再起動します。Pod名/IP/revisionは維持し、RESTARTSが増加、startup/readinessは未評価へ戻ります。`--kind=startup`は起動を1回確認し、成功するまでreadiness/livenessを待機させます。成功済みのstartupは再起動まで評価を拒否します。実通信・定期実行・経過時間・backoffは再現しません。
