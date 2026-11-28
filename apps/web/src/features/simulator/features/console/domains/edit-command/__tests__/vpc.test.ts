// @vitest-environment node
import { describe, expect, test } from "vitest";
import { run, session } from "@/engine/__tests__/setup";
import { Directions, FirewallActions, SubnetModes } from "@/engine/domains/compute";
import { World } from "@/engine/domains/world";
import {
  AddressCreateForm,
  deleteAddressCommand,
  deletePeeringCommand,
  FirewallEditForm,
  PeeringCreateForm,
  SubnetEditForm,
  VpcNetworkEditForm,
} from "@/features/simulator/features/console/domains/edit-command/vpc";
import { FirewallCreateForm } from "@/features/simulator/features/console/domains/equivalent-command";

const PROJECT = "ace-dev-01";

describe("FirewallCreateForm (拡張項目)", () => {
  test("スクリーンショット相当の IAP SSH ルール（ターゲットタグ + IPv4 範囲）を作成できる", () => {
    const line = FirewallCreateForm.toCommand(
      {
        ...FirewallCreateForm.create(),
        name: "allow-iap-ssh",
        network: "default",
        priority: "1000",
        direction: Directions.Ingress,
        action: FirewallActions.Allow,
        targetType: "tags",
        targetTags: "iap-gce",
        sourceFilter: "ip-ranges",
        sourceRanges: "35.235.240.0/20",
        protocolsMode: "specified",
        protocolsAndPorts: "tcp:22",
        enableLogging: true,
      },
      PROJECT,
    );
    expect(line).toBe(
      "gcloud compute firewall-rules create allow-iap-ssh --project=ace-dev-01 --network=default --direction=INGRESS --priority=1000 --allow=tcp:22 --source-ranges=35.235.240.0/20 --target-tags=iap-gce --enable-logging",
    );
    const next = run(session(), line);
    const created = World.firewallRulesOf(next.world, PROJECT).find(
      (r) => r.name === "allow-iap-ssh",
    );
    expect(created).toBeDefined();
    expect(created?.targetTags).toEqual(["iap-gce"]);
    expect(created?.sourceRanges).toEqual(["35.235.240.0/20"]);
    expect(created?.logging).toBe(true);
  });

  test("ソースタグ指定・全プロトコル・ターゲット「すべて」で作成できる", () => {
    const line = FirewallCreateForm.toCommand(
      {
        ...FirewallCreateForm.create(),
        name: "allow-from-web",
        targetType: "all",
        sourceFilter: "source-tags",
        sourceTags: "web-tier",
        protocolsMode: "all",
        disabled: true,
      },
      PROJECT,
    );
    expect(line).toContain("--allow=all");
    expect(line).toContain("--source-tags=web-tier");
    expect(line).not.toContain("--source-ranges");
    expect(line).not.toContain("--target-tags");
    expect(line).toContain("--disabled");

    const next = run(session(), line);
    const created = World.firewallRulesOf(next.world, PROJECT).find(
      (r) => r.name === "allow-from-web",
    );
    expect(created?.sourceTags).toEqual(["web-tier"]);
    expect(created?.sourceRanges).toEqual([]);
    expect(created?.targetTags).toEqual([]);
    expect(created?.disabled).toBe(true);
  });

  test("送信元フィルタがソースタグのとき空だとエラーになる", () => {
    const errors = FirewallCreateForm.collectErrors({
      ...FirewallCreateForm.create(),
      name: "bad-rule",
      sourceFilter: "source-tags",
      sourceTags: "",
    });
    expect(errors.sourceTags).toBeDefined();
  });
});

describe("FirewallEditForm", () => {
  test("変更した項目だけを update コマンドにし、CLI で反映される", () => {
    let s = run(
      session(),
      "gcloud compute firewall-rules create allow-app --project=ace-dev-01 --network=default --allow=tcp:80 --target-tags=web --source-ranges=0.0.0.0/0",
    );
    const rule = World.firewallRulesOf(s.world, PROJECT).find((r) => r.name === "allow-app");
    expect(rule).toBeDefined();
    if (rule === undefined) return;

    const form = {
      ...FirewallEditForm.fromRule(rule),
      priority: "500",
      targetType: "all" as const,
      sourceFilter: "source-tags" as const,
      sourceTags: "frontend",
      protocolsAndPorts: "tcp:8080",
      enableLogging: true,
      disabled: true,
    };
    expect(FirewallEditForm.hasChanges(form)).toBe(true);
    const line = FirewallEditForm.toCommand(form, PROJECT);
    expect(line).toContain("gcloud compute firewall-rules update allow-app");
    expect(line).toContain("--priority=500");
    expect(line).toContain('--target-tags=""');
    expect(line).toContain('--source-ranges=""');
    expect(line).toContain("--source-tags=frontend");
    expect(line).toContain("--allow=tcp:8080");
    expect(line).toContain("--enable-logging");
    expect(line).toContain("--disabled");

    s = run(s, line);
    const updated = World.firewallRulesOf(s.world, PROJECT).find((r) => r.name === "allow-app");
    expect(updated?.priority).toBe(500);
    expect(updated?.targetTags).toEqual([]);
    expect(updated?.sourceRanges).toEqual([]);
    expect(updated?.sourceTags).toEqual(["frontend"]);
    expect(updated?.logging).toBe(true);
    expect(updated?.disabled).toBe(true);
  });
});

describe("VpcNetworkEditForm / SubnetEditForm", () => {
  test("自動モードの VPC ネットワークをカスタムモードへ切り替え、ポリシー順も更新できる", () => {
    let s = run(
      session(),
      "gcloud compute networks create app-vpc --project=ace-dev-01 --subnet-mode=auto",
    );
    const network = World.networksOf(s.world, PROJECT).find((n) => n.name === "app-vpc");
    expect(network).toBeDefined();
    if (network === undefined) return;

    const steps = VpcNetworkEditForm.toSteps(
      {
        ...VpcNetworkEditForm.fromNetwork(network),
        switchToCustom: true,
        firewallPolicyOrder: "BEFORE_CLASSIC_FIREWALL",
      },
      PROJECT,
    );
    expect(steps).toHaveLength(2);
    for (const step of steps) {
      s = run(s, step.line);
    }
    const updated = World.networksOf(s.world, PROJECT).find((n) => n.name === "app-vpc");
    expect(updated?.subnetMode).toBe(SubnetModes.Custom);
    expect(updated?.firewallPolicyOrder).toBe("BEFORE_CLASSIC_FIREWALL");
  });

  test("サブネットの限定公開 Google アクセスとフローログを更新できる", () => {
    let s = run(
      session(),
      "gcloud compute networks create custom-vpc --project=ace-dev-01 --subnet-mode=custom",
    );
    s = run(
      s,
      "gcloud compute networks subnets create app-sub --project=ace-dev-01 --network=custom-vpc --region=asia-northeast1 --range=10.10.0.0/20",
    );
    const subnet = World.subnetsOf(s.world, PROJECT).find((sub) => sub.name === "app-sub");
    expect(subnet).toBeDefined();
    if (subnet === undefined) return;

    const line = SubnetEditForm.toCommand(
      {
        ...SubnetEditForm.fromSubnet(subnet),
        privateIpGoogleAccess: true,
        enableFlowLogs: true,
      },
      PROJECT,
    );
    s = run(s, line);
    const updated = World.subnetsOf(s.world, PROJECT).find((sub) => sub.name === "app-sub");
    expect(updated?.privateIpGoogleAccess).toBe(true);
    expect(updated?.flowLogs).toBe(true);
  });
});

describe("AddressCreateForm / PeeringCreateForm", () => {
  test("静的外部 IP アドレスを予約して解放できる", () => {
    const createCmd = AddressCreateForm.toCommand(
      { ...AddressCreateForm.create("asia-northeast1"), name: "web-ip", scope: "global" },
      PROJECT,
    );
    expect(createCmd).toContain("gcloud compute addresses create web-ip");
    expect(createCmd).toContain("--global");
    let s = run(session(), createCmd);
    const reserved = s.world.addresses.find((a) => a.name === "web-ip");
    expect(reserved).toBeDefined();
    if (reserved === undefined) return;

    s = run(s, deleteAddressCommand(reserved, PROJECT));
    expect(s.world.addresses.some((a) => a.name === "web-ip")).toBe(false);
  });

  test("VPC ネットワーク ピアリングを作成して削除できる", () => {
    let s = run(
      session(),
      "gcloud compute networks create vpc-a --project=ace-dev-01 --subnet-mode=custom",
    );
    s = run(s, "gcloud compute networks create vpc-b --project=ace-dev-01 --subnet-mode=custom");
    const createCmd = PeeringCreateForm.toCommand(
      {
        ...PeeringCreateForm.create({
          network: "vpc-a",
          peerProject: PROJECT,
          peerNetwork: "vpc-b",
        }),
        name: "a-to-b",
        exportCustomRoutes: true,
      },
      PROJECT,
    );
    expect(createCmd).toContain("gcloud compute networks peerings create a-to-b");
    expect(createCmd).toContain("--export-custom-routes");
    s = run(s, createCmd);
    const peering = s.world.peerings.find((p) => p.name === "a-to-b");
    expect(peering).toBeDefined();
    if (peering === undefined) return;

    s = run(s, deletePeeringCommand(peering, PROJECT));
    expect(s.world.peerings.some((p) => p.name === "a-to-b")).toBe(false);
  });
});
