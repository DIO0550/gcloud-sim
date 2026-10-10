import { IamPolicy } from "@/engine/domains/iam-policy";
import { allows } from "@/engine/domains/serverless-lab/runtime";
import { keyAccess, protectionFor } from "@/engine/domains/storage-lab/model";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";

const p = F.devProjectId;
const reader = `storage-reader@${p}.iam.gserviceaccount.com`;
const signer = `storage-signer@${p}.iam.gserviceaccount.com`;
const agent = "project-481200000001@storage-transfer-service.iam.gserviceaccount.com";
const key = `projects/${p}/locations/us-central1/keyRings/storage-ring/cryptoKeys/storage-key`;
const b = (lesson: string) => `storage-${lesson.toLowerCase()}`;
const create = (lesson: string, flags = "") =>
  `gcloud storage buckets create gs://${b(lesson)} --location=us-central1 ${flags}`;
const upload = (lesson: string) => `gcloud storage cp ./report.json gs://${b(lesson)}/report.json`;
const bind = (bucket: string, email: string, role: string) =>
  `gcloud storage buckets add-iam-policy-binding gs://${bucket} --member=serviceAccount:${email} --role=roles/storage.${role}`;
const update = (lesson: string, flags: string) =>
  `gcloud storage buckets update gs://${b(lesson)} ${flags}`;
const decision = (lesson: string, principal: string) =>
  `sim storage access check gs://${b(lesson)}/report.json --principal=${principal}`;
export const StoragePrelude = [
  "gcloud services enable storage.googleapis.com cloudkms.googleapis.com iamcredentials.googleapis.com storagetransfer.googleapis.com file.googleapis.com netapp.googleapis.com lustre.googleapis.com",
];
export const StorageSolutions = {
  classes: [
    create("classes", "--default-storage-class=COLDLINE"),
    upload("classes"),
    "gcloud storage objects update gs://storage-classes/report.json --storage-class=ARCHIVE",
  ],
  lifecycle: [
    create("lifecycle"),
    upload("lifecycle"),
    update("lifecycle", "--lifecycle-file=lifecycle-nearline.json"),
    "sim storage time advance --seconds=2592000",
    "sim storage lifecycle run gs://storage-lifecycle",
  ],
  versioning: [
    create("versioning"),
    update("versioning", "--versioning"),
    upload("versioning"),
    upload("versioning"),
    "sim storage versions restore gs://storage-versioning/report.json#1 --allow-overwrite",
  ],
  ubla: [create("ubla"), upload("ubla"), update("ubla", "--uniform-bucket-level-access")],
  iam: [
    create("iam", "--uniform-bucket-level-access"),
    upload("iam"),
    "gcloud iam service-accounts create storage-reader",
    bind(b("iam"), reader, "objectViewer"),
    decision("iam", reader),
  ],
  softDelete: [
    create("softDelete", "--soft-delete-duration=7d"),
    upload("softDelete"),
    "gcloud storage rm gs://storage-softdelete/report.json --quiet",
    "gcloud storage restore gs://storage-softdelete/report.json#1",
  ],
  retention: [
    create("retention", "--retention-period=1h"),
    update("retention", "--lock-retention-period"),
    upload("retention"),
  ],
  pap: [
    create("pap"),
    upload("pap"),
    "gsutil iam ch allUsers:objectViewer gs://storage-pap",
    update("pap", "--public-access-prevention"),
    decision("pap", "anonymous"),
  ],
  cmek: [
    "gcloud kms keyrings create storage-ring --location=us-central1",
    "gcloud kms keys create storage-key --keyring=storage-ring --location=us-central1 --purpose=encryption",
    `gcloud storage service-agent --authorize-cmek=${key}`,
    create("cmek", `--default-encryption-key=${key}`),
    upload("cmek"),
  ],
  signed: [
    create("signed", "--public-access-prevention"),
    upload("signed"),
    "gcloud iam service-accounts create storage-signer",
    `gcloud iam service-accounts add-iam-policy-binding ${signer} --member=user:${F.owner} --role=roles/iam.serviceAccountTokenCreator`,
    bind(b("signed"), signer, "objectViewer"),
    `gcloud storage sign-url gs://storage-signed/report.json --duration=10m --impersonate-service-account=${signer}`,
    "sim storage signed-url check signed-2",
    "sim storage time advance --seconds=601",
    "sim storage signed-url check signed-2",
  ],
  transfer: [
    create("source"),
    create("destination"),
    upload("source"),
    ...[b("source"), b("destination")].map((n) => bind(n, agent, "legacyBucketReader")),
    bind(b("source"), agent, "objectViewer"),
    bind(b("destination"), agent, "objectCreator"),
    "gcloud transfer jobs create gs://storage-source gs://storage-destination --name=transferJobs/storage-lesson --do-not-run",
    "gcloud transfer jobs run transferJobs/storage-lesson --no-async",
    "sim storage choose --workload=bulk-transfer --resource=transferJobs/storage-lesson",
  ],
  filestore: [
    "gcloud filestore instances create shared-files --zone=us-central1-c --tier=BASIC_HDD --file-share=name=my_vol,capacity=1TB --network=name=default",
    "sim storage choose --workload=nfs --resource=shared-files",
  ],
  netapp: [
    "gcloud netapp storage-pools create shared-pool --location=us-central1 --capacity=2048 --service-level=standard --network=name=default",
    "gcloud netapp volumes create shared-volume --location=us-central1 --capacity=1024 --protocols=nfsv3,nfsv4 --share-name=share1 --storage-pool=shared-pool",
    "sim storage choose --workload=enterprise-nfs --resource=shared-volume",
  ],
  lustre: [
    `gcloud lustre instances create hpc-files --location=us-central1-a --capacity-gib=18000 --per-unit-storage-throughput=1000 --filesystem=lustrefs --network=projects/${p}/global/networks/default`,
    "sim storage choose --workload=hpc --resource=hpc-files",
  ],
  recovery: [
    create("recovery", "--uniform-bucket-level-access --public-access-prevention"),
    update("recovery", "--versioning"),
    upload("recovery"),
    "gcloud storage rm gs://storage-recovery/report.json --quiet",
    "sim storage versions restore gs://storage-recovery/report.json#1",
  ],
  infrequent: [
    create("infrequent", "--uniform-bucket-level-access --public-access-prevention"),
    upload("infrequent"),
    update("infrequent", "--lifecycle-file=lifecycle-nearline.json"),
    "sim storage time advance --seconds=2592000",
    "sim storage lifecycle run gs://storage-infrequent",
  ],
  state: [
    create("state", "--uniform-bucket-level-access --public-access-prevention"),
    update("state", "--versioning"),
    "gcloud iam service-accounts create storage-reader",
    bind(b("state"), reader, "objectAdmin"),
    "gcloud storage cp ./terraform.tfstate gs://storage-state/report.json --if-generation-match=0",
    decision("state", reader),
  ],
} as const;
export type StorageLesson = keyof typeof StorageSolutions;
export type StorageAssertion = Readonly<{ kind: "storageLesson"; lesson: StorageLesson }>;
const titles: Readonly<Record<StorageLesson, readonly [string, string, Mission["domain"]]>> = {
  classes: [
    "バケットとオブジェクトのストレージクラスを選ぶ",
    "既定COLDLINEとオブジェクトARCHIVEの違いを設定で確認する。",
    "計画と構成",
  ],
  lifecycle: [
    "ライフサイクルで古いオブジェクトをNEARLINEへ移す",
    "30日の仮想経過後にルールを明示評価する。",
    "運用の維持",
  ],
  versioning: [
    "上書き前の世代を新しいlive世代として復元する",
    "非現行世代の復旧とsoft deleteのrestoreを区別する。",
    "運用の維持",
  ],
  ubla: [
    "UBLAでACLからIAMへアクセス管理を統一する",
    "オブジェクトを保存してからuniform bucket-level accessを有効にする。",
    "アクセスとセキュリティ",
  ],
  iam: [
    "専用サービスアカウントへバケットの読み取りだけを許可する",
    "Object Viewerをバケットに付け、HTTPSのアクセス判定を確認する。",
    "アクセスとセキュリティ",
  ],
  softDelete: [
    "soft delete期間内の誤削除を復旧する",
    "削除された世代をrestoreし、新しいlive世代を作る。",
    "運用の維持",
  ],
  retention: [
    "保持期間を設定してポリシーをロックする",
    "1時間の保持期間をロックして対象オブジェクトを保存する。",
    "アクセスとセキュリティ",
  ],
  pap: [
    "Public Access Preventionで公開読み取りを防ぐ",
    "公開IAMが残っていてもPAPで匿名アクセスを拒否することを確認する。",
    "アクセスとセキュリティ",
  ],
  cmek: [
    "Cloud StorageサービスエージェントへCMEKを許可する",
    "同じリージョンの有効なキーを指定して新しいオブジェクトを暗号化する。",
    "アクセスとセキュリティ",
  ],
  signed: [
    "IAM署名と期限付きURLを検証する",
    "署名権限・オブジェクト権限を設定し、発行直後と期限後の判定を比較する。",
    "アクセスとセキュリティ",
  ],
  transfer: [
    "専用サービスエージェントでStorage Transferを実行する",
    "コピー元の読み取りとコピー先の作成権限を分け、完了した転送を選ぶ。",
    "デプロイと実装",
  ],
  filestore: [
    "NFS共有にFilestoreを選ぶ",
    "BASIC_HDD・1TBの参照構成を作り、NFS用途へ選択する。",
    "計画と構成",
  ],
  netapp: [
    "エンタープライズNFSにNetApp Volumesを選ぶ",
    "参照構成のプールとボリュームを作り、用途へ選択する。",
    "計画と構成",
  ],
  lustre: [
    "HPC共有にManaged Lustreを選ぶ",
    "参照構成の18,000GiB・throughput 1000を設定してHPC用途へ選択する。",
    "計画と構成",
  ],
  recovery: [
    "非公開バケットの誤削除から復旧する",
    "UBLA・PAP・Versioningをそろえ、削除前の世代を復旧する。",
    "運用の維持",
  ],
  infrequent: [
    "低頻度アクセス用の非公開バケットを運用する",
    "UBLAとPAPを設定し、30日後にNEARLINEへ移す。",
    "計画と構成",
  ],
  state: [
    "stateファイルを最小IAMと世代管理で保護する",
    "非公開・UBLA・Versioningと専用SAのObject Adminを設定する。保持期間はstate更新やロック削除を妨げるため設定しない。",
    "アクセスとセキュリティ",
  ],
};
export const StorageMissions: readonly Mission[] = Object.keys(StorageSolutions).map((key) => {
  const lesson = key as StorageLesson;
  return {
    id: `storage-${lesson.toLowerCase()}`,
    domain: titles[lesson][2],
    title: titles[lesson][0],
    description: titles[lesson][1],
    setup: [
      { kind: "setProject", projectId: p },
      { kind: "setPrincipal", principal: F.owner },
    ],
    hints: [...StoragePrelude, ...StorageSolutions[lesson]],
    assertions: [{ kind: "storageLesson", lesson }],
  };
});
export const storageSatisfied = (w: World, lesson: StorageLesson): boolean => {
  const bucket = w.buckets.find((bucket) => bucket.name === b(lesson) && bucket.projectId === p);
  const object = bucket?.objects.find((o) => o.name === "report.json");
  const versions = w.storageLab.versions.filter(
    (v) => v.bucket === b(lesson) && v.name === "report.json",
  );
  const selected = (workload: string, service: string, resource: string) =>
    w.storageLab.decisions.some(
      (d) =>
        d.projectId === p &&
        d.workload === workload &&
        d.service === service &&
        d.protection === resource,
    );
  if (lesson === "filestore" || lesson === "netapp" || lesson === "lustre") {
    const services = { filestore: "filestore", netapp: "netapp-volume", lustre: "lustre" };
    const resources = { filestore: "shared-files", netapp: "shared-volume", lustre: "hpc-files" };
    const workloads = { filestore: "nfs", netapp: "enterprise-nfs", lustre: "hpc" };
    return (
      w.storageLab.files.some(
        (f) => f.projectId === p && f.kind === services[lesson] && f.name === resources[lesson],
      ) && selected(workloads[lesson], services[lesson], resources[lesson])
    );
  }
  if (lesson === "transfer") {
    const job = w.storageLab.transfers.find(
      (t) => t.projectId === p && t.name === "transferJobs/storage-lesson",
    );
    return (
      job?.operation === "SUCCESS" &&
      job.copied === 1 &&
      w.buckets.some(
        (b) => b.name === "storage-destination" && b.objects.some((o) => o.name === "report.json"),
      ) &&
      selected("bulk-transfer", "transfer", job.name)
    );
  }
  if (!bucket || !object) {
    return false;
  }
  const protection = protectionFor(w, bucket.name);
  const privateBucket = bucket.uniformBucketLevelAccess && bucket.publicAccessPrevention;
  const checked = (email: string, service: string) =>
    w.storageLab.decisions.some(
      (d) =>
        d.projectId === p && d.name === `access:${bucket.name}:${email}` && d.service === service,
    );
  switch (lesson) {
    case "classes":
      return (
        bucket.storageClass === "COLDLINE" &&
        object.storageClass.some &&
        object.storageClass.value === "ARCHIVE"
      );
    case "lifecycle":
      return (
        object.storageClass.some &&
        object.storageClass.value === "NEARLINE" &&
        bucket.lifecycleRules.some(
          (r) =>
            r.action.type === "SetStorageClass" &&
            r.action.storageClass === "NEARLINE" &&
            r.condition.age === 30,
        )
      );
    case "versioning":
      return (
        bucket.versioning &&
        versions.filter((v) => v.state === "NONCURRENT").length >= 2 &&
        object.generation !== undefined &&
        object.generation >= 3
      );
    case "ubla":
      return bucket.uniformBucketLevelAccess;
    case "iam":
      return (
        bucket.uniformBucketLevelAccess &&
        IamPolicy.hasBinding(
          bucket.iamPolicy,
          "roles/storage.objectViewer",
          `serviceAccount:${reader}`,
        ) &&
        checked(reader, "allowed") &&
        allows(w, p, reader, "storage.objects.get", bucket.iamPolicy) &&
        !allows(w, p, reader, "storage.objects.create", bucket.iamPolicy)
      );
    case "softDelete":
      return (
        protection.softDelete === 604800 &&
        versions.some((v) => v.state === "SOFT_DELETED") &&
        object.generation !== undefined &&
        object.generation > 1
      );
    case "retention":
      return protection.locked && protection.retention === 3600;
    case "pap":
      return bucket.publicAccessPrevention && checked("anonymous", "denied");
    case "cmek":
      return (
        object.kmsKey === key &&
        protection.defaultKey === key &&
        keyAccess(w, bucket, key, "Encrypt").ok &&
        keyAccess(w, bucket, key, "Decrypt").ok
      );
    case "signed":
      return (
        bucket.publicAccessPrevention &&
        w.storageLab.signed.some(
          (s) => s.bucket === bucket.name && s.signer === signer && s.verified && s.expired,
        )
      );
    case "recovery":
      return (
        privateBucket &&
        bucket.versioning &&
        versions.some((v) => v.state === "NONCURRENT") &&
        object.generation !== undefined &&
        object.generation > 1
      );
    case "infrequent":
      return (
        privateBucket &&
        object.storageClass.some &&
        object.storageClass.value === "NEARLINE" &&
        bucket.lifecycleRules.length > 0
      );
    case "state":
      return (
        privateBucket &&
        bucket.versioning &&
        protection.retention === 0 &&
        protection.softDelete > 0 &&
        IamPolicy.hasBinding(
          bucket.iamPolicy,
          "roles/storage.objectAdmin",
          `serviceAccount:${reader}`,
        ) &&
        checked(reader, "allowed") &&
        !bucket.iamPolicy.bindings.some(
          (b) => b.members.includes("allUsers") || b.members.includes("allAuthenticatedUsers"),
        )
      );
  }
};
