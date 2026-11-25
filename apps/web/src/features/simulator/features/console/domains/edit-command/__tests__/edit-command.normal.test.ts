// @vitest-environment node
import { expect, test } from "vitest";

import { run, session } from "@/engine/__tests__/setup";
import {
  defaultConfig,
  findDeployment,
  latestRevision,
} from "@/engine/domains/serverless-lab/model";
import { protectionFor } from "@/engine/domains/storage-lab/model";
import { World } from "@/engine/domains/world";
import {
  ClusterEditForm,
  RunServiceEditForm,
} from "@/features/simulator/features/console/domains/edit-command/containers";
import { BucketEditForm } from "@/features/simulator/features/console/domains/edit-command/storage";
import { FieldErrors } from "@/features/simulator/features/console/domains/equivalent-command";
import { Option } from "@/utils/Option";

const projectId = "ace-dev-01";

// --- Cloud Storage バケット編集 ---

test("バケット編集フォームは変更が無ければ空ステップを返し、変更した項目だけフラグを出す", () => {
  const created = run(
    session(),
    "gcloud storage buckets create gs://edit-b1 --location=ASIA-NORTHEAST1 --default-storage-class=STANDARD --uniform-bucket-level-access --public-access-prevention",
  );
  const bucket = Option.unwrap(World.findBucket(created.world, "edit-b1"));
  const initial = BucketEditForm.fromBucket(bucket, protectionFor(created.world, bucket.name));

  expect(BucketEditForm.toSteps(initial, projectId)).toEqual([]);
  expect(BucketEditForm.toCommand(initial, projectId)).toBe("# 変更された項目がありません");

  const edited: BucketEditForm = {
    ...initial,
    storageClass: "NEARLINE",
    versioning: true,
    uniformAccess: false,
    publicAccessPrevention: false,
    softDeleteDuration: "30d",
    retentionPeriod: "14d",
  };
  expect(FieldErrors.isEmpty(BucketEditForm.collectErrors(edited))).toBe(true);
  const steps = BucketEditForm.toSteps(edited, projectId);
  expect(steps).toHaveLength(1);
  expect(steps[0]?.line).toBe(
    "gcloud storage buckets update gs://edit-b1 --project=ace-dev-01 --default-storage-class=NEARLINE --no-uniform-bucket-level-access --no-public-access-prevention --versioning --soft-delete-duration=30d --retention-period=14d",
  );

  // 実際にエンジンで実行して反映を確認する
  const updated = run(created, ...steps.map((s) => s.line));
  const after = Option.unwrap(World.findBucket(updated.world, "edit-b1"));
  const afterProtection = protectionFor(updated.world, after.name);
  expect(after.storageClass).toBe("NEARLINE");
  expect(after.versioning).toBe(true);
  expect(after.uniformBucketLevelAccess).toBe(false);
  expect(after.publicAccessPrevention).toBe(false);
  expect(afterProtection.softDelete).toBe(30 * 86400);
  expect(afterProtection.retention).toBe(14 * 86400);

  // 保持期間を空欄にすると --clear-retention-period になり解除できる
  const clearedForm: BucketEditForm = {
    ...BucketEditForm.fromBucket(after, afterProtection),
    retentionPeriod: "",
    versioning: false,
  };
  const clearSteps = BucketEditForm.toSteps(clearedForm, projectId);
  expect(clearSteps[0]?.line).toBe(
    "gcloud storage buckets update gs://edit-b1 --project=ace-dev-01 --no-versioning --clear-retention-period",
  );
  const cleared = run(updated, ...clearSteps.map((s) => s.line));
  expect(Option.unwrap(World.findBucket(cleared.world, "edit-b1")).versioning).toBe(false);
  expect(protectionFor(cleared.world, "edit-b1").retention).toBe(0);
});

test("バケット編集フォームの論理削除・ロック済み保持ポリシーの検証が効く", () => {
  const base = BucketEditForm.empty();
  expect(
    BucketEditForm.collectErrors({ ...base, softDeleteDuration: "3d" }).softDeleteDuration,
  ).toBeDefined();
  expect(
    BucketEditForm.collectErrors({ ...base, softDeleteDuration: "90d" }).softDeleteDuration,
  ).toBeDefined();
  expect(
    BucketEditForm.collectErrors({ ...base, softDeleteDuration: "0" }).softDeleteDuration,
  ).toBeUndefined();
  expect(
    BucketEditForm.collectErrors({ ...base, retentionPeriod: "abc" }).retentionPeriod,
  ).toBeDefined();

  const locked: BucketEditForm = {
    ...base,
    retentionPeriod: "10d",
    retentionLocked: true,
    original: { ...base.original, retentionSeconds: 10 * 86400 },
  };
  expect(
    BucketEditForm.collectErrors({ ...locked, retentionPeriod: "" }).retentionPeriod,
  ).toContain("解除できません");
  expect(
    BucketEditForm.collectErrors({ ...locked, retentionPeriod: "5d" }).retentionPeriod,
  ).toContain("短縮できません");
  expect(
    BucketEditForm.collectErrors({ ...locked, retentionPeriod: "20d" }).retentionPeriod,
  ).toBeUndefined();
});

// --- GKE クラスタ編集 ---

test("GKE Standard クラスタ編集は変更分だけコマンド列を作りエンジンで反映できる", () => {
  const created = run(
    session(),
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create std-1 --zone=asia-northeast1-a --num-nodes=3",
  );
  const cluster = Option.unwrap(World.findCluster(created.world, projectId, "std-1"));
  const pool = Option.fromNullable(World.nodePoolsOf(created.world, cluster)[0]);
  const initial = ClusterEditForm.fromCluster(cluster, pool);

  expect(ClusterEditForm.toSteps(initial, projectId)).toEqual([]);

  // 1) クラスタ設定 + オートスケーリング有効化 + 管理設定（自動修復オフ）を同時に保存
  const step1Form: ClusterEditForm = {
    ...initial,
    enableAuthorizedNetworks: true,
    authorizedNetworks: "203.0.113.0/24, 198.51.100.0/24",
    enableWorkloadIdentity: true,
    enableVpa: true,
    enableAutoscaling: true,
    minNodes: "1",
    maxNodes: "5",
    autoRepair: false,
  };
  expect(FieldErrors.isEmpty(ClusterEditForm.collectErrors(step1Form))).toBe(true);
  const steps1 = ClusterEditForm.toSteps(step1Form, projectId);
  expect(steps1.map((s) => s.line)).toEqual([
    "gcloud container clusters update std-1 --zone=asia-northeast1-a --project=ace-dev-01 --enable-master-authorized-networks --master-authorized-networks=203.0.113.0/24,198.51.100.0/24 --workload-pool=ace-dev-01.svc.id.goog --enable-vertical-pod-autoscaling",
    "gcloud container node-pools update default-pool --cluster=std-1 --zone=asia-northeast1-a --project=ace-dev-01 --enable-autoscaling --min-nodes=1 --max-nodes=5",
    "gcloud container node-pools update default-pool --cluster=std-1 --zone=asia-northeast1-a --project=ace-dev-01 --no-enable-autorepair",
  ]);

  const after1 = run(created, ...steps1.map((s) => s.line));
  const c1 = Option.unwrap(World.findCluster(after1.world, projectId, "std-1"));
  const p1 = Option.unwrap(Option.fromNullable(World.nodePoolsOf(after1.world, c1)[0]));
  expect(c1.workloadPool).toBe("ace-dev-01.svc.id.goog");
  expect(c1.verticalPodAutoscaling).toBe(true);
  expect(c1.controlPlane.authorizedNetworks).toEqual(
    Option.some(["203.0.113.0/24", "198.51.100.0/24"]),
  );
  expect(p1.autoscaling).toEqual(Option.some({ minNodes: 1, maxNodes: 5 }));
  expect(p1.autoRepair).toBe(false);

  // 2) オートスケーリング無効化と同時に手動リサイズ + Workload Identity / VPA 無効化
  const step2Form: ClusterEditForm = {
    ...ClusterEditForm.fromCluster(c1, Option.some(p1)),
    enableAutoscaling: false,
    numNodes: "2",
    enableWorkloadIdentity: false,
    enableVpa: false,
    enableAuthorizedNetworks: false,
  };
  const steps2 = ClusterEditForm.toSteps(step2Form, projectId);
  expect(steps2.map((s) => s.line)).toEqual([
    'gcloud container clusters update std-1 --zone=asia-northeast1-a --project=ace-dev-01 --no-enable-master-authorized-networks --workload-pool="" --no-enable-vertical-pod-autoscaling',
    "gcloud container node-pools update default-pool --cluster=std-1 --zone=asia-northeast1-a --project=ace-dev-01 --no-enable-autoscaling",
    "gcloud container clusters resize std-1 --zone=asia-northeast1-a --project=ace-dev-01 --node-pool=default-pool --num-nodes=2 --quiet",
  ]);

  const after2 = run(after1, ...steps2.map((s) => s.line));
  const c2 = Option.unwrap(World.findCluster(after2.world, projectId, "std-1"));
  const p2 = Option.unwrap(Option.fromNullable(World.nodePoolsOf(after2.world, c2)[0]));
  expect(c2.workloadPool).toBe("");
  expect(c2.verticalPodAutoscaling).toBe(false);
  expect(c2.controlPlane.authorizedNetworks).toEqual(Option.none);
  expect(p2.autoscaling).toEqual(Option.none);
  expect(p2.nodeCount).toBe(2);
  expect(c2.nodeCount).toBe(2);
});

test("GKE Autopilot クラスタは承認済みネットワークのみ --region で更新できる", () => {
  const created = run(
    session(),
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create-auto auto-1 --region=asia-northeast1",
  );
  const cluster = Option.unwrap(World.findCluster(created.world, projectId, "auto-1"));
  const initial = ClusterEditForm.fromCluster(cluster, Option.none);
  const edited: ClusterEditForm = {
    ...initial,
    enableAuthorizedNetworks: true,
    authorizedNetworks: "198.51.100.0/24",
  };
  const steps = ClusterEditForm.toSteps(edited, projectId);
  expect(steps).toHaveLength(1);
  expect(steps[0]?.line).toBe(
    "gcloud container clusters update auto-1 --region=asia-northeast1 --project=ace-dev-01 --enable-master-authorized-networks --master-authorized-networks=198.51.100.0/24",
  );
  const updated = run(created, ...steps.map((s) => s.line));
  const after = Option.unwrap(World.findCluster(updated.world, projectId, "auto-1"));
  expect(after.controlPlane.authorizedNetworks).toEqual(Option.some(["198.51.100.0/24"]));
});

test("GKE クラスタ編集フォームの検証が不正な CIDR や min/max を弾く", () => {
  const base: ClusterEditForm = {
    ...ClusterEditForm.empty(),
    poolName: "default-pool",
  };
  expect(
    ClusterEditForm.collectErrors({
      ...base,
      enableAuthorizedNetworks: true,
      authorizedNetworks: "not-a-cidr",
    }).authorizedNetworks,
  ).toBeDefined();
  expect(
    ClusterEditForm.collectErrors({
      ...base,
      enableAutoscaling: true,
      minNodes: "5",
      maxNodes: "2",
    }).maxNodes,
  ).toContain("最小ノード数以上");
  expect(
    ClusterEditForm.collectErrors({ ...base, enableAutoscaling: false, numNodes: "-1" }).numNodes,
  ).toBeDefined();
});

// --- Cloud Run サービス編集 ---

test("Cloud Run サービス編集は変更分だけ services update と IAM バインディングを発行しエンジンで反映できる", () => {
  const created = run(
    session(),
    "gcloud services enable run.googleapis.com",
    "gcloud run deploy web-api --image=us-docker.pkg.dev/cloudrun/container/hello --region=asia-northeast1 --allow-unauthenticated",
  );
  const service = Option.unwrap(World.findRunService(created.world, projectId, "web-api"));
  const deployment = findDeployment(
    created.world,
    { projectId, region: service.region, name: service.name },
    "run",
  );
  const config =
    deployment !== undefined
      ? latestRevision(deployment).config
      : defaultConfig("481200000001-compute@developer.gserviceaccount.com");
  const initial = RunServiceEditForm.fromService(service, config);

  expect(RunServiceEditForm.toSteps(initial, projectId)).toEqual([]);

  const edited: RunServiceEditForm = {
    ...initial,
    image: "us-docker.pkg.dev/cloudrun/container/hello:v2",
    cpu: "2",
    memory: "1Gi",
    minInstances: "1",
    maxInstances: "20",
    concurrency: "40",
    timeout: "120",
    ingress: "internal",
    envVars: "APP_ENV=prod, LOG_LEVEL=info",
    allowUnauthenticated: false,
  };
  expect(FieldErrors.isEmpty(RunServiceEditForm.collectErrors(edited))).toBe(true);
  const steps = RunServiceEditForm.toSteps(edited, projectId);
  expect(steps.map((s) => s.line)).toEqual([
    "gcloud run services update web-api --region=asia-northeast1 --project=ace-dev-01 --image=us-docker.pkg.dev/cloudrun/container/hello:v2 --cpu=2 --memory=1Gi --min-instances=1 --max-instances=20 --concurrency=40 --timeout=120 --ingress=internal --set-env-vars=APP_ENV=prod,LOG_LEVEL=info",
    "gcloud run services remove-iam-policy-binding web-api --region=asia-northeast1 --project=ace-dev-01 --member=allUsers --role=roles/run.invoker",
  ]);

  const updated = run(created, ...steps.map((s) => s.line));
  const afterService = Option.unwrap(World.findRunService(updated.world, projectId, "web-api"));
  const afterDep = findDeployment(
    updated.world,
    { projectId, region: afterService.region, name: afterService.name },
    "run",
  );
  expect(afterService.image).toBe("us-docker.pkg.dev/cloudrun/container/hello:v2");
  expect(afterService.allowUnauthenticated).toBe(false);
  expect(afterDep).toBeDefined();
  if (afterDep !== undefined) {
    const rev = latestRevision(afterDep);
    expect(rev.config.cpu).toBe(2);
    expect(rev.config.memoryMb).toBe(1024);
    expect(rev.config.minInstances).toBe(1);
    expect(rev.config.maxInstances).toBe(20);
    expect(rev.config.concurrency).toBe(40);
    expect(rev.config.timeoutSeconds).toBe(120);
    expect(rev.config.ingress).toBe("internal");
    expect(rev.config.env).toEqual({ APP_ENV: "prod", LOG_LEVEL: "info" });

    // 環境変数をすべて消して認証だけ再度許可する
    const step2Form: RunServiceEditForm = {
      ...RunServiceEditForm.fromService(afterService, rev.config),
      envVars: "",
      allowUnauthenticated: true,
    };
    const steps2 = RunServiceEditForm.toSteps(step2Form, projectId);
    expect(steps2.map((s) => s.line)).toEqual([
      "gcloud run services update web-api --region=asia-northeast1 --project=ace-dev-01 --remove-env-vars=APP_ENV,LOG_LEVEL",
      "gcloud run services add-iam-policy-binding web-api --region=asia-northeast1 --project=ace-dev-01 --member=allUsers --role=roles/run.invoker",
    ]);
    const cleared = run(updated, ...steps2.map((s) => s.line));
    const finalService = Option.unwrap(World.findRunService(cleared.world, projectId, "web-api"));
    const finalDep = findDeployment(
      cleared.world,
      { projectId, region: finalService.region, name: finalService.name },
      "run",
    );
    expect(finalService.allowUnauthenticated).toBe(true);
    expect(finalDep && latestRevision(finalDep).config.env).toEqual({});
  }
});

test("Cloud Run サービス編集フォームの検証が不正なメモリ・CPU比・環境変数を弾く", () => {
  const base = RunServiceEditForm.empty();
  expect(RunServiceEditForm.collectErrors({ ...base, image: "" }).image).toBeDefined();
  expect(
    RunServiceEditForm.collectErrors({ ...base, image: "gcr.io/a/b", cpu: "1", memory: "16Gi" })
      .memory,
  ).toContain("最大 8Gi");
  expect(
    RunServiceEditForm.collectErrors({
      ...base,
      image: "gcr.io/a/b",
      minInstances: "10",
      maxInstances: "5",
    }).maxInstances,
  ).toContain("最小インスタンス数以上");
  expect(
    RunServiceEditForm.collectErrors({ ...base, image: "gcr.io/a/b", envVars: "PORT=8080" })
      .envVars,
  ).toBeDefined();
});
