import { MasterVersion, NextMasterVersion } from "@/engine/domains/managed-services";
import { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { Option } from "@/utils/Option";

export type GkeNodePoolAssertion = Readonly<{ kind: "gkeNodePoolUpgraded" | "gkeNodePoolScaled" }>;
const setup = [
  { kind: "setPrincipal", principal: F.owner },
  { kind: "setProject", projectId: F.devProjectId },
] as const;
export const GkeNodePoolMissions: readonly Mission[] = [
  {
    id: "m-gke-028",
    domain: "運用の維持",
    title: "制御プレーンとノードプールを別々に更新する",
    setup,
    description:
      "ops-gkeにappsプールを追加し、appsだけを4→3ノードに変更します。制御プレーンを1.32.2-gke.1182000へ更新後、appsのノードを同じ版へ更新してください。default-poolは2ノード・元の1.31.5-gke.1068000を保ちます。実ノード置換・Pod退避は再現しません。",
    hints: [
      "gcloud services enable container.googleapis.com → gcloud container clusters create ops-gke --zone=us-central1-a --num-nodes=2",
      "gcloud container node-pools create apps --cluster=ops-gke --zone=us-central1-a --machine-type=e2-standard-4 --disk-size=200 --num-nodes=4 → gcloud container node-pools list --cluster=ops-gke --zone=us-central1-a",
      "gcloud container clusters resize ops-gke --zone=us-central1-a --node-pool=apps --num-nodes=3 --quiet。default-poolの数も確認します。",
      "gcloud container clusters upgrade ops-gke --zone=us-central1-a --master --quiet。制御プレーンの更新だけでは既存ノードの版は変わりません。",
      "gcloud container clusters upgrade ops-gke --zone=us-central1-a --node-pool=apps --quiet → gcloud container node-pools describe apps --cluster=ops-gke --zone=us-central1-a",
    ],
    assertions: [{ kind: "gkeNodePoolUpgraded" }],
  },
  {
    id: "m-gke-029",
    domain: "運用の維持",
    title: "ノード自動スケールの上限と管理設定を確認する",
    setup,
    description:
      "autoscale-gkeのappsを自動修復・自動更新が有効なプールへ直し、自動スケールを最小1・最大4に設定します。必要ノード数10を明示して1回評価し、上限4で止まることを確認してください。設定だけでは完了しません。実Pod配置・負荷測定・定期処理は再現しません。",
    hints: [
      "gcloud services enable container.googleapis.com → gcloud container clusters create autoscale-gke --zone=us-central1-a --num-nodes=2",
      "gcloud container node-pools create apps --cluster=autoscale-gke --zone=us-central1-a --num-nodes=1 --no-enable-autorepair --no-enable-autoupgrade → gcloud container node-pools describe apps --cluster=autoscale-gke --zone=us-central1-a",
      "gcloud container node-pools update apps --cluster=autoscale-gke --zone=us-central1-a --enable-autorepair --enable-autoupgrade",
      "gcloud container node-pools update apps --cluster=autoscale-gke --zone=us-central1-a --enable-autoscaling --min-nodes=1 --max-nodes=4。設定時点ではノード数は変わりません。",
      "sim gke autoscale-nodes apps --cluster=autoscale-gke --zone=us-central1-a --required-nodes=10 → gcloud container node-pools describe apps --cluster=autoscale-gke --zone=us-central1-a。4ノードへの変化と評価記録を確認します。",
    ],
    assertions: [{ kind: "gkeNodePoolScaled" }],
  },
];

export const gkeNodePoolSatisfied = (world: World, scaling: boolean): boolean => {
  const cluster = world.clusters.find(
    (c) => c.projectId === F.devProjectId && c.name === (scaling ? "autoscale-gke" : "ops-gke"),
  );
  if (!cluster || cluster.autopilot || cluster.location !== "us-central1-a") return false;
  const pools = World.nodePoolsOf(world, cluster);
  const pool = pools.find((p) => p.name === "apps");
  const base = pools.find((p) => p.name === "default-pool");
  if (
    !pool ||
    !base ||
    base.nodeCount !== 2 ||
    base.version !== MasterVersion ||
    !pool.autoRepair ||
    !pool.autoUpgrade
  )
    return false;
  if (!scaling)
    return (
      cluster.currentMasterVersion === NextMasterVersion &&
      pool.version === NextMasterVersion &&
      pool.nodeCount === 3 &&
      pool.machineType === "e2-standard-4" &&
      pool.diskSizeGb === 200
    );
  return (
    Option.isSome(pool.autoscaling) &&
    pool.autoscaling.value.minNodes === 1 &&
    pool.autoscaling.value.maxNodes === 4 &&
    pool.nodeCount === 4 &&
    Option.isSome(pool.lastScale) &&
    pool.lastScale.value.requiredNodes === 10 &&
    pool.lastScale.value.afterNodes === 4
  );
};
