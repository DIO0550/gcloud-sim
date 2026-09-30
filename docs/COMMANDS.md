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
  `--quiet`/`-q` `--help`/`-h` `--verbosity` はすべてのコマンドが受ける
- `--format` は `json` / `yaml` / `value(FIELDS)` / `table(FIELDS)` / `none`、`--filter` は
  `key=value` / `key!=value` / `key:substring` / `NOT` / `AND` / `OR` の簡易版（DJ-009）
- `gcloud beta` / `gcloud alpha` は警告を出して `gcloud` と同じに扱う
- `delete` などの破壊的操作は `--quiet` が無ければ `Do you want to continue (Y/n)?` を挟む

この表は `src/engine/commands/` の登録簿から作っている。登録簿と食い違うと
`src/engine/__tests__/commands-doc.test.ts` が落ちる。

## 実装済み（97）

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
| `gcloud auth login` | — | — | `--brief` `--no-launch-browser` |
| `gcloud auth list` | — | — | — |
| `gcloud auth revoke` | — | — | — |

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
| `gcloud compute zones list` | `compute.zones.list` | `compute.googleapis.com` | — |
| `gcloud compute regions list` | `compute.regions.list` | `compute.googleapis.com` | — |
| `gcloud compute machine-types list` | `compute.machineTypes.list` | `compute.googleapis.com` | `--zones` |
| `gcloud compute images list` | `compute.images.list` | `compute.googleapis.com` | — |
| `gcloud compute disks list` | `compute.disks.list` | `compute.googleapis.com` | — |
| `gcloud compute snapshots create` | `compute.disks.createSnapshot` | `compute.googleapis.com` | `--source-disk` `--source-disk-zone` `--zone` |
| `gcloud compute snapshots list` | `compute.snapshots.list` | `compute.googleapis.com` | — |
| `gcloud compute networks create` | `compute.networks.create` | `compute.googleapis.com` | `--subnet-mode` `--bgp-routing-mode` |
| `gcloud compute networks list` | `compute.networks.list` | `compute.googleapis.com` | — |
| `gcloud compute networks describe` | `compute.networks.get` | `compute.googleapis.com` | — |
| `gcloud compute networks delete` | `compute.networks.delete` | `compute.googleapis.com` | — |
| `gcloud compute networks subnets create` | `compute.subnetworks.create` | `compute.googleapis.com` | `--network` `--range` `--region` `--enable-private-ip-google-access` |
| `gcloud compute networks subnets list` | `compute.subnetworks.list` | `compute.googleapis.com` | — |
| `gcloud compute firewall-rules create` | `compute.firewalls.create` | `compute.googleapis.com` | `--network` `--allow` `--action` `--rules` `--direction` `--priority` `--source-ranges` `--target-tags` `--destination-ranges` `--disabled` |
| `gcloud compute firewall-rules list` | `compute.firewalls.list` | `compute.googleapis.com` | — |
| `gcloud compute firewall-rules describe` | `compute.firewalls.get` | `compute.googleapis.com` | — |
| `gcloud compute firewall-rules delete` | `compute.firewalls.delete` | `compute.googleapis.com` | — |
| `gcloud compute operations list` | `compute.zoneOperations.list` | `compute.googleapis.com` | — |

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

### `gsutil`

| コマンド | 必要な権限 | 必要な API | フラグ |
|---|---|---|---|
| `gsutil mb` | `storage.buckets.create` | — | `--l` `--c` `--b` `--public-access-prevention` |
| `gsutil ls` | `storage.objects.list` | — | `--long` `--recursive` |
| `gsutil cp` | `storage.objects.create` | — | `--recursive` `--m` |
| `gsutil rm` | `storage.objects.delete` | — | `--recursive` `--m` |
| `gsutil iam get` | `storage.buckets.getIamPolicy` | — | — |

### `gcloud iam`

| コマンド | 必要な権限 | 必要な API | フラグ |
|---|---|---|---|
| `gcloud iam service-accounts create` | `iam.serviceAccounts.create` | — | `--display-name` `--description` |
| `gcloud iam service-accounts list` | `iam.serviceAccounts.list` | — | — |
| `gcloud iam service-accounts describe` | `iam.serviceAccounts.get` | — | — |
| `gcloud iam service-accounts delete` | `iam.serviceAccounts.delete` | — | — |
| `gcloud iam roles list` | — | — | — |
| `gcloud iam roles describe` | — | — | — |

### `gcloud container`

| コマンド | 必要な権限 | 必要な API | フラグ |
|---|---|---|---|
| `gcloud container clusters create` | `container.clusters.create` | `container.googleapis.com` | `--zone` `--region` `--num-nodes` `--machine-type` `--release-channel` |
| `gcloud container clusters create-auto` | `container.clusters.create` | `container.googleapis.com` | `--zone` `--region` `--release-channel` |
| `gcloud container clusters list` | `container.clusters.list` | `container.googleapis.com` | — |
| `gcloud container clusters describe` | `container.clusters.get` | `container.googleapis.com` | `--zone` `--region` |
| `gcloud container clusters delete` | `container.clusters.delete` | `container.googleapis.com` | `--zone` `--region` `--async` |
| `gcloud container clusters get-credentials` | `container.clusters.get` `container.clusters.getCredentials` | `container.googleapis.com` | `--zone` `--region` `--internal-ip` |

### `gcloud run`

| コマンド | 必要な権限 | 必要な API | フラグ |
|---|---|---|---|
| `gcloud run deploy` | `run.services.create` | `run.googleapis.com` | `--image` `--region` `--platform` `--allow-unauthenticated` |
| `gcloud run services list` | `run.services.list` | `run.googleapis.com` | `--region` `--platform` |
| `gcloud run services describe` | `run.services.get` | `run.googleapis.com` | `--region` `--platform` |
| `gcloud run services delete` | `run.services.delete` | `run.googleapis.com` | `--region` `--platform` |

## 解決はできるが未実装（81）

Phase 1 のスコープ外。打つと E-002 になる。kubectl は TBD-007（GKE の `get-credentials` までを再現）。

| コマンド | 概要 |
|---|---|
| `gcloud compute ssh` | SSH into a virtual machine instance. |
| `gcloud compute scp` | Copy files to and from Google Compute Engine virtual machines via scp. |
| `gcloud compute instances add-tags` | Add tags to Compute Engine virtual machine instances. |
| `gcloud compute instances set-machine-type` | Set machine type for Compute Engine virtual machines. |
| `gcloud compute instances add-metadata` | Add or update instance metadata. |
| `gcloud compute instances attach-disk` | Attach a disk to an instance. |
| `gcloud compute instance-templates create` | Create a Compute Engine virtual machine instance template. |
| `gcloud compute instance-templates list` | List Compute Engine virtual machine instance templates. |
| `gcloud compute instance-groups managed create` | Create a Compute Engine managed instance group. |
| `gcloud compute instance-groups managed list` | List Compute Engine managed instance groups. |
| `gcloud compute instance-groups managed set-autoscaling` | Set autoscaling parameters of a managed instance group. |
| `gcloud compute disks create` | Create Compute Engine persistent disks. |
| `gcloud compute disks snapshot` | Create snapshots of Compute Engine persistent disks. |
| `gcloud compute disks resize` | Resize a disk or disks. |
| `gcloud compute addresses create` | Reserve IP addresses. |
| `gcloud compute addresses list` | List addresses. |
| `gcloud compute routers create` | Create a Compute Engine router. |
| `gcloud compute networks peerings create` | Create a Compute Engine network peering. |
| `gcloud compute project-info describe` | Describe the Compute Engine project resource. |
| `gcloud compute project-info add-metadata` | Add or update project-wide metadata. |
| `gcloud compute os-login ssh-keys add` | Add an SSH public key to an OS Login profile. |
| `gcloud compute health-checks create` | Create a health check. |
| `gcloud compute backend-services create` | Create a backend service. |
| `gcloud compute forwarding-rules create` | Create a forwarding rule. |
| `gcloud container clusters resize` | Resizes an existing cluster for running containers. |
| `gcloud container clusters upgrade` | Upgrade the Kubernetes version of an existing container cluster. |
| `gcloud container node-pools create` | Create a node pool in a running cluster. |
| `gcloud container node-pools list` | List node pools in a running cluster. |
| `gcloud functions deploy` | Create or update a Google Cloud Function. |
| `gcloud functions list` | List Google Cloud Functions. |
| `gcloud functions delete` | Delete a Google Cloud Function. |
| `gcloud functions call` | Trigger execution of a Google Cloud Function. |
| `gcloud app deploy` | Deploy the local code and/or configuration of your app to App Engine. |
| `gcloud app browse` | Open the current app in a web browser. |
| `gcloud app versions list` | List the versions of all services in the App Engine server. |
| `gcloud app services set-traffic` | Set traffic splitting settings. |
| `gcloud sql instances create` | Create a new Cloud SQL instance. |
| `gcloud sql instances list` | List Cloud SQL instances in a given project. |
| `gcloud sql instances delete` | Delete a Cloud SQL instance. |
| `gcloud sql backups create` | Create a backup of a Cloud SQL instance. |
| `gcloud pubsub topics create` | Create one or more Cloud Pub/Sub topics. |
| `gcloud pubsub topics list` | List Cloud Pub/Sub topics. |
| `gcloud pubsub subscriptions create` | Create one or more Cloud Pub/Sub subscriptions. |
| `gcloud logging read` | Read log entries. |
| `gcloud logging logs list` | List logs in a project. |
| `gcloud logging sinks create` | Create a log sink. |
| `gcloud monitoring dashboards list` | List Monitoring dashboards. |
| `gcloud monitoring policies list` | List alert policies. |
| `gcloud iam roles create` | Create a custom role for a project or an organization. |
| `gcloud iam roles copy` | Create a role from an existing role. |
| `gcloud iam service-accounts keys create` | Create a private key for a service account. |
| `gcloud iam service-accounts add-iam-policy-binding` | Add an IAM policy binding to a service account. |
| `gcloud kms keyrings create` | Create a new keyring. |
| `gcloud dns managed-zones create` | Create a Cloud DNS managed-zone. |
| `gcloud deployment-manager deployments create` | Create a deployment. |
| `gcloud storage buckets update` | Update Cloud Storage buckets (lifecycle, versioning, ...). |
| `gcloud storage objects update` | Update Cloud Storage objects. |
| `gcloud storage rsync` | Synchronize content of two buckets/directories. |
| `gcloud storage sign-url` | Generate a URL with embedded authentication. |
| `gcloud components install` | Install specified components. |
| `gcloud components update` | Update all of your installed components. |
| `gcloud init` | Initialize or reinitialize gcloud. |
| `gcloud info` | Display information about the current gcloud environment. |
| `gcloud version` | Print version information for Google Cloud CLI components. |
| `gcloud auth activate-service-account` | Authorize access to Google Cloud with a service account credential file. |
| `gcloud auth application-default login` | Acquire new user credentials to use for Application Default Credentials. |
| `gsutil iam ch` | Change a bucket's IAM policy (use gcloud storage buckets add-iam-policy-binding). |
| `gsutil rsync` | Synchronize content of two buckets/directories. |
| `gsutil lifecycle set` | Set lifecycle configuration for a bucket. |
| `gsutil versioning set` | Enable or disable versioning for a bucket. |
| `gsutil acl ch` | Change bucket or object ACLs. |
| `kubectl get` | Display one or many resources. |
| `kubectl apply` | Apply a configuration to a resource by file name or stdin. |
| `kubectl create` | Create a resource from a file or from stdin. |
| `kubectl delete` | Delete resources. |
| `kubectl describe` | Show details of a specific resource or group of resources. |
| `kubectl expose` | Expose a resource as a new Kubernetes service. |
| `kubectl scale` | Set a new size for a deployment, replica set, or replication controller. |
| `kubectl rollout` | Manage the rollout of a resource. |
| `kubectl logs` | Print the logs for a container in a pod. |
| `kubectl config` | Modify kubeconfig files. |
