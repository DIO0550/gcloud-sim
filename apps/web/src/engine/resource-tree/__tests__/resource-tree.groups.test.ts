// @vitest-environment node
import { expect, test } from "vitest";

import { run, session } from "@/engine/__tests__/setup";
import {
  type ResourceGroup,
  ResourceGroups,
  type TreeLabel,
  TreeNode,
  TreeSelection,
} from "@/engine/resource-tree";
import { Option } from "@/utils/Option";

const labelKey = (label: TreeLabel): string =>
  label.kind === "text" ? label.text : `group:${label.group}`;
const labels = (nodes: readonly TreeNode[]): readonly string[] =>
  nodes.map((n) => labelKey(n.label));
const find = (nodes: readonly TreeNode[], key: string): TreeNode | undefined =>
  nodes.reduce<TreeNode | undefined>(
    (found, n) => found ?? (labelKey(n.label) === key ? n : find(n.children, key)),
    undefined,
  );
const groupKey = (group: ResourceGroup): string => `group:${group}`;
const projectGroups = (nodes: readonly TreeNode[]): readonly string[] =>
  labels(find(nodes, "ace-dev-01")?.children ?? []);

const zone = "--zone=asia-northeast1-a";

test("独立ディスクとスナップショットはディスクのグループに、ブートディスクは出ない", () => {
  const s = run(
    session(),
    `gcloud compute instances create web-1 ${zone}`,
    `gcloud compute disks create data-1 ${zone} --size=200GB`,
    `gcloud compute disks snapshot web-1 ${zone} --snapshot-names=snap-1`,
  );
  const disks = find(TreeNode.fromWorld(s.world), groupKey(ResourceGroups.Disks));
  expect(labels(disks?.children ?? [])).toEqual(["data-1", "snapshot: snap-1"]);
});

test("ロードバランサの部品と予約アドレスは 1 つのグループに種別の接頭辞付きで並ぶ", () => {
  const s = run(
    session(),
    "gcloud compute health-checks create hc --http --port=80",
    "gcloud compute backend-services create web-bes --global --load-balancing-scheme=EXTERNAL_MANAGED --health-checks=hc",
    "gcloud compute url-maps create web-map --global --default-service=web-bes",
    "gcloud compute target-http-proxies create web-proxy --global --url-map=web-map",
    "gcloud compute forwarding-rules create web-fr --global --load-balancing-scheme=EXTERNAL_MANAGED --target-http-proxy=web-proxy",
    "gcloud compute addresses create lb-ip --global",
  );
  const lb = find(TreeNode.fromWorld(s.world), groupKey(ResourceGroups.LoadBalancing));
  expect(labels(lb?.children ?? [])).toEqual([
    "urlMaps: web-map",
    "targetHttpProxies: web-proxy",
    "hc: hc",
    "bes: web-bes",
    "fr: web-fr",
    "ip: lb-ip",
  ]);
});

test("ネットワークの下にはファイアウォール・サブネット・ルータがその順で出る（UI 案 2a）", () => {
  const s = run(
    session(),
    "gcloud compute networks create vpc-a --subnet-mode=custom",
    "gcloud compute networks subnets create sub-a --network=vpc-a --range=10.10.0.0/24 --region=asia-northeast1",
    "gcloud compute firewall-rules create vpc-a-ssh --network=vpc-a --allow=tcp:22",
    "gcloud compute routers create nat-a --network=vpc-a --region=asia-northeast1",
  );
  const network = find(TreeNode.fromWorld(s.world), "vpc-a");
  expect(labels(network?.children ?? [])).toEqual([
    "fw: vpc-a-ssh",
    "subnet: sub-a (asia-northeast1)",
    "router: nat-a",
  ]);
});

test("クラスタの下にはノードプールと kubectl で作った Deployment / Service が出る", () => {
  const s = run(
    session(),
    "gcloud services enable container.googleapis.com",
    `gcloud container clusters create app ${zone} --quiet`,
    `gcloud container clusters get-credentials app ${zone}`,
    "kubectl apply -f deployment.yaml",
    "kubectl apply -f service.yaml",
  );
  const cluster = find(TreeNode.fromWorld(s.world), "app");
  expect(labels(cluster?.children ?? [])).toEqual([
    "pool: default-pool",
    "sc: standard-rwo",
    "sc: premium-rwo",
    "deploy: web",
    "svc: web",
  ]);
  const autopilot = run(
    session(),
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create-auto ap --region=asia-northeast1 --quiet",
  );
  expect(labels(find(TreeNode.fromWorld(autopilot.world), "ap")?.children ?? [])).toEqual([
    "sc: standard-rwo",
    "sc: premium-rwo",
  ]);
});

test("Pub/Sub のトピックの下にサブスクリプションが、請求アカウントの下に予算が出る", () => {
  const s = run(
    session(),
    "gcloud services enable pubsub.googleapis.com",
    "gcloud pubsub topics create orders",
    "gcloud pubsub subscriptions create orders-sub --topic=orders",
    "gcloud billing budgets create --billing-account=01AB2C-DEF345-6789AB --display-name=dev --budget-amount=100000JPY",
  );
  const tree = TreeNode.fromWorld(s.world);
  expect(labels(find(tree, "orders")?.children ?? [])).toEqual(["sub: orders-sub"]);
  expect(labels(find(tree, "01AB2C-DEF345-6789AB")?.children ?? [])).toEqual(["budget: dev"]);
});

test("App Engine はアプリ 1 つの下にサービス/バージョンが並び、無いプロジェクトにはグループが無い", () => {
  const s = run(
    session(),
    "gcloud services enable appengine.googleapis.com",
    "gcloud app deploy app.yaml --region=asia-northeast1 --quiet",
  );
  const app = find(TreeNode.fromWorld(s.world), groupKey(ResourceGroups.AppEngine));
  expect(labels(app?.children ?? [])).toEqual(["ace-dev-01 (asia-northeast1)"]);
  expect(labels(app?.children[0]?.children ?? [])).toHaveLength(1);
  expect(projectGroups(TreeNode.fromWorld(session().world))).not.toContain(
    groupKey(ResourceGroups.AppEngine),
  );
});

test("カスタムロールはロールのグループに ID で出る", () => {
  const s = run(
    session(),
    "gcloud iam roles create vmViewer --project=ace-dev-01 --title=VMViewer --permissions=compute.instances.get,compute.instances.list",
  );
  const roles = find(TreeNode.fromWorld(s.world), groupKey(ResourceGroups.Roles));
  expect(labels(roles?.children ?? [])).toEqual(["vmViewer"]);
  expect(roles?.children[0]?.selection).toEqual(
    Option.some({ kind: "custom-role", projectId: "ace-dev-01", roleId: "vmViewer" }),
  );
});

test("describe コマンドは置き場のフラグを種別ごとに付ける", () => {
  const p = "ace-dev-01";
  expect(
    TreeSelection.describeCommand({
      kind: "disk",
      projectId: p,
      zone: "asia-northeast1-a",
      name: "d",
    }),
  ).toEqual(Option.some("gcloud compute disks describe d --zone=asia-northeast1-a"));
  expect(
    TreeSelection.describeCommand({
      kind: "instance-group",
      projectId: p,
      location: "asia-northeast1",
      name: "g",
    }),
  ).toEqual(
    Option.some("gcloud compute instance-groups managed describe g --region=asia-northeast1"),
  );
  expect(
    TreeSelection.describeCommand({
      kind: "address",
      projectId: p,
      region: Option.none,
      name: "a",
    }),
  ).toEqual(Option.some("gcloud compute addresses describe a --global"));
  expect(
    TreeSelection.describeCommand({
      kind: "backend-service",
      projectId: p,
      scope: { kind: "region", region: "us-central1" },
      name: "b",
    }),
  ).toEqual(Option.some("gcloud compute backend-services describe b --region=us-central1"));
  expect(
    TreeSelection.describeCommand({
      kind: "kube-deployment",
      projectId: p,
      cluster: "c",
      name: "web",
    }),
  ).toEqual(Option.some("kubectl describe deployment web --namespace=default"));
  expect(
    TreeSelection.describeCommand({ kind: "budget", billingAccountId: "A", id: "x-budget" }),
  ).toEqual(Option.some("gcloud billing budgets describe x-budget --billing-account=A"));
  expect(
    TreeSelection.describeCommand({
      kind: "app-version",
      projectId: p,
      service: "default",
      id: "v1",
    }),
  ).toEqual(Option.none);
});
