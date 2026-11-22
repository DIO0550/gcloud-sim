// @vitest-environment node
import { expect, test } from "vitest";

import { run, session } from "@/engine/__tests__/setup";
import { World } from "@/engine/domains/world";
import {
  BucketCreateForm,
  BudgetCreateForm,
  ClusterCreateForm,
  clusterCredentialsCommand,
  DeleteCommand,
  DiskCreateForm,
  FieldErrors,
  FirewallCreateForm,
  IamGrantForm,
  ImageCreateForm,
  InstanceGroupCreateForm,
  InstanceTemplateCreateForm,
  RoleCreateForm,
  RunServiceCreateForm,
  ServiceAccountCreateForm,
  SnapshotCreateForm,
  SubnetCreateForm,
  VmAction,
  VmCreateForm,
} from "@/features/simulator/features/console/domains/equivalent-command";
import { Option } from "@/utils/Option";

const initialVm = VmCreateForm.create({
  zone: "asia-northeast1-a",
  serviceAccount: "481200000001-compute@developer.gserviceaccount.com",
});

test("VM 作成フォームの既定値は UI 案 2c の同等のコードになる", () => {
  expect(VmCreateForm.toCommand({ ...initialVm, name: "web-2" }, "ace-dev-01")).toBe(
    "gcloud compute instances create web-2 --project=ace-dev-01 --zone=asia-northeast1-a --machine-type=e2-small --provisioning-model=STANDARD --service-account=481200000001-compute@developer.gserviceaccount.com --scopes=default --image-family=debian-12 --image-project=debian-cloud --boot-disk-size=10GB --boot-disk-type=pd-balanced",
  );
});

test("タグ・Spot・外部 IP なし・cloud-platform はそれぞれのフラグになる", () => {
  const command = VmCreateForm.toCommand(
    {
      ...initialVm,
      name: "web-2",
      tags: "http-server, https-server",
      provisioningModel: "SPOT",
      externalIp: false,
      scopes: "cloud-platform",
    },
    "ace-dev-01",
  );
  expect(command).toContain("--tags=http-server,https-server");
  expect(command).toContain("--provisioning-model=SPOT");
  expect(command).toContain("--scopes=cloud-platform");
  expect(command).toMatch(/--no-address$/);
});

test("同等のコマンドは実際に CLI で通り、フォームと同じ VM ができる", () => {
  const s = run(
    session(),
    VmCreateForm.toCommand({ ...initialVm, name: "web-2", tags: "web" }, "ace-dev-01"),
  );
  const instance = Option.unwrap(
    World.findInstance(s.world, "ace-dev-01", "asia-northeast1-a", "web-2"),
  );
  expect(instance.machineType).toBe("e2-small");
  expect(instance.tags).toEqual(["web"]);
});

test("VM の名前・ディスクの綴りはフォーム側で検証し、送信できない", () => {
  expect(VmCreateForm.collectErrors({ ...initialVm, name: "Web_2" }).name).toContain(
    "Invalid value for field 'resource.name'",
  );
  expect(
    VmCreateForm.collectErrors({ ...initialVm, name: "web-2", bootDiskSize: "ten" }).bootDiskSize,
  ).toContain("Expected a size");
  expect(FieldErrors.isEmpty(VmCreateForm.collectErrors({ ...initialVm, name: "web-2" }))).toBe(
    true,
  );
});

test("VM の操作は状態で出し分け、削除は --quiet を付ける", () => {
  const s = run(session(), "gcloud compute instances create web-1 --zone=asia-northeast1-a");
  const instance = Option.unwrap(
    World.findInstance(s.world, "ace-dev-01", "asia-northeast1-a", "web-1"),
  );
  expect(VmAction.availableFor(instance)).toEqual(["stop", "suspend", "ssh", "delete"]);
  expect(VmAction.toCommand("delete", instance)).toBe(
    "gcloud compute instances delete web-1 --zone=asia-northeast1-a --project=ace-dev-01 --quiet",
  );
  expect(VmAction.toCommand("stop", instance)).toBe(
    "gcloud compute instances stop web-1 --zone=asia-northeast1-a --project=ace-dev-01",
  );
  const stopped = run(s, "gcloud compute instances stop web-1 --zone=asia-northeast1-a");
  expect(
    VmAction.availableFor(
      Option.unwrap(World.findInstance(stopped.world, "ace-dev-01", "asia-northeast1-a", "web-1")),
    ),
  ).toEqual(["start", "delete"]);
});

test("空白を含む値は引用され、CLI がそのまま読める", () => {
  const command = ServiceAccountCreateForm.toCommand(
    { accountId: "batch-sa", displayName: "Batch SA", description: "" },
    "ace-dev-01",
  );
  expect(command).toBe(
    'gcloud iam service-accounts create batch-sa --project=ace-dev-01 --display-name="Batch SA"',
  );
  const s = run(session(), command);
  expect(World.findServiceAccount(s.world, "batch-sa@ace-dev-01.iam.gserviceaccount.com")).toEqual(
    expect.objectContaining({ some: true }),
  );
});

test("IAM の付与と削除、ロール作成、ファイアウォール、バケット、予算のコマンド", () => {
  expect(
    IamGrantForm.toCommand({ member: "user:dev@example.com", role: "roles/viewer" }, "ace-dev-01"),
  ).toBe(
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:dev@example.com --role=roles/viewer",
  );
  expect(
    IamGrantForm.removeCommand(
      { member: "user:dev@example.com", role: "roles/viewer" },
      "ace-dev-01",
    ),
  ).toBe(
    "gcloud projects remove-iam-policy-binding ace-dev-01 --member=user:dev@example.com --role=roles/viewer",
  );
  expect(
    IamGrantForm.toCommand({ member: "dev@example.com", role: "roles/viewer" }, "ace-dev-01"),
  ).toBe(
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:dev@example.com --role=roles/viewer",
  );
  expect(
    IamGrantForm.toCommand(
      { member: "app@ace-dev-01.iam.gserviceaccount.com", role: "roles/viewer" },
      "ace-dev-01",
    ),
  ).toBe(
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=serviceAccount:app@ace-dev-01.iam.gserviceaccount.com --role=roles/viewer",
  );
  expect(
    IamGrantForm.collectErrors({ member: "not-an-email", role: "roles/viewer" }).member,
  ).toContain("Member must be of the form");
  expect(
    RoleCreateForm.toCommand(
      {
        roleId: "viewerPlus",
        title: "Viewer Plus",
        permissions: "compute.instances.list compute.instances.get",
      },
      "ace-dev-01",
    ),
  ).toBe(
    'gcloud iam roles create viewerPlus --project=ace-dev-01 --permissions=compute.instances.list,compute.instances.get --title="Viewer Plus"',
  );
  expect(
    FirewallCreateForm.toCommand(
      { ...FirewallCreateForm.create(), name: "allow-http", targetTags: "http-server" },
      "ace-dev-01",
    ),
  ).toBe(
    "gcloud compute firewall-rules create allow-http --project=ace-dev-01 --network=default --direction=INGRESS --priority=1000 --allow=tcp:80 --source-ranges=0.0.0.0/0 --target-tags=http-server",
  );
  expect(
    FirewallCreateForm.toCommand(
      {
        ...FirewallCreateForm.create(),
        name: "deny-egress-smtp",
        direction: "EGRESS",
        action: "DENY",
        protocolsAndPorts: "tcp:25",
      },
      "ace-dev-01",
    ),
  ).toContain(
    "--direction=EGRESS --priority=1000 --action=DENY --rules=tcp:25 --destination-ranges=0.0.0.0/0",
  );
  expect(
    FirewallCreateForm.toCommand(
      {
        ...FirewallCreateForm.create(),
        name: "deny-all",
        action: "DENY",
        protocolsAndPorts: "all",
      },
      "ace-dev-01",
    ),
  ).toContain("--action=DENY --rules=all");
  expect(
    FirewallCreateForm.collectErrors({
      ...FirewallCreateForm.create(),
      name: "x",
      protocolsAndPorts: "http:80",
    }).protocolsAndPorts,
  ).toContain("Expected PROTOCOL");
  expect(
    BucketCreateForm.toCommand({ ...BucketCreateForm.create(), name: "ace-logs" }, "ace-dev-01"),
  ).toBe(
    "gcloud storage buckets create gs://ace-logs --project=ace-dev-01 --location=ASIA-NORTHEAST1 --default-storage-class=STANDARD --uniform-bucket-level-access --public-access-prevention",
  );
  expect(
    BudgetCreateForm.toCommand(
      { ...BudgetCreateForm.create(), displayName: "Dev budget", projectIds: ["ace-dev-01"] },
      "01AB2C-DEF345-6789AB",
    ),
  ).toBe(
    'gcloud billing budgets create --billing-account=01AB2C-DEF345-6789AB --display-name="Dev budget" --budget-amount=100000JPY --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1 --filter-projects=projects/ace-dev-01',
  );
  expect(
    BudgetCreateForm.collectErrors({
      ...BudgetCreateForm.create(),
      displayName: "Empty thresholds",
      thresholds: [],
    }).thresholds,
  ).toBeDefined();
});

test("外部 IP のない VM への SSH は --tunnel-through-iap を付け、非現行バージョンがあるバケット削除は rm --recursive を使う", () => {
  const s = run(
    session(),
    "gcloud compute instances create private-vm --zone=asia-northeast1-a --no-address",
  );
  const instance = Option.unwrap(
    World.findInstance(s.world, "ace-dev-01", "asia-northeast1-a", "private-vm"),
  );
  expect(VmAction.toCommand("ssh", instance)).toBe(
    "gcloud compute ssh private-vm --zone=asia-northeast1-a --project=ace-dev-01 --tunnel-through-iap",
  );
  expect(
    DeleteCommand.bucket({ name: "ver-bucket", objectCount: 0, noncurrentCount: 2 }, "ace-dev-01"),
  ).toBe("gcloud storage rm --recursive gs://ver-bucket --project=ace-dev-01 --quiet");
  expect(
    DeleteCommand.bucket(
      { name: "empty-bucket", objectCount: 0, noncurrentCount: 0 },
      "ace-dev-01",
    ),
  ).toBe("gcloud storage buckets delete gs://empty-bucket --project=ace-dev-01 --quiet");
});

test("GKE（Autopilot / Standard）・Cloud Run・サブネットの作成コマンドが CLI でそのまま通る", () => {
  const autoCmd = ClusterCreateForm.toCommand(
    {
      ...ClusterCreateForm.create({ zone: "asia-northeast1-a", region: "asia-northeast1" }),
      name: "auto-cluster",
    },
    "ace-dev-01",
  );
  expect(autoCmd).toBe(
    "gcloud container clusters create-auto auto-cluster --project=ace-dev-01 --region=asia-northeast1 --release-channel=regular",
  );
  const stdCmd = ClusterCreateForm.toCommand(
    {
      ...ClusterCreateForm.create({ zone: "asia-northeast1-a", region: "asia-northeast1" }),
      mode: "standard",
      name: "std-cluster",
      numNodes: "2",
      enableNetworkPolicy: true,
      enableWorkloadIdentity: true,
    },
    "ace-dev-01",
  );
  expect(stdCmd).toContain("gcloud container clusters create std-cluster");
  expect(stdCmd).toContain("--enable-network-policy");
  expect(stdCmd).toContain("--workload-pool=ace-dev-01.svc.id.goog");
  expect(
    clusterCredentialsCommand({ name: "std-cluster", location: "asia-northeast1-a" }, "ace-dev-01"),
  ).toBe(
    "gcloud container clusters get-credentials std-cluster --zone=asia-northeast1-a --project=ace-dev-01",
  );

  let s = run(session(), "gcloud services enable container.googleapis.com run.googleapis.com");
  s = run(s, autoCmd);
  s = run(s, stdCmd);
  expect(World.clustersOf(s.world, "ace-dev-01").map((c) => c.name)).toEqual([
    "auto-cluster",
    "std-cluster",
  ]);

  const runCmd = RunServiceCreateForm.toCommand(
    { ...RunServiceCreateForm.create("asia-northeast1"), name: "hello-api" },
    "ace-dev-01",
  );
  s = run(s, runCmd);
  expect(World.runServicesOf(s.world, "ace-dev-01").map((r) => r.name)).toEqual(["hello-api"]);

  s = run(s, "gcloud compute networks create custom-vpc --subnet-mode=custom");
  const subnetCmd = SubnetCreateForm.toCommand(
    {
      ...SubnetCreateForm.create({ network: "custom-vpc", region: "asia-northeast1" }),
      name: "app-sub",
      privateIpGoogleAccess: true,
    },
    "ace-dev-01",
  );
  s = run(s, subnetCmd);
  expect(World.findSubnet(s.world, "ace-dev-01", "asia-northeast1", "app-sub")).toEqual(
    expect.objectContaining({ some: true }),
  );
});

test("Compute のテンプレート・MIG・ディスク・スナップショット・イメージ作成コマンドが CLI でそのまま通る", () => {
  let s = session();
  const tplCmd = InstanceTemplateCreateForm.toCommand(
    {
      ...InstanceTemplateCreateForm.create(),
      name: "web-tpl",
      tags: "http-server,https-server",
      scopes: "cloud-platform",
      startupScript: "#!/bin/bash; apt-get update",
      metadata: [{ key: "env", value: "prod" }],
    },
    "ace-dev-01",
  );
  expect(tplCmd).toContain("--scopes=cloud-platform");
  expect(tplCmd).toContain("--tags=http-server,https-server");
  expect(tplCmd).toContain('--metadata="startup-script=#!/bin/bash; apt-get update,env=prod"');
  s = run(s, tplCmd);
  const createdTpl = World.namedOf(s.world, "instanceTemplates", "ace-dev-01")[0];
  expect(createdTpl?.name).toBe("web-tpl");
  expect(createdTpl?.metadata).toEqual({
    "startup-script": "#!/bin/bash; apt-get update",
    env: "prod",
  });

  const migCmd = InstanceGroupCreateForm.toCommand(
    {
      ...InstanceGroupCreateForm.create({
        zone: "asia-northeast1-a",
        region: "asia-northeast1",
        template: "web-tpl",
      }),
      name: "web-mig",
      size: "2",
    },
    "ace-dev-01",
  );
  s = run(s, migCmd);
  expect(
    s.world.instanceGroups.filter((g) => g.projectId === "ace-dev-01").map((g) => g.name),
  ).toEqual(["web-mig"]);

  const diskCmd = DiskCreateForm.toCommand(
    { ...DiskCreateForm.create("asia-northeast1-a"), name: "data-disk", size: "50GB" },
    "ace-dev-01",
  );
  s = run(s, diskCmd);
  expect(World.disksOf(s.world, "ace-dev-01").map((d) => d.name)).toContain("data-disk");

  const snapCmd = SnapshotCreateForm.toCommand(
    { name: "data-snap", sourceDisk: "asia-northeast1-a/data-disk" },
    "ace-dev-01",
  );
  s = run(s, snapCmd);
  expect(World.diskSnapshotsOf(s.world, "ace-dev-01").map((sn) => sn.name)).toContain("data-snap");

  const imgCmd = ImageCreateForm.toCommand(
    {
      name: "data-img",
      sourceKind: "snapshot",
      sourceDisk: "",
      sourceSnapshot: "data-snap",
      family: "app-family",
    },
    "ace-dev-01",
  );
  s = run(s, imgCmd);
  expect(s.world.computeLab.images.map((i) => i.name)).toContain("data-img");

  const customImgTplCmd = InstanceTemplateCreateForm.toCommand(
    {
      ...InstanceTemplateCreateForm.create(),
      name: "custom-img-tpl",
      imageKind: "custom",
      customImage: "data-img",
    },
    "ace-dev-01",
  );
  expect(customImgTplCmd).toContain("--image=data-img");
  expect(customImgTplCmd).not.toContain("--image-family=");
  s = run(s, customImgTplCmd);
  expect(World.namedOf(s.world, "instanceTemplates", "ace-dev-01").map((t) => t.name)).toContain(
    "custom-img-tpl",
  );
});
