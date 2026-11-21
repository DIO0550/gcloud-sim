import type { BucketLocation, Zone } from "@/engine/domains/catalog";
import { ExternalIp, type Instance } from "@/engine/domains/compute";
import { patch as patchData } from "@/engine/domains/data-processing/model";
import { EffectivePermissions } from "@/engine/domains/effective-permissions";
import { type IamMember, IamPolicy, type RoleName } from "@/engine/domains/iam-policy";
import type { ConnectivityResult } from "@/engine/domains/network-lab/connectivity-test";
import { firewallDecision } from "@/engine/domains/network-lab/model";
import { Operation, type OperationType } from "@/engine/domains/operation";
import type { PolicyTarget } from "@/engine/domains/resource-hierarchy";
import { Bucket } from "@/engine/domains/storage";
import { putObject } from "@/engine/domains/storage-lab/model";
import { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { MissionStep } from "@/engine/missions/mission-step";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

/**
 * Qwiklabs 型の演習（VPC の作り方・VPC 間の到達性・IAP 経由の SSH・監査ログ・BigQuery の見積もり）。
 * どれも本物の CLI だけで進められる（`sim` コマンドを使わない）ので、演習一覧に公開される。
 */

const p = F.devProjectId;
const IapRange = "35.235.240.0/20";
/** IAP の TCP 転送の送信元（判定用の代表アドレス） */
const IapOrigin = "35.235.240.10";
const SshPort = 22;

// --- 達成条件 ---

export type PracticeAssertion =
  | Readonly<{
      kind: "networkFirewallRule";
      projectId: string;
      name: string;
      network: string;
      /** `icmp` / `tcp:22` / `all` のどれもが許可に含まれる */
      allow: readonly string[];
      sourceRange: string;
    }>
  | Readonly<{
      kind: "instanceInNetwork";
      projectId: string;
      name: string;
      zone: Zone;
      network: string;
      subnet: string;
    }>
  | Readonly<{ kind: "subnetAbsent"; projectId: string; name: string; region: string }>
  | Readonly<{
      kind: "connectivityTestResult";
      projectId: string;
      name: string;
      sourceInstance: string;
      destinationInstance: string;
      result: ConnectivityResult;
    }>
  | Readonly<{
      kind: "iapSshReady";
      projectId: string;
      zone: Zone;
      instance: string;
      /** `user:` を付けないメールアドレス */
      principal: string;
    }>
  | Readonly<{
      kind: "bigQueryRows";
      projectId: string;
      dataset: string;
      table: string;
      rows: number;
    }>
  | Readonly<{ kind: "bigQueryQueryJob"; projectId: string; target: string }>;

const coversAllowed = (
  allowed: readonly { protocol: string; ports: readonly string[] }[],
  want: string,
) => {
  const [protocol, port] = want.split(":");
  return allowed.some(
    (a) => a.protocol === protocol && (port === undefined || a.ports.includes(port)),
  );
};

const findInstance = (w: World, projectId: string, zone: string, name: string) =>
  w.instances.find((i) => i.projectId === projectId && i.zone === zone && i.name === name);

/**
 * 外部 IP の無い VM に、その人が IAP 経由で SSH できるか（`gcloud compute ssh --tunnel-through-iap`
 * と同じ前提: VM が RUNNING、IAP の範囲から tcp:22 を許すファイアウォール、トンネルと OS Login の権限）。
 */
const iapReady = (w: World, a: Extract<PracticeAssertion, { kind: "iapSshReady" }>): boolean => {
  const instance: Instance | undefined = findInstance(w, a.projectId, a.zone, a.instance);
  if (instance === undefined || instance.status !== "RUNNING") return false;
  const external = instance.networkInterfaces.some((n) =>
    Option.isSome(ExternalIp.address(n.externalIP)),
  );
  if (external) return false;
  const granted = EffectivePermissions.resolve(w, `user:${a.principal}`, {
    type: "project",
    id: a.projectId,
  }).permissions;
  const permitted = ["iap.tunnelInstances.accessViaIAP", "compute.instances.osLogin"].every((p) =>
    granted.has(p),
  );
  return permitted && firewallDecision(w, instance, "INGRESS", IapOrigin, "tcp", SshPort).allowed;
};

export const practiceSatisfied = (w: World, a: PracticeAssertion): boolean => {
  switch (a.kind) {
    case "networkFirewallRule": {
      const rule = w.firewallRules.find((r) => r.projectId === a.projectId && r.name === a.name);
      return (
        rule !== undefined &&
        rule.network === a.network &&
        rule.direction === "INGRESS" &&
        !rule.disabled &&
        rule.targetTags.length === 0 &&
        rule.sourceRanges.includes(a.sourceRange) &&
        a.allow.every((want) => coversAllowed(rule.allowed, want))
      );
    }
    case "instanceInNetwork": {
      const nic = findInstance(w, a.projectId, a.zone, a.name)?.networkInterfaces[0];
      return nic !== undefined && nic.network === a.network && nic.subnetwork === a.subnet;
    }
    case "subnetAbsent":
      return !w.subnets.some(
        (s) => s.projectId === a.projectId && s.name === a.name && s.region === a.region,
      );
    case "connectivityTestResult": {
      const test = w.networkLab.connectivityTests.find(
        (t) => t.projectId === a.projectId && t.name === a.name,
      );
      if (test === undefined || test.sourceInstance !== a.sourceInstance) return false;
      const destination = w.instances.find(
        (i) => i.projectId === a.projectId && i.name === a.destinationInstance,
      );
      const pointsAt =
        test.destinationKind === "instance"
          ? test.destination === a.destinationInstance
          : destination?.networkInterfaces.some((n) => n.networkIP === test.destination) === true;
      // 判定は今の構成で取り直したものと一致していること（古い結果のままでは達成にしない）
      return pointsAt && test.result === a.result;
    }
    case "iapSshReady":
      return iapReady(w, a);
    case "bigQueryRows":
      return w.dataProcessing.tables.some(
        (t) =>
          t.projectId === a.projectId &&
          t.dataset === a.dataset &&
          t.name === a.table &&
          t.rows.length === a.rows,
      );
    case "bigQueryQueryJob":
      return w.dataProcessing.jobs.some(
        (j) =>
          j.projectId === a.projectId &&
          j.type === "QUERY" &&
          j.state === "DONE" &&
          j.target === a.target,
      );
  }
};

/** 達成条件の表示文。 */
export const practiceAssertionText = (a: PracticeAssertion): string => {
  switch (a.kind) {
    case "networkFirewallRule":
      return `ファイアウォール ${a.name}（${a.network}, ${a.sourceRange} から ${a.allow.join(",")} を許可）がある`;
    case "instanceInNetwork":
      return `VM ${a.name}（${a.zone}）が ${a.network} / ${a.subnet} にある`;
    case "subnetAbsent":
      return `サブネット ${a.name}（${a.region}）が無い`;
    case "connectivityTestResult":
      return `接続テスト ${a.name}（${a.sourceInstance} → ${a.destinationInstance}）が ${a.result}`;
    case "iapSshReady":
      return `${a.principal} が外部 IP の無い ${a.instance} に IAP 経由で SSH できる`;
    case "bigQueryRows":
      return `テーブル ${a.dataset}.${a.table} に ${a.rows} 行ある`;
    case "bigQueryQueryJob":
      return `${a.target} を読む完了済みのクエリジョブがある`;
  }
};

// --- 開始時の状態 ---

export type PracticePatch =
  | Readonly<{
      kind: "grantBinding";
      target: PolicyTarget;
      role: RoleName;
      member: IamMember;
    }>
  | Readonly<{ kind: "stopInstance"; projectId: string; zone: Zone; name: string }>
  | Readonly<{
      kind: "auditTrail";
      projectId: string;
      entries: readonly Readonly<{
        zone: Zone;
        instance: string;
        operationType: OperationType;
        user: string;
        minutesAgo: number;
      }>[];
    }>
  | Readonly<{
      kind: "csvObject";
      projectId: string;
      bucket: string;
      location: BucketLocation;
      object: string;
      data: string;
    }>;

const minutesBefore = (now: string, minutes: number): string =>
  new Date(Date.parse(now) - minutes * 60_000).toISOString();

const instanceLink = (projectId: string, zone: string, name: string) =>
  `https://www.googleapis.com/compute/v1/projects/${projectId}/zones/${zone}/instances/${name}`;

/**
 * 開始時の状態を当てる。
 *
 * @param now 開始した時刻（監査ログを「何分前」に置く基準）
 */
export const applyPracticePatch = (
  world: World,
  patch: PracticePatch,
  now: string,
): Result<World, string> => {
  switch (patch.kind) {
    case "grantBinding": {
      const policy = World.findPolicy(world, patch.target);
      if (!Option.isSome(policy)) {
        return Result.err(`target ${patch.target.type}/${patch.target.id} does not exist`);
      }
      return Result.mapErr(
        World.withPolicy(
          world,
          patch.target,
          IamPolicy.addBinding(policy.value, patch.role, patch.member),
        ),
        () => `cannot grant ${patch.role} to ${patch.member}`,
      );
    }
    case "stopInstance": {
      const instance = World.findInstance(world, patch.projectId, patch.zone, patch.name);
      if (!Option.isSome(instance)) return Result.err(`instance ${patch.name} does not exist`);
      return Result.ok(World.replaceInstance(world, { ...instance.value, status: "TERMINATED" }));
    }
    case "auditTrail":
      return Result.ok(
        patch.entries.reduce((w, entry) => {
          const numbered = World.nextNumber(w);
          const operation = Operation.create({
            projectId: patch.projectId,
            operationType: entry.operationType,
            targetLink: instanceLink(patch.projectId, entry.zone, entry.instance),
            targetName: entry.instance,
            zone: Option.some(entry.zone),
            user: entry.user,
            now: minutesBefore(now, entry.minutesAgo),
            sequence: numbered.number,
          });
          return World.withOperation(numbered.world, operation);
        }, world),
      );
    case "csvObject": {
      const existing = World.findBucket(world, patch.bucket);
      const withBucket = Option.isSome(existing)
        ? Result.ok(world)
        : Result.flatMap(
            Bucket.create({
              projectId: patch.projectId,
              name: patch.bucket,
              location: patch.location,
              storageClass: "STANDARD",
              uniformBucketLevelAccess: true,
              publicAccessPrevention: true,
              timeCreated: now,
            }),
            (bucket) =>
              Result.mapErr(World.withBucket(world, bucket), () => `bucket ${patch.bucket} exists`),
          );
      return Result.flatMap(withBucket, (w) => {
        const uri = `gs://${patch.bucket}/${patch.object}`;
        const stored = putObject(
          w,
          patch.bucket,
          {
            name: patch.object,
            size: new TextEncoder().encode(patch.data).length,
            contentType: "text/csv",
            updated: now,
            storageClass: Option.none,
          },
          now,
        );
        return Result.map(stored, (sw) =>
          patchData(sw, {
            files: [
              ...sw.dataProcessing.files.filter((f) => f.uri !== uri),
              { uri, data: patch.data, token: now },
            ],
          }),
        );
      });
    }
  }
};

// --- 演習 ---

const run = MissionStep.run;
const say = MissionStep.say;
const owner = [
  { kind: "setProject", projectId: p },
  { kind: "setPrincipal", principal: F.owner },
] as const satisfies Mission["setup"];
const vmUri = (zone: string, name: string) => `projects/${p}/zones/${zone}/instances/${name}`;

const SalesCsv = [
  "region,product,amount,note",
  "tokyo,coffee,1200,first order of the month",
  "tokyo,tea,800,",
  "osaka,coffee,1500,shipped with the express option",
  "osaka,cake,2400,",
  "nagoya,tea,600,gift wrapping requested by the customer",
  "nagoya,coffee,900,",
].join("\n");

export const PracticeMissions: readonly Mission[] = [
  {
    id: "m-vpc-auto-to-custom",
    domain: "計画と構成",
    title: "自動モードの VPC を作り、カスタムモードへ切り替える",
    description:
      "ace-dev-01 に自動モードの VPC `autonet` を作り、各リージョンにサブネットが自動で作られたことを確かめてください。そのあとカスタムモードへ切り替え、使わない europe-west1 のサブネットを削除します（us-central1 のサブネットは残します）。",
    steps: [
      run(
        "自動モードの VPC を作る",
        "gcloud compute networks create autonet --subnet-mode=auto",
        "自動モードは、各リージョンに 10.128.0.0/9 の中の /20 を 1 つずつ自動で作ります。",
      ),
      run(
        "リージョンごとのサブネットと IP 範囲を確かめる",
        'gcloud compute networks subnets list --filter="network:autonet"',
        "us-central1 は 10.128.0.0/20、europe-west1 は 10.132.0.0/20 です。default ネットワークと同じ範囲なので、自動モードの VPC どうしはピアリングできません。",
      ),
      run(
        "自動モードのまま europe-west1 のサブネットを消してみる",
        "gcloud compute networks subnets delete autonet --region=europe-west1 --quiet",
        "自動で作られたサブネットは、自動モードのあいだは削除できません（エラーになります）。",
      ),
      run(
        "カスタムモードへ切り替える",
        "gcloud compute networks update autonet --switch-to-custom-subnet-mode",
        "この切り替えは元に戻せません。既存のサブネットは残り、新しいリージョンには自動で作られなくなります。",
      ),
      run("切り替わったことを確かめる", "gcloud compute networks describe autonet"),
      run(
        "europe-west1 のサブネットを削除する",
        "gcloud compute networks subnets delete autonet --region=europe-west1 --quiet",
      ),
    ],
    setup: owner,
    assertions: [
      { kind: "networkExists", projectId: p, name: "autonet", subnetMode: "CUSTOM" },
      {
        kind: "subnetExists",
        projectId: p,
        name: "autonet",
        region: "us-central1",
        ipCidrRange: "10.128.0.0/20",
      },
      { kind: "subnetAbsent", projectId: p, name: "autonet", region: "europe-west1" },
    ],
  },
  {
    id: "m-vpc-connectivity",
    domain: "デプロイと実装",
    title: "別の VPC の VM へ内部 IP で届かないことを接続テストで確かめる",
    description:
      "開始すると default ネットワークに VM `default-us-vm`（us-central1-a）が用意されます。カスタムモードの VPC `privatenet` に us-central1 と europe-west1 のサブネットを作り、両方に VM を置いてください。接続テストで、同じ VPC ならリージョンが違っても内部 IP で届き、default の VM には届かないことを確かめます。",
    steps: [
      run(
        "接続テストの API を有効にする",
        "gcloud services enable networkmanagement.googleapis.com",
        "接続テスト（Network Intelligence Center）は Network Management API を使います。",
      ),
      run(
        "カスタムモードの VPC を作る",
        "gcloud compute networks create privatenet --subnet-mode=custom",
      ),
      run(
        "us-central1 のサブネットを作る",
        "gcloud compute networks subnets create privatesubnet-us --network=privatenet --region=us-central1 --range=172.16.0.0/24",
      ),
      run(
        "europe-west1 のサブネットを作る",
        "gcloud compute networks subnets create privatesubnet-eu --network=privatenet --region=europe-west1 --range=172.20.0.0/20",
      ),
      run(
        "ICMP・SSH・RDP を許可するルールを作る",
        "gcloud compute firewall-rules create privatenet-allow-icmp-ssh-rdp --network=privatenet --allow=icmp,tcp:22,tcp:3389 --source-ranges=0.0.0.0/0",
        "新しい VPC には、暗黙の「上りはすべて拒否」しかありません。",
      ),
      run(
        "us-central1 に VM を作る",
        "gcloud compute instances create privatenet-us-vm --zone=us-central1-c --network=privatenet --subnet=privatesubnet-us",
      ),
      run(
        "europe-west1 に VM を作る",
        "gcloud compute instances create privatenet-eu-vm --zone=europe-west1-c --network=privatenet --subnet=privatesubnet-eu",
      ),
      run(
        "同じ VPC の別リージョンの VM へ ICMP が届くか調べる",
        `gcloud network-management connectivity-tests create privatenet-us-to-eu --source-instance=${vmUri("us-central1-c", "privatenet-us-vm")} --destination-instance=${vmUri("europe-west1-c", "privatenet-eu-vm")} --protocol=ICMP`,
        "VPC はグローバルなので、サブネットのリージョンが違っても内部 IP でそのまま届きます（REACHABLE）。",
      ),
      run(
        "default の VM へ ICMP が届くか調べる",
        `gcloud network-management connectivity-tests create privatenet-to-default --source-instance=${vmUri("us-central1-c", "privatenet-us-vm")} --destination-instance=${vmUri("us-central1-a", "default-us-vm")} --protocol=ICMP`,
        "宛先に VM を指定すると内部 IP で調べます。VPC が別なのでルートが無く、UNREACHABLE（NO_ROUTE）になります。内部 IP でつなぐには VPC ネットワーク ピアリングか VPN が要ります。",
      ),
      run(
        "届かない理由を確かめる",
        "gcloud network-management connectivity-tests describe privatenet-to-default",
      ),
    ],
    setup: [
      ...owner,
      { kind: "ensureInstance", projectId: p, name: "default-us-vm", zone: "us-central1-a" },
    ],
    assertions: [
      { kind: "networkExists", projectId: p, name: "privatenet", subnetMode: "CUSTOM" },
      {
        kind: "instanceInNetwork",
        projectId: p,
        name: "privatenet-eu-vm",
        zone: "europe-west1-c",
        network: "privatenet",
        subnet: "privatesubnet-eu",
      },
      {
        kind: "connectivityTestResult",
        projectId: p,
        name: "privatenet-us-to-eu",
        sourceInstance: "privatenet-us-vm",
        destinationInstance: "privatenet-eu-vm",
        result: "REACHABLE",
      },
      {
        kind: "connectivityTestResult",
        projectId: p,
        name: "privatenet-to-default",
        sourceInstance: "privatenet-us-vm",
        destinationInstance: "default-us-vm",
        result: "UNREACHABLE",
      },
    ],
  },
  {
    id: "m-ssh-iap",
    domain: "アクセスとセキュリティ",
    title: "外部 IP の無い VM に IAP 経由で SSH させる",
    description:
      "外部 IP を持たない VM `iap-vm` を専用の VPC `iap-net` に作り、dev@example.com が IAP の TCP 転送で SSH できるようにしてください。0.0.0.0/0 からの SSH は開けず、IAP の送信元範囲だけを許可します。",
    steps: [
      run("VPC を作る", "gcloud compute networks create iap-net --subnet-mode=custom"),
      run(
        "サブネットを作る",
        "gcloud compute networks subnets create iap-subnet --network=iap-net --region=asia-northeast1 --range=10.30.0.0/24",
      ),
      run(
        "外部 IP の無い VM を作る",
        "gcloud compute instances create iap-vm --zone=asia-northeast1-a --network=iap-net --subnet=iap-subnet --no-address",
      ),
      run(
        "そのまま SSH してみる",
        "gcloud compute ssh iap-vm --zone=asia-northeast1-a",
        "外部 IP が無いので、インターネットからは届きません（タイムアウトします）。",
      ),
      run(
        "IAP 経由で SSH してみる",
        "gcloud compute ssh iap-vm --zone=asia-northeast1-a --tunnel-through-iap",
        "IAP からの接続を許すファイアウォールが無いので、4003（failed to connect to backend）になります。",
      ),
      run(
        "IAP の送信元範囲から SSH を許可する",
        `gcloud compute firewall-rules create iap-net-allow-iap-ssh --network=iap-net --allow=tcp:22 --source-ranges=${IapRange}`,
        `${IapRange} は IAP の TCP 転送が VM へつなぐときの送信元です。0.0.0.0/0 を開ける必要はありません。`,
      ),
      run(
        "dev にトンネルを使う権限を付ける",
        `gcloud projects add-iam-policy-binding ${p} --member=user:${F.developer} --role=roles/iap.tunnelResourceAccessor`,
        "IAP-secured Tunnel User です。これが無いと 4033（not authorized）になります。",
      ),
      run(
        "dev に OS Login の権限を付ける",
        `gcloud projects add-iam-policy-binding ${p} --member=user:${F.developer} --role=roles/compute.osLogin`,
        "VM にログインする権限は別です。sudo も要るなら roles/compute.osAdminLogin を付けます。",
      ),
      run("dev に切り替える", `gcloud config set account ${F.developer}`),
      run(
        "dev として IAP 経由で SSH する",
        "gcloud compute ssh iap-vm --zone=asia-northeast1-a --tunnel-through-iap",
      ),
    ],
    setup: owner,
    assertions: [
      {
        kind: "iapSshReady",
        projectId: p,
        zone: "asia-northeast1-a",
        instance: "iap-vm",
        principal: F.developer,
      },
    ],
  },
  {
    id: "m-logging-audit",
    domain: "運用の維持",
    title: "監査ログから VM を止めた人を突き止めて対処する",
    description:
      "ace-dev-01 の VM `api-server`（asia-northeast1-a）が誰かに止められました。Cloud Logging の監査ログで止めた人を突き止め、api-server を起動し直して、その人のプロジェクトのロール（roles/compute.instanceAdmin.v1）だけを外してください。運用チーム（group:ops@example.com）のロールは残します。",
    steps: [
      run(
        "停止の操作だけを絞り込んで読む",
        `gcloud logging read 'protoPayload.methodName:"instances.stop"' --freshness=1d`,
        "管理アクティビティの監査ログは既定で記録され、誰が（principalEmail）何を（methodName）どれに（resourceName）したかが残ります。",
      ),
      run(
        "api-server の停止のエントリを 1 件だけ詳しく見る",
        `gcloud logging read 'protoPayload.resourceName:"instances/api-server" AND protoPayload.methodName:"stop"' --limit=1 --format=json`,
        "authenticationInfo.principalEmail が止めた人です。",
      ),
      run(
        "api-server を起動し直す",
        "gcloud compute instances start api-server --zone=asia-northeast1-a",
      ),
      run(
        "プロジェクトの IAM ポリシーで、その人のロールを確かめる",
        `gcloud projects get-iam-policy ${p}`,
      ),
      run(
        "止めた人のロールを外す",
        `gcloud projects remove-iam-policy-binding ${p} --member=user:contractor@example.com --role=roles/compute.instanceAdmin.v1`,
        "ログで principalEmail が contractor@example.com だったことを確かめてから外します。",
      ),
    ],
    setup: [
      ...owner,
      { kind: "ensureInstance", projectId: p, name: "api-server", zone: "asia-northeast1-a" },
      { kind: "ensureInstance", projectId: p, name: "batch-vm", zone: "asia-northeast1-b" },
      {
        kind: "grantBinding",
        target: { type: "project", id: p },
        role: "roles/compute.instanceAdmin.v1",
        member: "user:contractor@example.com",
      },
      {
        kind: "grantBinding",
        target: { type: "project", id: p },
        role: "roles/compute.instanceAdmin.v1",
        member: F.opsGroup,
      },
      { kind: "stopInstance", projectId: p, zone: "asia-northeast1-a", name: "api-server" },
      {
        kind: "auditTrail",
        projectId: p,
        entries: [
          {
            zone: "asia-northeast1-a",
            instance: "api-server",
            operationType: "insert",
            user: F.owner,
            minutesAgo: 180,
          },
          {
            zone: "asia-northeast1-b",
            instance: "batch-vm",
            operationType: "insert",
            user: F.owner,
            minutesAgo: 170,
          },
          {
            zone: "asia-northeast1-b",
            instance: "batch-vm",
            operationType: "stop",
            user: "ops-lead@example.com",
            minutesAgo: 120,
          },
          {
            zone: "asia-northeast1-b",
            instance: "batch-vm",
            operationType: "start",
            user: "ops-lead@example.com",
            minutesAgo: 90,
          },
          {
            zone: "asia-northeast1-a",
            instance: "api-server",
            operationType: "stop",
            user: "contractor@example.com",
            minutesAgo: 35,
          },
        ],
      },
    ],
    assertions: [
      {
        kind: "instanceExists",
        projectId: p,
        name: "api-server",
        zone: "asia-northeast1-a",
        machineType: Option.none,
        tags: [],
        status: Option.some("RUNNING"),
      },
      {
        kind: "bindingAbsent",
        target: { type: "project", id: p },
        role: "roles/compute.instanceAdmin.v1",
        member: "user:contractor@example.com",
      },
      {
        kind: "bindingExists",
        target: { type: "project", id: p },
        role: "roles/compute.instanceAdmin.v1",
        member: F.opsGroup,
      },
    ],
  },
  {
    id: "m-bq-dry-run",
    domain: "運用の維持",
    title: "CSV を BigQuery に読み込み、ドライランで費用を見積もる",
    description:
      "開始すると、バケット ace-dev-01-sales-raw（US）に売上の CSV `sales/2026-11.csv` が置かれます。US にデータセット `sales` とテーブル `orders` を作って CSV を読み込み、クエリを実行する前にドライランで処理バイト数を見積もってください。地域ごとの売上合計を求めるクエリを実行し、そのジョブの状態を確かめます。",
    steps: [
      run("BigQuery の API を有効にする", "gcloud services enable bigquery.googleapis.com"),
      run("読み込む CSV を確かめる", "gcloud storage ls gs://ace-dev-01-sales-raw/sales/"),
      run("US にデータセットを作る", "bq mk sales --dataset --location=US"),
      run(
        "スキーマ付きのテーブルを作る",
        "bq mk sales.orders --table --location=US --schema=region:STRING,product:STRING,amount:INT64,note:STRING",
      ),
      run(
        "Cloud Storage の CSV をテーブルへ読み込む",
        "bq load sales.orders gs://ace-dev-01-sales-raw/sales/2026-11.csv --location=US --source_format=CSV --skip_leading_rows=1",
        "--skip_leading_rows=1 で見出し行を飛ばします。バケットとデータセットのロケーションは合わせます。",
      ),
      run(
        "SELECT * の処理バイト数を見積もる",
        'bq query "SELECT * FROM sales.orders" --location=US --use_legacy_sql=false --dry_run',
        "ドライランはクエリを実行せず、課金の元になる処理バイト数の上限だけを返します（料金はかかりません）。",
      ),
      run(
        "必要な列だけのクエリを見積もる",
        'bq query "SELECT region, SUM(amount) AS total FROM sales.orders GROUP BY region" --location=US --use_legacy_sql=false --dry_run',
        "BigQuery は列指向なので、読む列を絞るとバイト数が減ります。LIMIT を付けても減りません。",
      ),
      run(
        "地域ごとの売上合計を求める",
        'bq query "SELECT region, SUM(amount) AS total FROM sales.orders GROUP BY region" --location=US --use_legacy_sql=false',
      ),
      run("ジョブの一覧を見る", "bq ls -j --location=US"),
      say(
        "クエリのジョブの状態を確かめる",
        "クエリの出力の job: にあるジョブ ID で bq show -j ジョブID --location=US を実行し、state が DONE であることを確かめます。",
      ),
    ],
    setup: [
      ...owner,
      {
        kind: "csvObject",
        projectId: p,
        bucket: "ace-dev-01-sales-raw",
        location: "US",
        object: "sales/2026-11.csv",
        data: SalesCsv,
      },
    ],
    assertions: [
      { kind: "bigQueryRows", projectId: p, dataset: "sales", table: "orders", rows: 6 },
      { kind: "bigQueryQueryJob", projectId: p, target: "sales.orders" },
    ],
  },
];
