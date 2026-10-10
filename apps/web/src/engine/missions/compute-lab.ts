import { diskData, vmConfig, vmRef } from "@/engine/domains/compute-lab/model";
import { allows } from "@/engine/domains/serverless-lab/runtime";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";

const p = F.devProjectId;
const z = "us-central1-a";
const worker = `vm-worker@${p}.iam.gserviceaccount.com`;
const vm = (n: string, flags = "") => `gcloud compute instances create ${n} --zone=${z} ${flags}`;
const disk = (n: string, flags = "") => `gcloud compute disks create ${n} --zone=${z} ${flags}`;
const write = (n: string, data: string) =>
  `sim compute disks write ${n} --zone=${z} --data=${data}`;
const read = (n: string) => `sim compute disks read ${n} --zone=${z}`;
const createWorker = [
  "gcloud iam service-accounts create vm-worker",
  `gcloud iam service-accounts add-iam-policy-binding ${worker} --member=user:${F.owner} --role=roles/iam.serviceAccountUser`,
];
const template = (n: string, flags = "") =>
  `gcloud compute instance-templates create ${n} ${flags}`;
const group = (n: string, flags = "") =>
  `gcloud compute instance-groups managed create ${n} --zone=${z} --template=${n}-v1 --size=2 ${flags}`;
const mig = (n: string, op: string, flags = "") =>
  `sim compute instance-groups managed ${op} ${n} --zone=${z} ${flags}`;
export const ComputePrelude = [
  "gcloud services enable compute.googleapis.com tpu.googleapis.com osconfig.googleapis.com",
];
export const ComputeSolutions = {
  custom: [vm("custom-worker", "--custom-vm-type=n2 --custom-cpu=4 --custom-memory=12GB")],
  spot: [
    vm(
      "checkpoint-worker",
      "--provisioning-model=SPOT --maintenance-policy=TERMINATE --no-restart-on-failure",
    ),
    write("checkpoint-worker", "checkpoint-42"),
    "sim compute instances preempt checkpoint-worker --zone=us-central1-a",
    "gcloud compute instances start checkpoint-worker --zone=us-central1-a",
    read("checkpoint-worker"),
  ],
  gpu: [
    vm(
      "gpu-worker",
      "--machine-type=n1-standard-1 --accelerator=type=nvidia-tesla-t4,count=1 --maintenance-policy=TERMINATE",
    ),
  ],
  tpu: [
    ...createWorker,
    `gcloud compute tpus tpu-vm create matrix-worker --zone=us-central1-b --accelerator-type=v2-8 --version=tpu-vm-base --service-account=${worker}`,
  ],
  regional: [
    vm("ha-worker"),
    "gcloud compute disks create mirrored --region=us-central1 --replica-zones=us-central1-a,us-central1-b --type=pd-ssd --size=200GB",
    "gcloud compute instances attach-disk ha-worker --zone=us-central1-a --disk=mirrored --disk-scope=regional",
  ],
  hyperdisk: [
    vm("io-worker", "--machine-type=c3-standard-4"),
    disk(
      "fast-data",
      "--type=hyperdisk-balanced --size=100GB --provisioned-iops=10000 --provisioned-throughput=400",
    ),
    "gcloud compute instances attach-disk io-worker --zone=us-central1-a --disk=fast-data",
  ],
  restore: [
    disk("orders", "--size=20GB"),
    write("orders", "orders-v1"),
    "gcloud compute disks snapshot orders --zone=us-central1-a --snapshot-names=orders-safe",
    write("orders", "corrupted"),
    disk("recovered-orders", "--source-snapshot=orders-safe --size=30GB"),
    read("recovered-orders"),
  ],
  image: [
    vm("golden"),
    write("golden", "release-v2"),
    "gcloud compute instances stop golden --zone=us-central1-a",
    "gcloud compute images create release-v2 --source-disk=golden --source-disk-zone=us-central1-a --family=app",
    vm("image-worker", "--image=release-v2"),
    read("image-worker"),
  ],
  schedule: [
    disk("seed-data", "--size=20GB"),
    write("seed-data", "scheduled-v1"),
    "gcloud compute disks snapshot seed-data --zone=us-central1-a --snapshot-names=seed-safe",
    disk("scheduled-data", "--source-snapshot=seed-safe --size=20GB"),
    "gcloud compute resource-policies create snapshot-schedule hourly --region=us-central1 --hourly-schedule=1 --max-retention-days=7",
    "gcloud compute disks add-resource-policies scheduled-data --zone=us-central1-a --resource-policies=hourly",
    "sim compute snapshot-schedules run hourly --region=us-central1",
    "sim compute time advance --seconds=3600",
    "sim compute snapshot-schedules run hourly --region=us-central1",
  ],
  osLogin: [
    ...createWorker,
    vm("login-worker", `--service-account=${worker} --metadata=enable-oslogin=TRUE`),
    `gcloud projects add-iam-policy-binding ${p} --member=user:${F.developer} --role=roles/compute.viewer`,
    `gcloud projects add-iam-policy-binding ${p} --member=user:${F.developer} --role=roles/compute.osLogin`,
    `gcloud iam service-accounts add-iam-policy-binding ${worker} --member=user:${F.developer} --role=roles/iam.serviceAccountUser`,
    `sim compute instances os-login-check login-worker --zone=${z} --account=${F.developer}`,
  ],
  osManager: [
    vm("managed-worker", "--metadata=enable-osconfig=TRUE"),
    "gcloud compute os-config inventories describe managed-worker --zone=us-central1-a",
    "gcloud compute os-config os-policy-assignments create security-baseline --zone=us-central1-a --instance=managed-worker --policy=security-updates",
    "sim compute os-config os-policy-assignments apply security-baseline --zone=us-central1-a",
  ],
  scopes: [
    ...createWorker,
    vm("scoped-worker", `--service-account=${worker} --scopes=cloud-platform`),
    `gcloud projects add-iam-policy-binding ${p} --member=serviceAccount:${worker} --role=roles/storage.objectCreator`,
    "sim compute instances runtime-check scoped-worker --zone=us-central1-a --operation=storage-write",
  ],
  rolling: [
    template("release-v1", "--metadata=release=v1"),
    group("release"),
    template("release-v2", "--metadata=release=v2 --machine-type=n2-standard-2"),
    "gcloud compute instance-groups managed rolling-action start-update release --zone=us-central1-a --version=template=release-v2 --max-surge=1 --max-unavailable=0",
    mig("release", "advance-update"),
    mig("release", "advance-update"),
  ],
  autoheal: [
    template("healing-v1", "--metadata=app-port=80"),
    group("healing"),
    "gcloud compute health-checks create http app-health --global --port=80",
    "gcloud compute instance-groups managed update healing --zone=us-central1-a --health-check=app-health --initial-delay=60",
    // Initial sequence is deterministic, but the test replaces this marker with a member name.
    mig("healing", "fail-instance", "--instance=@member"),
    "sim compute time advance --seconds=60",
    mig("healing", "autoheal"),
  ],
  autoscaling: [
    template("scaling-v1"),
    group("scaling"),
    "gcloud compute instance-groups managed set-autoscaling scaling --zone=us-central1-a --min-num-replicas=1 --max-num-replicas=4 --target-cpu-utilization=0.5 --cool-down-period=60",
    mig("scaling", "evaluate-autoscaling", "--cpu-utilization=1 --elapsed-seconds=60"),
    "gcloud compute instance-groups managed resize scaling --zone=us-central1-a --size=4",
  ],
} as const;
export type ComputeLesson = keyof typeof ComputeSolutions;
export type ComputeAssertion = Readonly<{ kind: "computeLesson"; lesson: ComputeLesson }>;
const titles: Record<ComputeLesson, readonly [string, string, Mission["domain"]]> = {
  custom: [
    "CPUとメモリを個別に設計する",
    "N2の4 vCPU / 12 GiBカスタムVMを作成する。",
    "計画と構成",
  ],
  spot: [
    "Spotの中断からチェックポイントを復旧する",
    "停止型Spotを中断し、ディスクのチェックポイントを保ったまま再開して読む。",
    "運用の維持",
  ],
  gpu: [
    "GPUとホストメンテナンス条件を揃える",
    "T4をN1と対応ゾーンへ配置し、メンテナンス時の終了を指定する。",
    "計画と構成",
  ],
  tpu: [
    "行列処理用TPU VMを配置する",
    "対応ゾーン・専用SA・actAsを用意し、v2-8 TPU VMを作る。",
    "計画と構成",
  ],
  regional: [
    "データディスクを2ゾーンへ複製する",
    "regional SSDの複製ゾーンを揃えてVMに接続する。実HA動作は再現しない。",
    "計画と構成",
  ],
  hyperdisk: [
    "容量とIOPSを独立して設定する",
    "100 GiB / 10,000 IOPS / 400 MiB/sのHyperdiskをC3へ接続する。",
    "計画と構成",
  ],
  restore: [
    "変更前のディスクデータを復元する",
    "orders-v1を保護し、破損後に別ディスクへ復元して読み取る。",
    "運用の維持",
  ],
  image: [
    "停止したVMから再利用イメージを作る",
    "release-v2をカスタムイメージ化して別VMに復元し、内容を確認する。",
    "運用の維持",
  ],
  schedule: [
    "時刻と保持期間を持つバックアップを設定する",
    "1時間ごとのスケジュールを接続し、仮想時間で2回のコピーを取得する。",
    "運用の維持",
  ],
  osLogin: [
    "OS Loginを最小権限で許可する",
    "開発者へ閲覧・OS Login・対象SAのactAsだけを付与し、非管理者ログイン条件を確認する。",
    "アクセスとセキュリティ",
  ],
  osManager: [
    "VM Managerの対象と実行状態を確認する",
    "OS Configを有効化し、inventory確認後に固定security-updatesポリシーを適用する。",
    "運用の維持",
  ],
  scopes: [
    "実行SAのIAMとOAuth scopeを揃える",
    "cloud-platform scopeとStorage Object Creatorを組み合わせて書き込み権限を確認する。",
    "アクセスとセキュリティ",
  ],
  rolling: [
    "MIGを1台ずつ新しいテンプレートへ更新する",
    "v1を2台配置し、surge=1 / unavailable=0でv2へ段階更新する。",
    "運用の維持",
  ],
  autoheal: [
    "MIGの初期待機後に障害VMを修復する",
    "ヘルスチェック・60秒の待機を設定し、明示障害からテンプレートでVMを再作成する。",
    "運用の維持",
  ],
  autoscaling: [
    "CPU条件と待機時間から増設台数を決める",
    "CPU目標0.5、1〜4台、60秒待機を設定し、推奨4台へ増設する。",
    "運用の維持",
  ],
};
export const ComputeMissions: readonly Mission[] = (
  Object.keys(ComputeSolutions) as ComputeLesson[]
).map((lesson) => ({
  id: `compute-${lesson}`,
  domain: titles[lesson][2],
  title: titles[lesson][0],
  description: titles[lesson][1],
  setup: [
    { kind: "setProject", projectId: p },
    { kind: "setPrincipal", principal: F.owner },
  ],
  hints: ["helpで対応フラグを確認し、API・場所・権限を先に揃える。", ...ComputeSolutions[lesson]],
  assertions: [{ kind: "computeLesson", lesson }],
}));
export const computeSatisfied = (w: World, lesson: ComputeLesson): boolean => {
  const l = w.computeLab;
  const i = (n: string) =>
    w.instances.find((i) => i.projectId === p && i.zone === z && i.name === n);
  const d = (n: string, loc = z) =>
    l.disks.find((d) => d.projectId === p && d.location === loc && d.name === n);
  const observed = (n: string, op: string) =>
    l.observations.findLast((o) => o.projectId === p && o.name === n && o.operation === op);
  const read = (n: string, data: string) =>
    observed(n, "read")?.result === JSON.stringify({ data });
  if (lesson === "custom") {
    return (
      i("custom-worker")?.machineType === "n2-custom-4-12288" &&
      i("custom-worker")?.status === "RUNNING"
    );
  }
  if (lesson === "spot") {
    const vm = i("checkpoint-worker");
    return (
      !!vm &&
      vm.status === "RUNNING" &&
      vm.provisioningModel === "SPOT" &&
      vmConfig(w, vm).terminationAction === "STOP" &&
      !!observed(vm.name, "preempt") &&
      read(vm.name, "checkpoint-42") &&
      diskData(w, vmRef(vm)) === "checkpoint-42"
    );
  }
  if (lesson === "gpu") {
    const vm = i("gpu-worker");
    return (
      !!vm &&
      vm.status === "RUNNING" &&
      vm.machineType === "n1-standard-1" &&
      vmConfig(w, vm).gpuType === "nvidia-tesla-t4" &&
      vmConfig(w, vm).gpuCount === 1
    );
  }
  if (lesson === "tpu") {
    return l.tpus.some(
      (t) =>
        t.projectId === p &&
        t.name === "matrix-worker" &&
        t.location === "us-central1-b" &&
        t.type === "v2-8" &&
        t.state === "READY" &&
        t.serviceAccount === worker &&
        !t.preemptible,
    );
  }
  if (lesson === "regional") {
    const disk = d("mirrored", "us-central1");
    return (
      !!disk &&
      disk.type === "pd-ssd" &&
      disk.sizeGb === 200 &&
      disk.replicaZones.includes("us-central1-a") &&
      disk.replicaZones.includes("us-central1-b") &&
      disk.users.includes(`${z}/ha-worker`)
    );
  }
  if (lesson === "hyperdisk") {
    const disk = d("fast-data");
    return (
      !!disk &&
      disk.type === "hyperdisk-balanced" &&
      disk.sizeGb === 100 &&
      disk.iops === 10000 &&
      disk.throughput === 400 &&
      disk.users.includes(`${z}/io-worker`)
    );
  }
  if (lesson === "restore") {
    return (
      d("recovered-orders")?.sourceSnapshot === "orders-safe" &&
      diskData(w, { projectId: p, name: "orders", location: z }) === "corrupted" &&
      read("recovered-orders", "orders-v1") &&
      diskData(w, { projectId: p, name: "recovered-orders", location: z }) === "orders-v1"
    );
  }
  if (lesson === "image") {
    return (
      l.images.some(
        (im) => im.projectId === p && im.name === "release-v2" && im.data === "release-v2",
      ) &&
      i("image-worker")?.disks.some((disk) => disk.sourceImage.endsWith("/images/release-v2")) ===
        true &&
      read("image-worker", "release-v2")
    );
  }
  if (lesson === "schedule") {
    return (
      l.schedules.some(
        (s) => s.projectId === p && s.name === "hourly" && s.hours === 1 && s.retentionDays === 7,
      ) &&
      d("scheduled-data")?.schedule === "hourly" &&
      l.copies.filter(
        (c) => c.projectId === p && c.schedule === "hourly" && c.data === "scheduled-v1",
      ).length === 2
    );
  }
  if (lesson === "osLogin") {
    const result = observed("login-worker", "os-login");
    return (
      !!result &&
      result.result === JSON.stringify({ principal: F.developer, admin: false, allowed: true }) &&
      i("login-worker")?.metadata["enable-oslogin"] === "TRUE"
    );
  }
  if (lesson === "osManager") {
    return (
      !!observed("managed-worker", "inventory") &&
      l.osPolicies.some(
        (a) =>
          a.projectId === p &&
          a.name === "security-baseline" &&
          a.instance === "managed-worker" &&
          a.state === "SUCCEEDED",
      )
    );
  }
  if (lesson === "scopes") {
    return (
      i("scoped-worker")?.serviceAccount === worker &&
      i("scoped-worker")?.status === "RUNNING" &&
      i("scoped-worker")?.scopes.includes("https://www.googleapis.com/auth/cloud-platform") ===
        true &&
      allows(w, p, worker, "storage.objects.create") &&
      !!observed("scoped-worker", "storage-write")
    );
  }
  const n = { rolling: "release", autoheal: "healing", autoscaling: "scaling" }[lesson];
  const g = w.instanceGroups.find((g) => g.projectId === p && g.location === z && g.name === n);
  const m = l.migs.find((m) => m.projectId === p && m.location === z && m.name === n);
  if (!g || !m) {
    return false;
  }
  if (lesson === "rolling") {
    return (
      g.targetSize === 2 &&
      m.desiredTemplate === "release-v2" &&
      m.pending.length === 0 &&
      g.instanceNames.every((n) => m.applied[n] === "release-v2" && i(n)?.metadata.release === "v2")
    );
  }
  if (lesson === "autoheal") {
    return (
      m.healthCheck === "app-health" &&
      m.initialDelay === 60 &&
      m.repairs === 1 &&
      m.failed.length === 0 &&
      g.instanceNames.every((n) => i(n)?.status === "RUNNING")
    );
  }
  return (
    g.targetSize === 4 &&
    g.instanceNames.length === 4 &&
    g.autoscaling.some &&
    g.autoscaling.value.targetCpuUtilization === 0.5 &&
    observed("scaling", "autoscaling")?.result.includes('"recommended":4') === true
  );
};
