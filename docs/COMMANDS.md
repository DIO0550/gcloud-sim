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
  `--impersonate-service-account`（gcloudの対象コマンド） `--quiet`/`-q` `--help`/`-h` `--verbosity` はgcloud/gsutil/kubectlが受ける（Terraform/Dockerはhelpのみ）
- `--format` は `json` / `yaml` / `value(FIELDS)` / `table(FIELDS)` / `none`、`--filter` は
  `key=value` / `key!=value` / `key:substring` / `NOT` / `AND` / `OR` の簡易版（DJ-009）
- `gcloud beta` / `gcloud alpha` は警告を出して `gcloud` と同じに扱う
- `delete` などの破壊的操作は `--quiet` が無ければ `Do you want to continue (Y/n)?` を挟む

この表は `src/engine/commands/` の登録簿から作っている。登録簿と食い違うと
`src/engine/__tests__/commands-doc.test.ts` が落ちる。

実在するCLIの構文だけを登録します。アプリ独自のコマンドは受け付けません。HCL・YAML・JSONはCLI画面の「ファイル」タブで編集します。

実在するCLIの構文だけを登録します。アプリ独自のコマンドは受け付けません。HCL・YAML・JSONはCLI画面の「ファイル」タブで編集します。

## 実装済み（674）

### gcloud compute

| コマンド | 内容 |
|---|---|
| `gcloud compute disks delete` | gcloud compute disks delete: bounded Compute lesson; no cloud execution. |
| `gcloud compute disks update` | gcloud compute disks update: bounded Compute lesson; no cloud execution. |
| `gcloud compute snapshots delete` | gcloud compute snapshots delete: bounded Compute lesson; no cloud execution. |
| `gcloud compute images create` | gcloud compute images create: bounded Compute lesson; no cloud execution. |
| `gcloud compute images describe` | gcloud compute images describe: bounded Compute lesson; no cloud execution. |
| `gcloud compute images delete` | gcloud compute images delete: bounded Compute lesson; no cloud execution. |
| `gcloud compute resource-policies create snapshot-schedule` | gcloud compute resource-policies create snapshot-schedule: bounded Compute lesson; no cloud execution. |
| `gcloud compute resource-policies describe` | gcloud compute resource-policies describe: bounded Compute lesson; no cloud execution. |
| `gcloud compute resource-policies delete` | gcloud compute resource-policies delete: bounded Compute lesson; no cloud execution. |
| `gcloud compute resource-policies list` | gcloud compute resource-policies list: bounded Compute lesson; no cloud execution. |
| `gcloud compute disks add-resource-policies` | gcloud compute disks add-resource-policies: bounded Compute lesson; no cloud execution. |
| `gcloud compute disks remove-resource-policies` | gcloud compute disks remove-resource-policies: bounded Compute lesson; no cloud execution. |
| `gcloud compute instance-groups managed set-instance-template` | gcloud compute instance-groups managed set-instance-template: bounded Compute lesson; no cloud execution. |
| `gcloud compute instance-groups managed rolling-action start-update` | gcloud compute instance-groups managed rolling-action start-update: bounded Compute lesson; no cloud execution. |
| `gcloud compute instance-groups managed update` | gcloud compute instance-groups managed update: bounded Compute lesson; no cloud execution. |
| `gcloud compute instance-groups managed resize` | gcloud compute instance-groups managed resize: bounded Compute lesson; no cloud execution. |
| `gcloud compute instances detach-disk` | gcloud compute instances detach-disk: bounded Compute lesson; no cloud execution. |
| `gcloud compute instances set-scheduling` | gcloud compute instances set-scheduling: bounded Compute lesson; no cloud execution. |
| `gcloud compute instances set-service-account` | gcloud compute instances set-service-account: bounded Compute lesson; no cloud execution. |
| `gcloud compute tpus tpu-vm create` | gcloud compute tpus tpu-vm create: bounded Compute lesson; no cloud execution. |
| `gcloud compute tpus tpu-vm list` | gcloud compute tpus tpu-vm list: bounded Compute lesson; no cloud execution. |
| `gcloud compute tpus tpu-vm describe` | gcloud compute tpus tpu-vm describe: bounded Compute lesson; no cloud execution. |
| `gcloud compute tpus tpu-vm start` | gcloud compute tpus tpu-vm start: bounded Compute lesson; no cloud execution. |
| `gcloud compute tpus tpu-vm stop` | gcloud compute tpus tpu-vm stop: bounded Compute lesson; no cloud execution. |
| `gcloud compute tpus tpu-vm delete` | gcloud compute tpus tpu-vm delete: bounded Compute lesson; no cloud execution. |
| `gcloud compute os-config inventories describe` | gcloud compute os-config inventories describe: bounded Compute lesson; no cloud execution. |
| `gcloud compute os-config os-policy-assignments create` | gcloud compute os-config os-policy-assignments create: bounded Compute lesson; no cloud execution. |
| `gcloud compute os-config os-policy-assignments describe` | gcloud compute os-config os-policy-assignments describe: bounded Compute lesson; no cloud execution. |
| `gcloud compute os-config os-policy-assignments delete` | gcloud compute os-config os-policy-assignments delete: bounded Compute lesson; no cloud execution. |
| `gcloud compute vpn-gateways create` | gcloud compute vpn-gateways create: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute vpn-gateways list` | gcloud compute vpn-gateways list: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute vpn-gateways describe` | gcloud compute vpn-gateways describe: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute vpn-gateways delete` | gcloud compute vpn-gateways delete: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute external-vpn-gateways create` | gcloud compute external-vpn-gateways create: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute external-vpn-gateways list` | gcloud compute external-vpn-gateways list: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute external-vpn-gateways describe` | gcloud compute external-vpn-gateways describe: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute external-vpn-gateways delete` | gcloud compute external-vpn-gateways delete: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute vpn-tunnels create` | gcloud compute vpn-tunnels create: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute vpn-tunnels list` | gcloud compute vpn-tunnels list: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute vpn-tunnels describe` | gcloud compute vpn-tunnels describe: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute vpn-tunnels delete` | gcloud compute vpn-tunnels delete: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute routers add-interface` | gcloud compute routers add-interface: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute routers add-bgp-peer` | gcloud compute routers add-bgp-peer: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute routers remove-bgp-peer` | gcloud compute routers remove-bgp-peer: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute routers remove-interface` | gcloud compute routers remove-interface: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute interconnects attachments partner create` | gcloud compute interconnects attachments partner create: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute interconnects attachments list` | gcloud compute interconnects attachments list: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute interconnects attachments describe` | gcloud compute interconnects attachments describe: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute interconnects attachments delete` | gcloud compute interconnects attachments delete: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute interconnects attachments partner update` | gcloud compute interconnects attachments partner update: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute networks subnets expand-ip-range` | gcloud compute networks subnets expand-ip-range: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute routes create` | gcloud compute routes create: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute routes list` | gcloud compute routes list: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute routes describe` | gcloud compute routes describe: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute routes delete` | gcloud compute routes delete: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute routers nats create` | gcloud compute routers nats create: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute routers nats list` | gcloud compute routers nats list: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute routers nats describe` | gcloud compute routers nats describe: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute routers nats delete` | gcloud compute routers nats delete: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute shared-vpc enable` | gcloud compute shared-vpc enable: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute shared-vpc disable` | gcloud compute shared-vpc disable: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute shared-vpc associated-projects add` | gcloud compute shared-vpc associated-projects add: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute shared-vpc associated-projects remove` | gcloud compute shared-vpc associated-projects remove: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute shared-vpc get-host-project` | gcloud compute shared-vpc get-host-project: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute shared-vpc associated-projects list` | gcloud compute shared-vpc associated-projects list: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute networks peerings delete` | gcloud compute networks peerings delete: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute networks update` | gcloud compute networks update: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute firewall-rules update` | gcloud compute firewall-rules update: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute network-firewall-policies create` | gcloud compute network-firewall-policies create: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute network-firewall-policies list` | gcloud compute network-firewall-policies list: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute network-firewall-policies describe` | gcloud compute network-firewall-policies describe: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute network-firewall-policies delete` | gcloud compute network-firewall-policies delete: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute network-firewall-policies associations create` | gcloud compute network-firewall-policies associations create: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute network-firewall-policies associations delete` | gcloud compute network-firewall-policies associations delete: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute network-firewall-policies rules create` | gcloud compute network-firewall-policies rules create: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute network-firewall-policies rules delete` | gcloud compute network-firewall-policies rules delete: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute routers delete` | gcloud compute routers delete: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud compute instances create` | Create Compute Engine virtual machine instances. |
| `gcloud compute instances list` | List Compute Engine virtual machine instances. |
| `gcloud compute instances describe` | Describe a virtual machine instance. |
| `gcloud compute instances start` | Start a virtual machine instance. |
| `gcloud compute instances stop` | Stopp a virtual machine instance. |
| `gcloud compute instances suspend` | Suspend a virtual machine instance. |
| `gcloud compute instances resume` | Resum a virtual machine instance. |
| `gcloud compute instances delete` | Delete Compute Engine virtual machine instances. |
| `gcloud compute instances add-tags` | Add tags to Compute Engine virtual machine instances. |
| `gcloud compute instances add-metadata` | Add or update instance metadata. |
| `gcloud compute instances set-machine-type` | Set machine type for Compute Engine virtual machines (the instance must be stopped). |
| `gcloud compute instances attach-disk` | Attach a disk to an instance. |
| `gcloud compute ssh` | SSH into a virtual machine instance (checks the connection prerequisites only). |
| `gcloud compute scp` | Copy files to and from Google Compute Engine virtual machines via scp (checks the connection prerequisites only). |
| `gcloud compute project-info describe` | Describe the Compute Engine project resource. |
| `gcloud compute project-info add-metadata` | Add or update project-wide metadata. |
| `gcloud compute os-login ssh-keys add` | Add an SSH public key to an OS Login profile. |
| `gcloud compute zones list` | List Compute Engine zones. |
| `gcloud compute regions list` | List Compute Engine regions. |
| `gcloud compute machine-types list` | List Compute Engine machine types. |
| `gcloud compute images list` | List Compute Engine images. |
| `gcloud compute operations list` | List Compute Engine operations. |
| `gcloud compute disks list` | List Compute Engine disks. |
| `gcloud compute disks create` | Create Compute Engine persistent disks. |
| `gcloud compute disks describe` | Describe a Compute Engine disk. |
| `gcloud compute disks snapshot` | Create snapshots of Compute Engine persistent disks. |
| `gcloud compute disks resize` | Resize a disk or disks (larger only). |
| `gcloud compute snapshots create` | Create a Compute Engine snapshot from a disk. |
| `gcloud compute snapshots list` | List Compute Engine snapshots. |
| `gcloud compute snapshots describe` | Describe a Compute Engine snapshot. |
| `gcloud compute networks subnets update` | Update Private Google Access on a subnetwork. |
| `gcloud compute networks create` | Create a Compute Engine network. |
| `gcloud compute networks list` | List Compute Engine networks. |
| `gcloud compute networks describe` | Describe a Compute Engine network. |
| `gcloud compute networks delete` | Delete a Compute Engine network. |
| `gcloud compute networks subnets create` | Define a subnet for a network in custom subnet mode. |
| `gcloud compute networks subnets list` | List Compute Engine subnetworks. |
| `gcloud compute networks subnets describe` | Describe a Compute Engine subnetwork. |
| `gcloud compute networks peerings create` | Create a Compute Engine network peering. |
| `gcloud compute firewall-rules create` | Create a Compute Engine firewall rule. |
| `gcloud compute firewall-rules list` | List Compute Engine firewall rules. |
| `gcloud compute firewall-rules describe` | Describe a Compute Engine firewall rule. |
| `gcloud compute firewall-rules delete` | Delete Compute Engine firewall rules. |
| `gcloud compute addresses create` | Reserve IP addresses. |
| `gcloud compute addresses list` | List addresses. |
| `gcloud compute addresses describe` | Display detailed information about an address. |
| `gcloud compute routers create` | Create a Compute Engine router. |
| `gcloud compute routers list` | List Compute Engine routers. |
| `gcloud compute routers describe` | Describe a Compute Engine router. |
| `gcloud compute health-checks create tcp` | Create a TCP health check. |
| `gcloud compute health-checks create http` | Create a HTTP health check. |
| `gcloud compute health-checks create https` | Create a HTTPS health check. |
| `gcloud compute health-checks create` | Legacy simulator alias; prefer create http/tcp/https NAME. |
| `gcloud compute health-checks describe` | Describe a scoped health check. |
| `gcloud compute backend-services create` | Create a backend service for the three modeled LB architectures. |
| `gcloud compute backend-services update` | Update named port, timeout, health check and CDN configuration. |
| `gcloud compute backend-services add-backend` | add a scoped MIG or zonal NEG backend. |
| `gcloud compute backend-services remove-backend` | remove a scoped MIG or zonal NEG backend. |
| `gcloud compute backend-services get-health` | Diagnose VM, app response, named port and health-check firewall independently. |
| `gcloud compute backend-services describe` | Describe a scoped backend service. |
| `gcloud compute health-checks list` | List selected global/regional resources with scoped read permissions. |
| `gcloud compute backend-services list` | List selected global/regional resources with scoped read permissions. |
| `gcloud compute url-maps create` | Create url-maps and validate scoped references. |
| `gcloud compute url-maps describe` | Describe url-maps. |
| `gcloud compute url-maps list` | List url-maps. |
| `gcloud compute target-http-proxies create` | Create target-http-proxies and validate scoped references. |
| `gcloud compute target-http-proxies describe` | Describe target-http-proxies. |
| `gcloud compute target-http-proxies list` | List target-http-proxies. |
| `gcloud compute target-https-proxies create` | Create target-https-proxies and validate scoped references. |
| `gcloud compute target-https-proxies describe` | Describe target-https-proxies. |
| `gcloud compute target-https-proxies list` | List target-https-proxies. |
| `gcloud compute ssl-certificates create` | Create ssl-certificates and validate scoped references. |
| `gcloud compute ssl-certificates describe` | Describe ssl-certificates. |
| `gcloud compute ssl-certificates list` | List ssl-certificates. |
| `gcloud compute network-endpoint-groups create` | Create network-endpoint-groups and validate scoped references. |
| `gcloud compute network-endpoint-groups describe` | Describe network-endpoint-groups. |
| `gcloud compute network-endpoint-groups list` | List network-endpoint-groups. |
| `gcloud compute backend-buckets create` | Create backend-buckets and validate scoped references. |
| `gcloud compute backend-buckets describe` | Describe backend-buckets. |
| `gcloud compute backend-buckets list` | List backend-buckets. |
| `gcloud compute url-maps add-path-matcher` | Add host and exact/longest prefix path routing. |
| `gcloud compute network-endpoint-groups update` | Add/remove one GCE_VM_IP_PORT endpoint per call. |
| `gcloud compute forwarding-rules create` | Connect a passthrough backend or Application proxy frontend. |
| `gcloud compute forwarding-rules describe` | Describe a scoped forwarding rule. |
| `gcloud compute forwarding-rules list` | List scoped frontends. |
| `gcloud compute instance-groups managed list-instances` | List only VMs belonging to the scoped managed instance group. |
| `gcloud compute instance-groups managed set-named-ports` | Set MIG named ports; this does not start an application or open a firewall. |
| `gcloud compute instance-groups set-named-ports` | Set MIG named ports; this does not start an application or open a firewall. |
| `gcloud compute instance-groups get-named-ports` | Show MIG named ports. |
| `gcloud compute url-maps delete` | Delete url-maps after dependents. |
| `gcloud compute target-http-proxies delete` | Delete target-http-proxies after dependents. |
| `gcloud compute target-https-proxies delete` | Delete target-https-proxies after dependents. |
| `gcloud compute ssl-certificates delete` | Delete ssl-certificates after dependents. |
| `gcloud compute network-endpoint-groups delete` | Delete network-endpoint-groups after dependents. |
| `gcloud compute backend-buckets delete` | Delete backend-buckets after dependents. |
| `gcloud compute health-checks delete` | Delete an unused scoped health check. |
| `gcloud compute backend-services delete` | Delete a backend after frontends and URL maps. |
| `gcloud compute forwarding-rules delete` | Delete frontend and release its reserved address. |
| `gcloud compute addresses delete` | Delete an unused reserved address. |
| `gcloud compute instance-groups managed delete` | Delete an unused MIG and only its own member VMs. |
| `gcloud compute instance-templates delete` | Delete an unused instance template. |
| `gcloud compute networks subnets delete` | Delete an unused subnet after frontends, proxies and VMs. |
| `gcloud compute instance-templates create` | Create a Compute Engine virtual machine instance template. |
| `gcloud compute instance-templates list` | List Compute Engine virtual machine instance templates. |
| `gcloud compute instance-templates describe` | Describe a virtual machine instance template. |
| `gcloud compute instance-groups managed create` | Create a Compute Engine managed instance group. |
| `gcloud compute instance-groups managed list` | List Compute Engine managed instance groups. |
| `gcloud compute instance-groups managed describe` | Describe a managed instance group. |
| `gcloud compute instance-groups managed set-autoscaling` | Set autoscaling parameters of a managed instance group. |
| `gcloud compute networks vpc-access connectors create` | create connectors in the fixed serverless lesson. |
| `gcloud compute networks vpc-access connectors list` | list connectors in the fixed serverless lesson. |
| `gcloud compute networks vpc-access connectors describe` | describe connectors in the fixed serverless lesson. |
| `gcloud compute networks vpc-access connectors delete` | delete connectors in the fixed serverless lesson. |

### gcloud dns

| コマンド | 内容 |
|---|---|
| `gcloud dns record-sets create` | gcloud dns record-sets create: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud dns record-sets update` | gcloud dns record-sets update: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud dns record-sets delete` | gcloud dns record-sets delete: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud dns record-sets describe` | gcloud dns record-sets describe: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud dns record-sets list` | gcloud dns record-sets list: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud dns managed-zones update` | gcloud dns managed-zones update: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud dns managed-zones delete` | gcloud dns managed-zones delete: bounded network configuration or diagnosis; no traffic is sent. |
| `gcloud dns managed-zones create` | Create a Cloud DNS managed-zone. |
| `gcloud dns managed-zones list` | View the list of all your managed-zones. |
| `gcloud dns managed-zones describe` | View the details of a Cloud DNS managed-zone. |

### bq

| コマンド | 内容 |
|---|---|
| `bq mk` | bq mk: bounded data lesson. |
| `bq load` | bq load: bounded data lesson. |
| `bq query` | bq query: bounded data lesson. |
| `bq ls` | bq ls: bounded data lesson. |
| `bq show` | bq show: bounded data lesson. |
| `bq rm` | bq rm: bounded data lesson. |

### gcloud pubsub

| コマンド | 内容 |
|---|---|
| `gcloud pubsub subscriptions pull` | gcloud pubsub subscriptions pull: bounded data lesson. |
| `gcloud pubsub subscriptions ack` | gcloud pubsub subscriptions ack: bounded data lesson. |
| `gcloud pubsub subscriptions update` | gcloud pubsub subscriptions update: bounded data lesson. |
| `gcloud pubsub subscriptions delete` | gcloud pubsub subscriptions delete: bounded data lesson. |
| `gcloud pubsub topics delete` | gcloud pubsub topics delete: bounded data lesson. |
| `gcloud pubsub topics publish` | Publish a lesson message and deliver matching function/Eventarc events. |
| `gcloud pubsub topics create` | Create one or more Cloud Pub/Sub topics. |
| `gcloud pubsub topics list` | List Cloud Pub/Sub topics. |
| `gcloud pubsub topics describe` | Describe a Cloud Pub/Sub topic. |
| `gcloud pubsub subscriptions create` | Create one or more Cloud Pub/Sub subscriptions. |
| `gcloud pubsub subscriptions list` | List Cloud Pub/Sub subscriptions. |
| `gcloud pubsub subscriptions describe` | Describe a Cloud Pub/Sub subscription. |

### gcloud dataflow

| コマンド | 内容 |
|---|---|
| `gcloud dataflow jobs run` | gcloud dataflow jobs run: bounded data lesson. |
| `gcloud dataflow jobs list` | gcloud dataflow jobs list: bounded data lesson. |
| `gcloud dataflow jobs describe` | gcloud dataflow jobs describe: bounded data lesson. |
| `gcloud dataflow jobs cancel` | gcloud dataflow jobs cancel: bounded data lesson. |

### gcloud dataproc

| コマンド | 内容 |
|---|---|
| `gcloud dataproc jobs submit spark` | gcloud dataproc jobs submit spark: bounded data lesson. |
| `gcloud dataproc jobs list` | gcloud dataproc jobs list: bounded data lesson. |
| `gcloud dataproc jobs describe` | gcloud dataproc jobs describe: bounded data lesson. |
| `gcloud dataproc jobs cancel` | gcloud dataproc jobs cancel: bounded data lesson. |
| `gcloud dataproc clusters create` | gcloud dataproc clusters create: bounded data lesson. |
| `gcloud dataproc clusters list` | gcloud dataproc clusters list: bounded data lesson. |
| `gcloud dataproc clusters describe` | gcloud dataproc clusters describe: bounded data lesson. |
| `gcloud dataproc clusters update` | gcloud dataproc clusters update: bounded data lesson. |
| `gcloud dataproc clusters delete` | gcloud dataproc clusters delete: bounded data lesson. |

### gcloud managed-kafka

| コマンド | 内容 |
|---|---|
| `gcloud managed-kafka clusters create` | gcloud managed-kafka clusters create: bounded data lesson. |
| `gcloud managed-kafka clusters list` | gcloud managed-kafka clusters list: bounded data lesson. |
| `gcloud managed-kafka clusters describe` | gcloud managed-kafka clusters describe: bounded data lesson. |
| `gcloud managed-kafka clusters delete` | gcloud managed-kafka clusters delete: bounded data lesson. |
| `gcloud managed-kafka topics create` | gcloud managed-kafka topics create: bounded data lesson. |
| `gcloud managed-kafka topics list` | gcloud managed-kafka topics list: bounded data lesson. |
| `gcloud managed-kafka topics describe` | gcloud managed-kafka topics describe: bounded data lesson. |
| `gcloud managed-kafka topics delete` | gcloud managed-kafka topics delete: bounded data lesson. |

### terraform

| コマンド | 内容 |
|---|---|
| `terraform init` | Initialize a backend and the offline Google provider lock; optionally migrate state. |
| `terraform force-unlock` | Remove the matching simulated abandoned state lock. |
| `terraform state pull` | Read the current simulator state as JSON (simplified schema). |
| `terraform validate` | Validate the supported HCL subset and configured variable values. |
| `terraform fmt` | Format supported HCL files. |
| `terraform plan` | Preview changes without mutating cloud resources or managed state. |
| `terraform apply` | Apply a new or saved execution plan. |
| `terraform destroy` | Destroy the resources managed by this simulator state. |
| `terraform show` | Show a saved plan or state; -json exposes the raw simulator data. |
| `terraform output` | Read outputs recorded by the last apply. |
| `terraform state list` | List managed resource addresses. |
| `terraform state show` | Show a managed resource from state (does not refresh). |
| `terraform state rm` | Forget an address without deleting its remote resource. |
| `terraform state mv` | Rename a state address; update HCL separately to avoid recreation. |
| `terraform import` | Import an existing supported resource into a configured address. |
| `terraform state push` | Replace managed state from validated simulator JSON; infrastructure is unchanged. |

### gcloud terraform

| コマンド | 内容 |
|---|---|
| `gcloud terraform vet` | Validate a simulator JSON plan against a bounded teaching policy library. |

### gcloud artifacts

| コマンド | 内容 |
|---|---|
| `gcloud artifacts docker tags list` | List remote tags in a repository or image path. |
| `gcloud artifacts docker tags add` | Create or move a remote tag within the same image path. |
| `gcloud artifacts docker tags delete` | Remove a remote tag while retaining the image version. |
| `gcloud artifacts docker images delete` | Delete a remote image path or a specific tag/digest version. |
| `gcloud artifacts repositories create` | Create a standard Docker Artifact Registry repository. |
| `gcloud artifacts repositories list` | List repositories in the selected project, optionally filtered by location. |
| `gcloud artifacts repositories describe` | describe for an Artifact Registry repository. |
| `gcloud artifacts repositories delete` | delete for an Artifact Registry repository. |
| `gcloud artifacts repositories get-iam-policy` | get-iam-policy for an Artifact Registry repository. |
| `gcloud artifacts repositories add-iam-policy-binding` | add-iam-policy-binding for an Artifact Registry repository. |
| `gcloud artifacts repositories remove-iam-policy-binding` | remove-iam-policy-binding for an Artifact Registry repository. |
| `gcloud artifacts docker images list` | List simulated image versions in a Docker repository, optionally including tags. |
| `gcloud artifacts docker images describe` | Describe a simulated registry image by tag or digest. |

### docker

| コマンド | 内容 |
|---|---|
| `docker build` | Build a simulated image from a fixed lesson context; no host files or Docker daemon. |
| `docker images` | List local images, separately from registry images. |
| `docker tag` | Add or move a local tag without copying the image. |
| `docker push` | Push a local tagged image to an existing simulated Artifact Registry repository. |
| `docker pull` | Pull a tagged image or digest from simulated Artifact Registry. |
| `docker run` | Start a simulated detached lesson container; missing images are pulled from Artifact Registry. |
| `docker ps` | List running simulated containers. |
| `docker logs` | Read fixed lesson startup logs; no application process runs. |
| `docker inspect` | Inspect a simulated container and its pinned image ID. |
| `docker stop` | Stop a simulated container and release its published port. |
| `docker rm` | Remove a stopped simulated container. |
| `docker rmi` | Remove one local image tag or an unreferenced image ID; registry images remain. |

### gcloud auth

| コマンド | 内容 |
|---|---|
| `gcloud auth configure-docker` | Configure simulated gcloud credential helpers for the specified Artifact Registry hosts. |
| `gcloud auth activate-service-account` | Authorize access to Google Cloud with a service account credential file. |
| `gcloud auth application-default login` | Acquire new user credentials to use for Application Default Credentials (simulated: uses the active account). |
| `gcloud auth login` | Authorize gcloud to access Google Cloud (simulated: registers ACCOUNT as the active principal). |
| `gcloud auth list` | Lists credentialed accounts. |
| `gcloud auth revoke` | Revoke access credentials for an account (simulated). |
| `gcloud auth print-access-token` | Issue simulated one-hour-or-shorter SA credential metadata; no real bearer token. |

### gcloud builds

| コマンド | 内容 |
|---|---|
| `gcloud builds submit` | Build a fixed lesson context remotely and push to Artifact Registry (simulated). |
| `gcloud builds list` | List simulated builds in one project and location. |
| `gcloud builds describe` | Describe a simulated build. |
| `gcloud builds log` | Read fixed simulated build logs; no streaming or external log storage. |
| `gcloud builds cancel` | Cancel a queued or working simulated build. |

### gcloud config

| コマンド | 内容 |
|---|---|
| `gcloud config set` | Set a Google Cloud CLI property. |
| `gcloud config unset` | Unset a Google Cloud CLI property. |
| `gcloud config get` | Print the value of a Google Cloud CLI property. |
| `gcloud config get-value` | Print the value of a Google Cloud CLI property. |
| `gcloud config list` | List Google Cloud CLI properties for the currently active configuration. |
| `gcloud config configurations list` | List existing named configurations. |
| `gcloud config configurations create` | Create a new named configuration. |
| `gcloud config configurations activate` | Activates an existing named configuration. |
| `gcloud config configurations describe` | Describes a named configuration by listing its properties. |
| `gcloud config configurations delete` | Deletes a named configuration. |

### gcloud version

| コマンド | 内容 |
|---|---|
| `gcloud version` | Print version information for Google Cloud CLI components. |

### gcloud info

| コマンド | 内容 |
|---|---|
| `gcloud info` | Display information about the current gcloud environment. |

### gcloud init

| コマンド | 内容 |
|---|---|
| `gcloud init` | Initialize or reinitialize gcloud (non-interactive: prints the current configuration). |

### gcloud components

| コマンド | 内容 |
|---|---|
| `gcloud components list` | List the status of all Google Cloud CLI components. |
| `gcloud components install` | Install specified components. |
| `gcloud components update` | Update all of your installed components. |

### gcloud projects

| コマンド | 内容 |
|---|---|
| `gcloud projects list` | List projects accessible by the active account. |
| `gcloud projects describe` | Show metadata for a project. |
| `gcloud projects create` | Create a new project. |
| `gcloud projects delete` | Delete a project. |
| `gcloud projects undelete` | Undelete a project. |
| `gcloud projects get-iam-policy` | Get the IAM policy for a resource. |
| `gcloud projects add-iam-policy-binding` | Add an IAM policy binding to a resource. |
| `gcloud projects remove-iam-policy-binding` | Remove an IAM policy binding from a resource. |

### gcloud organizations

| コマンド | 内容 |
|---|---|
| `gcloud organizations list` | List organizations accessible by the active account. |
| `gcloud organizations describe` | Show metadata for an organization. |
| `gcloud organizations get-iam-policy` | Get the IAM policy for a resource. |
| `gcloud organizations add-iam-policy-binding` | Add an IAM policy binding to a resource. |
| `gcloud organizations remove-iam-policy-binding` | Remove an IAM policy binding from a resource. |

### gcloud resource-manager

| コマンド | 内容 |
|---|---|
| `gcloud resource-manager folders list` | List folders under a parent. |
| `gcloud resource-manager folders create` | Create a new folder. |
| `gcloud resource-manager folders describe` | Show metadata for a folder. |
| `gcloud resource-manager folders get-iam-policy` | Get the IAM policy for a resource. |
| `gcloud resource-manager folders add-iam-policy-binding` | Add an IAM policy binding to a resource. |
| `gcloud resource-manager folders remove-iam-policy-binding` | Remove an IAM policy binding from a resource. |

### gcloud billing

| コマンド | 内容 |
|---|---|
| `gcloud billing accounts list` | List all active billing accounts. |
| `gcloud billing accounts describe` | Show metadata for a billing account. |
| `gcloud billing projects describe` | Show detailed billing information for a project. |
| `gcloud billing projects link` | Link a project with a billing account. |
| `gcloud billing projects unlink` | Unlink a project from its billing account. |
| `gcloud billing budgets create` | Create a budget for a billing account. |
| `gcloud billing budgets list` | List budgets for a billing account. |
| `gcloud billing budgets describe` | Describe a budget. |
| `gcloud billing budgets update` | Configure bounded administration resources in the simulator. |
| `gcloud billing budgets delete` | Configure bounded administration resources in the simulator. |

### gcloud services

| コマンド | 内容 |
|---|---|
| `gcloud services enable` | Enable a service for consumption for a project. |
| `gcloud services disable` | Disable a service for the current project. |
| `gcloud services list` | List services for a project. |

### gcloud filestore

| コマンド | 内容 |
|---|---|
| `gcloud filestore instances create` | Bounded storage configuration; no cloud requests or billing. |
| `gcloud filestore instances list` | Bounded storage configuration; no cloud requests or billing. |
| `gcloud filestore instances describe` | Bounded storage configuration; no cloud requests or billing. |
| `gcloud filestore instances delete` | Bounded storage configuration; no cloud requests or billing. |

### gcloud netapp

| コマンド | 内容 |
|---|---|
| `gcloud netapp storage-pools create` | Bounded storage configuration; no cloud requests or billing. |
| `gcloud netapp storage-pools list` | Bounded storage configuration; no cloud requests or billing. |
| `gcloud netapp storage-pools describe` | Bounded storage configuration; no cloud requests or billing. |
| `gcloud netapp storage-pools delete` | Bounded storage configuration; no cloud requests or billing. |
| `gcloud netapp volumes create` | Bounded storage configuration; no cloud requests or billing. |
| `gcloud netapp volumes list` | Bounded storage configuration; no cloud requests or billing. |
| `gcloud netapp volumes describe` | Bounded storage configuration; no cloud requests or billing. |
| `gcloud netapp volumes delete` | Bounded storage configuration; no cloud requests or billing. |

### gcloud lustre

| コマンド | 内容 |
|---|---|
| `gcloud lustre instances create` | Bounded storage configuration; no cloud requests or billing. |
| `gcloud lustre instances list` | Bounded storage configuration; no cloud requests or billing. |
| `gcloud lustre instances describe` | Bounded storage configuration; no cloud requests or billing. |
| `gcloud lustre instances delete` | Bounded storage configuration; no cloud requests or billing. |

### gcloud kms

| コマンド | 内容 |
|---|---|
| `gcloud kms keys versions enable` | Bounded storage configuration; no cloud requests or billing. |
| `gcloud kms keys versions disable` | Bounded storage configuration; no cloud requests or billing. |
| `gcloud kms keys create` | create keys in the fixed serverless lesson. |
| `gcloud kms keys list` | list keys in the fixed serverless lesson. |
| `gcloud kms keys describe` | describe keys in the fixed serverless lesson. |
| `gcloud kms keys delete` | delete keys in the fixed serverless lesson. |
| `gcloud kms keys versions update` | Enable or disable the lesson key's primary version (version 1). |
| `gcloud kms keys get-iam-policy` | Read or change the resource IAM policy. |
| `gcloud kms keys add-iam-policy-binding` | Read or change the resource IAM policy. |
| `gcloud kms keys remove-iam-policy-binding` | Read or change the resource IAM policy. |
| `gcloud kms keyrings create` | Create a new keyring. |
| `gcloud kms keyrings list` | List keyrings within a location. |
| `gcloud kms keyrings describe` | Get metadata for a keyring. |

### gcloud storage

| コマンド | 内容 |
|---|---|
| `gcloud storage service-agent` | Bounded storage configuration; no cloud requests or billing. |
| `gcloud storage objects describe` | Configure or inspect virtual object generations; no cloud requests. |
| `gcloud storage restore` | Configure or inspect virtual object generations; no cloud requests. |
| `gcloud storage buckets create` | Create Cloud Storage buckets. |
| `gcloud storage buckets list` | List Cloud Storage buckets. |
| `gcloud storage buckets describe` | Describe a Cloud Storage bucket. |
| `gcloud storage buckets delete` | Delete Cloud Storage buckets. |
| `gcloud storage buckets get-iam-policy` | Get the IAM policy for a resource. |
| `gcloud storage buckets add-iam-policy-binding` | Add an IAM policy binding to a resource. |
| `gcloud storage buckets remove-iam-policy-binding` | Remove an IAM policy binding from a resource. |
| `gcloud storage ls` | List Cloud Storage buckets and objects. |
| `gcloud storage cp` | Upload, download, and copy Cloud Storage objects (contents are not stored). |
| `gcloud storage rm` | Delete objects and buckets. |
| `gcloud storage buckets update` | Update Cloud Storage buckets (versioning, lifecycle, storage class, access settings). |
| `gcloud storage objects update` | Update Cloud Storage objects (storage class, content type). |
| `gcloud storage rsync` | Synchronize content of two buckets/directories (objects are copied between gs:// URLs). |
| `gcloud storage sign-url` | Generate a URL with embedded authentication for an object. |

### gcloud transfer

| コマンド | 内容 |
|---|---|
| `gcloud transfer jobs create` | Bounded storage configuration; no cloud requests or billing. |
| `gcloud transfer jobs run` | Bounded storage configuration; no cloud requests or billing. |
| `gcloud transfer jobs describe` | Bounded storage configuration; no cloud requests or billing. |
| `gcloud transfer jobs list` | Bounded storage configuration; no cloud requests or billing. |
| `gcloud transfer jobs update` | Bounded storage configuration; no cloud requests or billing. |
| `gcloud transfer jobs delete` | Bounded storage configuration; no cloud requests or billing. |

### gcloud org-policies

| コマンド | 内容 |
|---|---|
| `gcloud org-policies set-policy` | Configure bounded administration resources in the simulator. |
| `gcloud org-policies describe` | Configure bounded administration resources in the simulator. |
| `gcloud org-policies reset` | Configure bounded administration resources in the simulator. |
| `gcloud org-policies delete` | Configure bounded administration resources in the simulator. |

### gcloud identity

| コマンド | 内容 |
|---|---|
| `gcloud identity groups create` | Configure bounded administration resources in the simulator. |
| `gcloud identity groups describe` | Configure bounded administration resources in the simulator. |
| `gcloud identity groups search` | Configure bounded administration resources in the simulator. |
| `gcloud identity groups delete` | Configure bounded administration resources in the simulator. |
| `gcloud identity groups memberships add` | Configure bounded administration resources in the simulator. |
| `gcloud identity groups memberships delete` | Configure bounded administration resources in the simulator. |
| `gcloud identity groups memberships list` | Configure bounded administration resources in the simulator. |

### gcloud iam

| コマンド | 内容 |
|---|---|
| `gcloud iam workload-identity-pools create` | Configure bounded administration resources in the simulator. |
| `gcloud iam workload-identity-pools list` | Configure bounded administration resources in the simulator. |
| `gcloud iam workload-identity-pools describe` | Configure bounded administration resources in the simulator. |
| `gcloud iam workload-identity-pools delete` | Configure bounded administration resources in the simulator. |
| `gcloud iam workforce-pools create` | Configure bounded administration resources in the simulator. |
| `gcloud iam workforce-pools list` | Configure bounded administration resources in the simulator. |
| `gcloud iam workforce-pools describe` | Configure bounded administration resources in the simulator. |
| `gcloud iam workforce-pools delete` | Configure bounded administration resources in the simulator. |
| `gcloud iam workload-identity-pools providers create-oidc` | Configure bounded administration resources in the simulator. |
| `gcloud iam workload-identity-pools providers list` | Configure bounded administration resources in the simulator. |
| `gcloud iam workload-identity-pools providers describe` | Configure bounded administration resources in the simulator. |
| `gcloud iam workload-identity-pools providers delete` | Configure bounded administration resources in the simulator. |
| `gcloud iam workforce-pools providers create-oidc` | Configure bounded administration resources in the simulator. |
| `gcloud iam workforce-pools providers list` | Configure bounded administration resources in the simulator. |
| `gcloud iam workforce-pools providers describe` | Configure bounded administration resources in the simulator. |
| `gcloud iam workforce-pools providers delete` | Configure bounded administration resources in the simulator. |
| `gcloud iam service-accounts create` | Create a service account for a project. |
| `gcloud iam service-accounts list` | List all of a project's service accounts. |
| `gcloud iam service-accounts describe` | Show metadata for a service account from a project. |
| `gcloud iam service-accounts delete` | Delete a service account from a project. |
| `gcloud iam roles list` | List predefined roles known to gcloud-sim, or a project's custom roles with --project (as the real gcloud does). |
| `gcloud iam roles describe` | Show metadata for a role, including the permissions gcloud-sim records for it. |
| `gcloud iam roles create` | Create a custom role for a project. |
| `gcloud iam roles copy` | Create a role from an existing role. |
| `gcloud iam service-accounts keys create` | Create a private key for a service account (the key is recorded, not written to disk). |
| `gcloud iam service-accounts keys list` | List the keys for a service account. |
| `gcloud iam service-accounts get-iam-policy` | Get the IAM policy for a resource. |
| `gcloud iam service-accounts add-iam-policy-binding` | Add an IAM policy binding to a resource. |
| `gcloud iam service-accounts remove-iam-policy-binding` | Remove an IAM policy binding from a resource. |

### gcloud quotas

| コマンド | 内容 |
|---|---|
| `gcloud quotas info list` | Configure bounded administration resources in the simulator. |
| `gcloud quotas preferences create` | Configure bounded administration resources in the simulator. |
| `gcloud quotas preferences update` | Configure bounded administration resources in the simulator. |

### gcloud asset

| コマンド | 内容 |
|---|---|
| `gcloud asset search-all-resources` | Configure bounded administration resources in the simulator. |

### gsutil

| コマンド | 内容 |
|---|---|
| `gsutil mb` | Make buckets (alias of gcloud storage buckets create). |
| `gsutil ls` | List providers, buckets, or objects (alias of gcloud storage ls). |
| `gsutil cp` | Copy files and objects (alias of gcloud storage cp). |
| `gsutil rm` | Remove objects (alias of gcloud storage rm). |
| `gsutil iam get` | Get the IAM policy of a bucket (alias of gcloud storage buckets get-iam-policy). |
| `gsutil iam ch` | Change a bucket's IAM policy, e.g. gsutil iam ch allUsers:objectViewer gs://BUCKET. |
| `gsutil rsync` | Synchronize content of two buckets/directories (alias of gcloud storage rsync). |
| `gsutil lifecycle set` | Set lifecycle configuration for a bucket from a file (sample files only). |
| `gsutil versioning set` | Enable or disable versioning for a bucket. |
| `gsutil acl ch` | Change bucket or object ACLs (rejected on buckets with uniform bucket-level access). |

### gcloud container

| コマンド | 内容 |
|---|---|
| `gcloud container clusters create` | Create a GKE Standard cluster. |
| `gcloud container clusters create-auto` | Create a GKE Autopilot cluster. |
| `gcloud container clusters list` | List existing clusters for running containers. |
| `gcloud container clusters describe` | Describe an existing cluster for running containers. |
| `gcloud container clusters delete` | Delete an existing cluster for running containers. |
| `gcloud container clusters get-credentials` | Fetch credentials for a running cluster (updates kubeconfig, simulated). |
| `gcloud container clusters update` | Update simulated endpoint, Workload Identity and VPA settings. |
| `gcloud container clusters resize` | Resizes an existing cluster for running containers. |
| `gcloud container clusters upgrade` | Upgrade the Kubernetes version of an existing container cluster. |
| `gcloud container node-pools create` | Create a node pool in a running cluster. |
| `gcloud container node-pools list` | List node pools in a running cluster. |
| `gcloud container node-pools describe` | Describe an existing node pool for a cluster. |
| `gcloud container node-pools update` | Update simulated autoscaling or node management settings. |
| `gcloud container node-pools delete` | Delete a Standard node pool (no Pod scheduling is simulated). |

### kubectl

| コマンド | 内容 |
|---|---|
| `kubectl create serviceaccount` | Create a Kubernetes ServiceAccount (no key is generated). |
| `kubectl annotate` | Link one Kubernetes ServiceAccount to an IAM service account. |
| `kubectl autoscale` | Create a CPU utilization HPA for one Deployment (explicit simulator evaluation). |
| `kubectl create configmap` | Create a configmap from repeated --from-literal=KEY=VALUE (selected namespace). |
| `kubectl create secret generic` | Create a secret from repeated --from-literal=KEY=VALUE (selected namespace). |
| `kubectl label` | Add, replace (--overwrite) or remove labels on one ConfigMap or Secret. |
| `kubectl set env` | Set/remove environment variables or import ConfigMap/Secret key references. |
| `kubectl exec` | Inspect Pod env with printenv/env and mounted files with cat/base64 (no shell execution). |
| `kubectl get` | Display one or many resources. |
| `kubectl apply` | Apply virtual ConfigMap/Secret (including immutable and ConfigMap binaryData)/Deployment/Service/HPA/PVC/StorageClass YAML/JSON or fixed samples. |
| `kubectl create` | Create a resource from a file or from the command line (deployment). |
| `kubectl delete` | Delete resources. |
| `kubectl describe` | Show details of a specific resource or group of resources. |
| `kubectl expose` | Expose a resource as a new Kubernetes service. |
| `kubectl scale` | Set replicas for a Deployment or StatefulSet (StatefulSet PVCs are retained). |
| `kubectl set image` | Update the single container image of a Deployment. |
| `kubectl set resources` | Update CPU/memory requests and limits of a single Deployment container. |
| `kubectl rollout status` | Deployment rollout status (retains current and 10 previous templates). |
| `kubectl rollout restart` | Deployment rollout restart (retains current and 10 previous templates). |
| `kubectl rollout history` | Deployment rollout history (retains current and 10 previous templates). |
| `kubectl rollout undo` | Deployment rollout undo (retains current and 10 previous templates). |
| `kubectl logs` | Print the logs for a container in a pod. |
| `kubectl config` | Modify kubeconfig files (current-context / get-contexts / use-context / set-context / view). |

### gcloud run

| コマンド | 内容 |
|---|---|
| `gcloud run deploy` | Deploy a fixed Cloud Run lesson with immutable revisions. |
| `gcloud run services update` | Update runtime configuration by creating a new revision. |
| `gcloud run services list` | List regional lesson resources. |
| `gcloud run services describe` | describe a lesson resource. |
| `gcloud run services delete` | delete a lesson resource. |
| `gcloud run services get-iam-policy` | Read or change resource IAM bindings. |
| `gcloud run services add-iam-policy-binding` | Read or change resource IAM bindings. |
| `gcloud run services remove-iam-policy-binding` | Read or change resource IAM bindings. |
| `gcloud run services update-traffic` | Route percentages to existing revisions. |
| `gcloud run jobs create` | Configure a fixed job lesson (no arbitrary container execution). |
| `gcloud run jobs update` | Configure a fixed job lesson (no arbitrary container execution). |
| `gcloud run jobs list` | List regional lesson resources. |
| `gcloud run jobs describe` | describe a lesson resource. |
| `gcloud run jobs delete` | delete a lesson resource. |
| `gcloud run jobs get-iam-policy` | Read or change resource IAM bindings. |
| `gcloud run jobs add-iam-policy-binding` | Read or change resource IAM bindings. |
| `gcloud run jobs remove-iam-policy-binding` | Read or change resource IAM bindings. |
| `gcloud run jobs execute` | Run fixed lesson tasks and save execution history. |
| `gcloud run revisions list` | List immutable revision configurations. |

### gcloud functions

| コマンド | 内容 |
|---|---|
| `gcloud functions deploy` | Deploy a Gen2 fixed lesson handler with HTTP/PubSub/Storage/Firestore triggers. |
| `gcloud functions list` | List regional lesson resources. |
| `gcloud functions describe` | describe a lesson resource. |
| `gcloud functions delete` | delete a lesson resource. |
| `gcloud functions get-iam-policy` | Read or change resource IAM bindings. |
| `gcloud functions add-iam-policy-binding` | Read or change resource IAM bindings. |
| `gcloud functions remove-iam-policy-binding` | Read or change resource IAM bindings. |
| `gcloud functions call` | Evaluate authentication, ingress and runtime dependencies using the fixed lesson handler. |

### gcloud eventarc

| コマンド | 内容 |
|---|---|
| `gcloud eventarc triggers create` | Connect a supported source event to a Cloud Run lesson. |
| `gcloud eventarc triggers list` | list Eventarc lesson triggers. |
| `gcloud eventarc triggers describe` | describe Eventarc lesson triggers. |
| `gcloud eventarc triggers delete` | delete Eventarc lesson triggers. |

### gcloud redis

| コマンド | 内容 |
|---|---|
| `gcloud redis instances create` | create redis in the fixed serverless lesson. |
| `gcloud redis instances list` | list redis in the fixed serverless lesson. |
| `gcloud redis instances describe` | describe redis in the fixed serverless lesson. |
| `gcloud redis instances delete` | delete redis in the fixed serverless lesson. |
| `gcloud redis instances failover` | gcloud redis instances failover: deterministic database lesson; no external SDK execution. |

### gcloud firestore

| コマンド | 内容 |
|---|---|
| `gcloud firestore databases create` | create databases in the fixed serverless lesson. |
| `gcloud firestore databases list` | list databases in the fixed serverless lesson. |
| `gcloud firestore databases describe` | describe databases in the fixed serverless lesson. |
| `gcloud firestore databases delete` | delete databases in the fixed serverless lesson. |

### gcloud secrets

| コマンド | 内容 |
|---|---|
| `gcloud secrets create` | create secrets in the fixed serverless lesson. |
| `gcloud secrets list` | list secrets in the fixed serverless lesson. |
| `gcloud secrets describe` | describe secrets in the fixed serverless lesson. |
| `gcloud secrets delete` | delete secrets in the fixed serverless lesson. |
| `gcloud secrets versions access` | Evaluate access or change the state of a lesson secret version. |
| `gcloud secrets versions enable` | Evaluate access or change the state of a lesson secret version. |
| `gcloud secrets versions disable` | Evaluate access or change the state of a lesson secret version. |
| `gcloud secrets versions destroy` | Evaluate access or change the state of a lesson secret version. |
| `gcloud secrets get-iam-policy` | Read or change the resource IAM policy. |
| `gcloud secrets add-iam-policy-binding` | Read or change the resource IAM policy. |
| `gcloud secrets remove-iam-policy-binding` | Read or change the resource IAM policy. |

### gcloud workflows

| コマンド | 内容 |
|---|---|
| `gcloud workflows deploy` | Deploy the built-in workflow.yaml (run:workflow-api → function:workflow-function). |
| `gcloud workflows list` | list a fixed workflow lesson. |
| `gcloud workflows describe` | describe a fixed workflow lesson. |
| `gcloud workflows delete` | delete a fixed workflow lesson. |
| `gcloud workflows run` | run a fixed workflow lesson. |

### gcloud app

| コマンド | 内容 |
|---|---|
| `gcloud app deploy` | Deploy the local code and/or configuration of your app to App Engine (sample app.yaml only). |
| `gcloud app browse` | Open the current app in a web browser (prints the URL; gcloud-sim has no browser). |
| `gcloud app describe` | Display all data about an existing App Engine application. |
| `gcloud app versions list` | List the versions of all services in the App Engine server. |
| `gcloud app services set-traffic` | Set traffic splitting settings. |

### gcloud sql

| コマンド | 内容 |
|---|---|
| `gcloud sql instances create` | gcloud sql instances create (deterministic database lesson). |
| `gcloud sql instances patch` | gcloud sql instances patch (deterministic database lesson). |
| `gcloud sql instances list` | gcloud sql instances list (deterministic database lesson). |
| `gcloud sql instances describe` | gcloud sql instances describe (deterministic database lesson). |
| `gcloud sql instances delete` | gcloud sql instances delete (deterministic database lesson). |
| `gcloud sql instances failover` | gcloud sql instances failover (deterministic database lesson). |
| `gcloud sql instances clone` | gcloud sql instances clone (deterministic database lesson). |
| `gcloud sql backups create` | gcloud sql backups create (deterministic database lesson). |
| `gcloud sql backups list` | gcloud sql backups list (deterministic database lesson). |
| `gcloud sql backups describe` | gcloud sql backups describe (deterministic database lesson). |
| `gcloud sql backups restore` | gcloud sql backups restore (deterministic database lesson). |
| `gcloud sql databases create` | gcloud sql databases create (deterministic database lesson). |
| `gcloud sql databases list` | gcloud sql databases list (deterministic database lesson). |
| `gcloud sql databases describe` | gcloud sql databases describe (deterministic database lesson). |
| `gcloud sql databases delete` | gcloud sql databases delete (deterministic database lesson). |
| `gcloud sql users create` | gcloud sql users create (deterministic database lesson). |
| `gcloud sql users list` | gcloud sql users list (deterministic database lesson). |
| `gcloud sql users delete` | gcloud sql users delete (deterministic database lesson). |
| `gcloud sql connect` | gcloud sql connect (deterministic database lesson). |
| `gcloud sql export sql` | gcloud sql export sql (deterministic database lesson). |
| `gcloud sql import sql` | gcloud sql import sql (deterministic database lesson). |

### gcloud alloydb

| コマンド | 内容 |
|---|---|
| `gcloud alloydb users create` | gcloud alloydb users create (deterministic database lesson). |
| `gcloud alloydb users list` | gcloud alloydb users list (deterministic database lesson). |
| `gcloud alloydb users delete` | gcloud alloydb users delete (deterministic database lesson). |
| `gcloud alloydb clusters create` | gcloud alloydb clusters create (deterministic database lesson). |
| `gcloud alloydb clusters list` | gcloud alloydb clusters list (deterministic database lesson). |
| `gcloud alloydb clusters describe` | gcloud alloydb clusters describe (deterministic database lesson). |
| `gcloud alloydb clusters delete` | gcloud alloydb clusters delete (deterministic database lesson). |
| `gcloud alloydb clusters restore` | gcloud alloydb clusters restore (deterministic database lesson). |
| `gcloud alloydb instances create` | gcloud alloydb instances create (deterministic database lesson). |
| `gcloud alloydb instances list` | gcloud alloydb instances list (deterministic database lesson). |
| `gcloud alloydb instances describe` | gcloud alloydb instances describe (deterministic database lesson). |
| `gcloud alloydb instances delete` | gcloud alloydb instances delete (deterministic database lesson). |
| `gcloud alloydb backups create` | gcloud alloydb backups create (deterministic database lesson). |
| `gcloud alloydb backups list` | gcloud alloydb backups list (deterministic database lesson). |
| `gcloud alloydb backups describe` | gcloud alloydb backups describe (deterministic database lesson). |
| `gcloud alloydb backups delete` | gcloud alloydb backups delete (deterministic database lesson). |

### gcloud database-migration

| コマンド | 内容 |
|---|---|
| `gcloud database-migration connection-profiles create` | gcloud database-migration connection-profiles create (deterministic database lesson). |
| `gcloud database-migration migration-jobs create` | gcloud database-migration migration-jobs create (deterministic database lesson). |
| `gcloud database-migration connection-profiles list` | gcloud database-migration connection-profiles list (deterministic database lesson). |
| `gcloud database-migration connection-profiles describe` | gcloud database-migration connection-profiles describe (deterministic database lesson). |
| `gcloud database-migration connection-profiles delete` | gcloud database-migration connection-profiles delete (deterministic database lesson). |
| `gcloud database-migration migration-jobs list` | gcloud database-migration migration-jobs list (deterministic database lesson). |
| `gcloud database-migration migration-jobs describe` | gcloud database-migration migration-jobs describe (deterministic database lesson). |
| `gcloud database-migration migration-jobs delete` | gcloud database-migration migration-jobs delete (deterministic database lesson). |
| `gcloud database-migration migration-jobs verify` | gcloud database-migration migration-jobs verify (deterministic database lesson). |
| `gcloud database-migration migration-jobs start` | gcloud database-migration migration-jobs start (deterministic database lesson). |
| `gcloud database-migration migration-jobs stop` | gcloud database-migration migration-jobs stop (deterministic database lesson). |
| `gcloud database-migration migration-jobs resume` | gcloud database-migration migration-jobs resume (deterministic database lesson). |
| `gcloud database-migration migration-jobs promote` | gcloud database-migration migration-jobs promote (deterministic database lesson). |

### gcloud bigtable

| コマンド | 内容 |
|---|---|
| `gcloud bigtable instances create` | gcloud bigtable instances create: deterministic database lesson; no external SDK execution. |
| `gcloud bigtable instances list` | gcloud bigtable instances list: deterministic database lesson; no external SDK execution. |
| `gcloud bigtable instances describe` | gcloud bigtable instances describe: deterministic database lesson; no external SDK execution. |
| `gcloud bigtable instances delete` | gcloud bigtable instances delete: deterministic database lesson; no external SDK execution. |
| `gcloud bigtable clusters create` | gcloud bigtable clusters create: deterministic database lesson; no external SDK execution. |
| `gcloud bigtable clusters list` | gcloud bigtable clusters list: deterministic database lesson; no external SDK execution. |
| `gcloud bigtable clusters describe` | gcloud bigtable clusters describe: deterministic database lesson; no external SDK execution. |
| `gcloud bigtable clusters update` | gcloud bigtable clusters update: deterministic database lesson; no external SDK execution. |
| `gcloud bigtable clusters delete` | gcloud bigtable clusters delete: deterministic database lesson; no external SDK execution. |
| `gcloud bigtable backups create` | gcloud bigtable backups create: deterministic database lesson; no external SDK execution. |
| `gcloud bigtable backups list` | gcloud bigtable backups list: deterministic database lesson; no external SDK execution. |
| `gcloud bigtable backups describe` | gcloud bigtable backups describe: deterministic database lesson; no external SDK execution. |
| `gcloud bigtable backups delete` | gcloud bigtable backups delete: deterministic database lesson; no external SDK execution. |

### gcloud spanner

| コマンド | 内容 |
|---|---|
| `gcloud spanner instances create` | gcloud spanner instances create: deterministic database lesson; no external SDK execution. |
| `gcloud spanner instances list` | gcloud spanner instances list: deterministic database lesson; no external SDK execution. |
| `gcloud spanner instances describe` | gcloud spanner instances describe: deterministic database lesson; no external SDK execution. |
| `gcloud spanner instances update` | gcloud spanner instances update: deterministic database lesson; no external SDK execution. |
| `gcloud spanner instances delete` | gcloud spanner instances delete: deterministic database lesson; no external SDK execution. |
| `gcloud spanner databases create` | gcloud spanner databases create: deterministic database lesson; no external SDK execution. |
| `gcloud spanner databases list` | gcloud spanner databases list: deterministic database lesson; no external SDK execution. |
| `gcloud spanner databases describe` | gcloud spanner databases describe: deterministic database lesson; no external SDK execution. |
| `gcloud spanner databases delete` | gcloud spanner databases delete: deterministic database lesson; no external SDK execution. |
| `gcloud spanner backups create` | gcloud spanner backups create: deterministic database lesson; no external SDK execution. |
| `gcloud spanner backups list` | gcloud spanner backups list: deterministic database lesson; no external SDK execution. |
| `gcloud spanner backups describe` | gcloud spanner backups describe: deterministic database lesson; no external SDK execution. |
| `gcloud spanner backups delete` | gcloud spanner backups delete: deterministic database lesson; no external SDK execution. |
| `gcloud spanner databases restore` | gcloud spanner databases restore: deterministic database lesson; no external SDK execution. |
| `gcloud spanner databases ddl update` | gcloud spanner databases ddl update: deterministic database lesson; no external SDK execution. |
| `gcloud spanner databases execute-sql` | gcloud spanner databases execute-sql: deterministic database lesson; no external SDK execution. |

### gcloud logging

| コマンド | 内容 |
|---|---|
| `gcloud logging sinks update` | update a log sink. |
| `gcloud logging sinks delete` | delete a log sink. |
| `gcloud logging read` | Read log entries (audit logs derived from the operation history). |
| `gcloud logging logs list` | List logs in a project. |
| `gcloud logging sinks create` | Create a log sink. |
| `gcloud logging sinks list` | List the defined sinks. |
| `gcloud logging sinks describe` | Display information about a sink. |
| `gcloud logging buckets list` | Configure and evaluate a bounded observability lesson; no network, real alerts or arbitrary code. |
| `gcloud logging buckets create` | Configure and evaluate a bounded observability lesson; no network, real alerts or arbitrary code. |
| `gcloud logging buckets describe` | Configure and evaluate a bounded observability lesson; no network, real alerts or arbitrary code. |
| `gcloud logging buckets update` | Configure and evaluate a bounded observability lesson; no network, real alerts or arbitrary code. |
| `gcloud logging buckets delete` | Configure and evaluate a bounded observability lesson; no network, real alerts or arbitrary code. |
| `gcloud logging buckets undelete` | Configure and evaluate a bounded observability lesson; no network, real alerts or arbitrary code. |
| `gcloud logging views create` | Configure and evaluate a bounded observability lesson; no network, real alerts or arbitrary code. |
| `gcloud logging views describe` | Configure and evaluate a bounded observability lesson; no network, real alerts or arbitrary code. |
| `gcloud logging views update` | Configure and evaluate a bounded observability lesson; no network, real alerts or arbitrary code. |
| `gcloud logging views delete` | Configure and evaluate a bounded observability lesson; no network, real alerts or arbitrary code. |
| `gcloud logging views list` | Configure and evaluate a bounded observability lesson; no network, real alerts or arbitrary code. |
| `gcloud logging metrics list` | List metrics. |
| `gcloud logging metrics describe` | describe metrics. |
| `gcloud logging metrics delete` | delete metrics. |
| `gcloud logging metrics create` | create a user-defined counter metric (no real ingestion). |
| `gcloud logging metrics update` | update a user-defined counter metric (no real ingestion). |

### gcloud monitoring

| コマンド | 内容 |
|---|---|
| `gcloud monitoring channels create` | Configure and evaluate a bounded observability lesson; no network, real alerts or arbitrary code. |
| `gcloud monitoring channels list` | Configure and evaluate a bounded observability lesson; no network, real alerts or arbitrary code. |
| `gcloud monitoring channels describe` | Configure and evaluate a bounded observability lesson; no network, real alerts or arbitrary code. |
| `gcloud monitoring channels update` | Configure and evaluate a bounded observability lesson; no network, real alerts or arbitrary code. |
| `gcloud monitoring channels delete` | Configure and evaluate a bounded observability lesson; no network, real alerts or arbitrary code. |
| `gcloud monitoring metrics-scopes create` | Configure and evaluate a bounded observability lesson; no network, real alerts or arbitrary code. |
| `gcloud monitoring metrics-scopes describe` | Configure and evaluate a bounded observability lesson; no network, real alerts or arbitrary code. |
| `gcloud monitoring metrics-scopes list` | Configure and evaluate a bounded observability lesson; no network, real alerts or arbitrary code. |
| `gcloud monitoring policies update` | Configure and evaluate a bounded observability lesson; no network, real alerts or arbitrary code. |
| `gcloud monitoring dashboards update` | Configure and evaluate a bounded observability lesson; no network, real alerts or arbitrary code. |
| `gcloud monitoring uptime update` | Configure and evaluate a bounded observability lesson; no network, real alerts or arbitrary code. |
| `gcloud monitoring metrics-scopes delete` | Configure and evaluate a bounded observability lesson; no network, real alerts or arbitrary code. |
| `gcloud monitoring dashboards list` | List dashboards. |
| `gcloud monitoring dashboards describe` | describe dashboards. |
| `gcloud monitoring dashboards delete` | delete dashboards. |
| `gcloud monitoring policies list` | List alertPolicies. |
| `gcloud monitoring policies describe` | describe alertPolicies. |
| `gcloud monitoring policies delete` | delete alertPolicies. |
| `gcloud monitoring uptime list` | List uptimeCheckConfigs. |
| `gcloud monitoring uptime describe` | describe uptimeCheckConfigs. |
| `gcloud monitoring uptime delete` | delete uptimeCheckConfigs. |
| `gcloud monitoring dashboards create` | Create one single-series grid chart. JSON or cpu-dashboard.json; no real metric collection. |
| `gcloud monitoring policies create` | Create one metric threshold condition. Incidents and notifications are not executed. |
| `gcloud monitoring uptime create` | Configure a public URL uptime check (no network request or real probe). |

### gcloud deployment-manager

| コマンド | 内容 |
|---|---|
| `gcloud deployment-manager deployments create` | Create a deployment (sample config.yaml only). |
| `gcloud deployment-manager deployments list` | List deployments in a project. |
| `gcloud deployment-manager deployments describe` | Provide information about a deployment. |

## 解決はできるが未実装（0）

なし。
