// @vitest-environment node
import { expect, test } from "vitest";
import { run, session } from "@/engine/__tests__/setup";
import { World } from "@/engine/domains/world";
import { NodePoolCreateForm } from "@/features/simulator/features/console/domains/edit-command/containers";
import { FieldErrors } from "@/features/simulator/features/console/domains/equivalent-command";
import { Option } from "@/utils/Option";

const projectId = "ace-dev-01";

test("NodePoolCreateForm のバリデーションとコマンド生成が正しい", () => {
  const base = NodePoolCreateForm.create({ name: "std-1", location: "asia-northeast1-a" });

  expect(NodePoolCreateForm.collectErrors(base).name).toBeDefined();
  expect(NodePoolCreateForm.collectErrors({ ...base, name: "Bad_Name" }).name).toBeDefined();
  expect(
    NodePoolCreateForm.collectErrors({ ...base, name: "pool-a", numNodes: "-1" }).numNodes,
  ).toBeDefined();
  expect(
    NodePoolCreateForm.collectErrors({
      ...base,
      name: "pool-a",
      enableAutoscaling: true,
      minNodes: "5",
      maxNodes: "2",
    }).maxNodes,
  ).toContain("最小ノード数以上");

  const valid: NodePoolCreateForm = {
    ...base,
    name: "high-mem",
    machineType: "e2-standard-4",
    numNodes: "2",
  };
  expect(FieldErrors.isEmpty(NodePoolCreateForm.collectErrors(valid))).toBe(true);
  expect(NodePoolCreateForm.toCommand(valid, projectId)).toBe(
    "gcloud container node-pools create high-mem --cluster=std-1 --zone=asia-northeast1-a --project=ace-dev-01 --machine-type=e2-standard-4 --num-nodes=2",
  );

  const autoscaled: NodePoolCreateForm = {
    ...valid,
    enableAutoscaling: true,
    minNodes: "1",
    maxNodes: "4",
  };
  expect(FieldErrors.isEmpty(NodePoolCreateForm.collectErrors(autoscaled))).toBe(true);
  expect(NodePoolCreateForm.toCommand(autoscaled, projectId)).toBe(
    "gcloud container node-pools create high-mem --cluster=std-1 --zone=asia-northeast1-a --project=ace-dev-01 --machine-type=e2-standard-4 --num-nodes=2 --enable-autoscaling --min-nodes=1 --max-nodes=4",
  );

  expect(
    NodePoolCreateForm.deleteCommand(
      { name: "std-1", location: "asia-northeast1-a" },
      "high-mem",
      projectId,
    ),
  ).toBe(
    "gcloud container node-pools delete high-mem --cluster=std-1 --zone=asia-northeast1-a --project=ace-dev-01 --quiet",
  );
});

test("GKE ノードプールの追加・削除（ゾーン / リージョン）が CLI エンジンでそのまま通る", () => {
  let s = run(
    session(),
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create std-zonal --zone=asia-northeast1-a --num-nodes=2",
  );
  const zonalCluster = Option.unwrap(World.findCluster(s.world, projectId, "std-zonal"));

  // 1. オートスケーリング無しで追加
  s = run(
    s,
    NodePoolCreateForm.toCommand(
      {
        ...NodePoolCreateForm.create(zonalCluster),
        name: "high-mem",
        machineType: "e2-standard-4",
        numNodes: "2",
      },
      projectId,
    ),
  );
  // 2. オートスケーリング有りで追加
  s = run(
    s,
    NodePoolCreateForm.toCommand(
      {
        ...NodePoolCreateForm.create(zonalCluster),
        name: "auto-pool",
        machineType: "e2-medium",
        numNodes: "1",
        enableAutoscaling: true,
        minNodes: "1",
        maxNodes: "5",
      },
      projectId,
    ),
  );

  const poolsAfterCreate = World.nodePoolsOf(s.world, zonalCluster);
  expect(poolsAfterCreate.map((p) => p.name)).toEqual(["default-pool", "high-mem", "auto-pool"]);
  const highMem = poolsAfterCreate.find((p) => p.name === "high-mem");
  expect(highMem?.machineType).toBe("e2-standard-4");
  expect(highMem?.nodeCount).toBe(2);
  expect(highMem?.autoscaling).toEqual(Option.none);
  const autoPool = poolsAfterCreate.find((p) => p.name === "auto-pool");
  expect(autoPool?.autoscaling).toEqual(Option.some({ minNodes: 1, maxNodes: 5 }));

  // 3. 削除
  s = run(s, NodePoolCreateForm.deleteCommand(zonalCluster, "high-mem", projectId));
  expect(World.nodePoolsOf(s.world, zonalCluster).map((p) => p.name)).toEqual([
    "default-pool",
    "auto-pool",
  ]);

  // 4. リージョン Standard クラスタ（--region フラグ）
  s = run(s, "gcloud container clusters create std-reg --region=asia-northeast1 --num-nodes=1");
  const regCluster = Option.unwrap(World.findCluster(s.world, projectId, "std-reg"));
  const regCreateCmd = NodePoolCreateForm.toCommand(
    {
      ...NodePoolCreateForm.create(regCluster),
      name: "reg-pool",
      machineType: "e2-small",
      numNodes: "1",
    },
    projectId,
  );
  expect(regCreateCmd).toContain("--region=asia-northeast1");
  s = run(s, regCreateCmd);
  expect(World.nodePoolsOf(s.world, regCluster).map((p) => p.name)).toEqual([
    "default-pool",
    "reg-pool",
  ]);

  s = run(s, NodePoolCreateForm.deleteCommand(regCluster, "reg-pool", projectId));
  expect(World.nodePoolsOf(s.world, regCluster).map((p) => p.name)).toEqual(["default-pool"]);
});
