// @vitest-environment node
import { expect, test } from "vitest";

import { run, session } from "@/engine/__tests__/setup";
import { World } from "@/engine/domains/world";
import {
  BucketCreateForm,
  BudgetCreateForm,
  FirewallCreateForm,
  IamGrantForm,
  RoleCreateForm,
  ServiceAccountCreateForm,
  VmAction,
  VmCreateForm,
} from "@/features/simulator/features/console/domains/equivalent-command";
import { Option } from "@/utils/Option";

const initialVm = VmCreateForm.initial({
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
  expect(VmCreateForm.validate({ ...initialVm, name: "Web_2" }).name).toContain(
    "Invalid value for field 'resource.name'",
  );
  expect(
    VmCreateForm.validate({ ...initialVm, name: "web-2", bootDiskSize: "ten" }).bootDiskSize,
  ).toContain("Expected a size");
  expect(VmCreateForm.isValid({ ...initialVm, name: "web-2" })).toBe(true);
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
    IamGrantForm.validate({ member: "dev@example.com", role: "roles/viewer" }).member,
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
      { ...FirewallCreateForm.initial(), name: "allow-http", targetTags: "http-server" },
      "ace-dev-01",
    ),
  ).toBe(
    "gcloud compute firewall-rules create allow-http --project=ace-dev-01 --network=default --direction=INGRESS --priority=1000 --allow=tcp:80 --source-ranges=0.0.0.0/0 --target-tags=http-server",
  );
  expect(
    FirewallCreateForm.toCommand(
      {
        ...FirewallCreateForm.initial(),
        name: "deny-all",
        action: "DENY",
        protocolsAndPorts: "all",
      },
      "ace-dev-01",
    ),
  ).toContain("--action=DENY --rules=all");
  expect(
    FirewallCreateForm.validate({
      ...FirewallCreateForm.initial(),
      name: "x",
      protocolsAndPorts: "http:80",
    }).protocolsAndPorts,
  ).toContain("Expected PROTOCOL");
  expect(
    BucketCreateForm.toCommand({ ...BucketCreateForm.initial(), name: "ace-logs" }, "ace-dev-01"),
  ).toBe(
    "gcloud storage buckets create gs://ace-logs --project=ace-dev-01 --location=ASIA-NORTHEAST1 --default-storage-class=STANDARD --uniform-bucket-level-access --public-access-prevention",
  );
  expect(
    BudgetCreateForm.toCommand(
      { ...BudgetCreateForm.initial(), displayName: "Dev budget", projectIds: ["ace-dev-01"] },
      "01AB2C-DEF345-6789AB",
    ),
  ).toBe(
    'gcloud billing budgets create --billing-account=01AB2C-DEF345-6789AB --display-name="Dev budget" --budget-amount=100000JPY --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1 --filter-projects=ace-dev-01',
  );
});
