import { IamPolicy } from "@/engine/domains/iam-policy";
import { allows } from "@/engine/domains/serverless-lab/runtime";
import { keyAccess, protectionFor } from "@/engine/domains/storage-lab/model";
import type { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { MissionStep } from "@/engine/missions/mission-step";

const p = F.devProjectId;
const reader = `storage-reader@${p}.iam.gserviceaccount.com`;
const signer = `storage-signer@${p}.iam.gserviceaccount.com`;
const agent = "project-481200000001@storage-transfer-service.iam.gserviceaccount.com";
const key = `projects/${p}/locations/us-central1/keyRings/storage-ring/cryptoKeys/storage-key`;
const b = (lesson: string) => `storage-${lesson.toLowerCase()}`;
const create = (what: string, lesson: string, flags = "", note?: string) =>
  MissionStep.run(
    what,
    `gcloud storage buckets create gs://${b(lesson)} --location=us-central1 ${flags}`,
    note,
  );
const upload = (lesson: string, what = "report.jsonをアップロードする", note?: string) =>
  MissionStep.run(what, `gcloud storage cp ./report.json gs://${b(lesson)}/report.json`, note);
const bind = (what: string, bucket: string, email: string, role: string, note?: string) =>
  MissionStep.run(
    what,
    `gcloud storage buckets add-iam-policy-binding gs://${bucket} --member=serviceAccount:${email} --role=roles/storage.${role}`,
    note,
  );
const update = (what: string, lesson: string, flags: string, note?: string) =>
  MissionStep.run(what, `gcloud storage buckets update gs://${b(lesson)} ${flags}`, note);
const decision = (what: string, lesson: string, principal: string, note?: string) =>
  MissionStep.run(
    what,
    `sim storage access check gs://${b(lesson)}/report.json --principal=${principal}`,
    note,
  );
const privateBucket = (lesson: string, what = "UBLAとPAPを有効にしてバケットを作る") =>
  create(
    what,
    lesson,
    "--uniform-bucket-level-access --public-access-prevention",
    "ACLを使わずIAMだけで管理し、公開設定も入らないようにします。",
  );
const versioning = (lesson: string) =>
  update(
    "オブジェクトのバージョニングを有効にする",
    lesson,
    "--versioning",
    "上書きや削除の前の世代が、非現行として残るようになります。",
  );
const nearline = (lesson: string) => [
  update(
    "30日でNEARLINEへ移すルールを設定する",
    lesson,
    "--lifecycle-file=lifecycle-nearline.json",
    "lifecycle-nearline.jsonは、作成から30日でSetStorageClass（NEARLINE）を行うルールです。",
  ),
  MissionStep.run(
    "時間を30日進める",
    "sim storage time advance --seconds=2592000",
    "2592000秒は30日です。",
  ),
  MissionStep.run(
    "ライフサイクルルールを評価させる",
    `sim storage lifecycle run gs://${b(lesson)}`,
    "実際には非同期に適用されますが、教材では明示的に評価します。",
  ),
];
const readerAccount = (what: string) =>
  MissionStep.run(what, "gcloud iam service-accounts create storage-reader");
export const StoragePreludeSteps: readonly MissionStep[] = [
  MissionStep.run(
    "ストレージ教材で使うAPIをまとめて有効にする",
    "gcloud services enable storage.googleapis.com cloudkms.googleapis.com iamcredentials.googleapis.com storagetransfer.googleapis.com file.googleapis.com netapp.googleapis.com lustre.googleapis.com",
  ),
];
export const StoragePrelude: readonly string[] = MissionStep.lines(StoragePreludeSteps);
export const StorageSteps = {
  classes: [
    create(
      "既定クラスをCOLDLINEにしてバケットを作る",
      "classes",
      "--default-storage-class=COLDLINE",
    ),
    upload(
      "classes",
      "report.jsonをアップロードする",
      "クラスを指定しないので、バケットの既定のCOLDLINEで保存されます。",
    ),
    MissionStep.run(
      "report.jsonだけをARCHIVEに変える",
      "gcloud storage objects update gs://storage-classes/report.json --storage-class=ARCHIVE",
      "オブジェクトのクラスはバケットの既定と別に持てます。",
    ),
  ],
  lifecycle: [
    create("ライフサイクル用のバケットを作る", "lifecycle"),
    upload("lifecycle"),
    ...nearline("lifecycle"),
  ],
  versioning: [
    create("世代管理用のバケットを作る", "versioning"),
    versioning("versioning"),
    upload("versioning"),
    upload(
      "versioning",
      "もう一度アップロードして上書きする",
      "上書き前の世代は非現行として残ります。",
    ),
    MissionStep.run(
      "最初の世代を新しいlive世代として復元する",
      "sim storage versions restore gs://storage-versioning/report.json#1 --allow-overwrite",
      "#1は世代番号です。復元は古い世代をコピーして新しい世代を作ります。",
    ),
  ],
  ubla: [
    create("UBLAを付けずにバケットを作る", "ubla"),
    upload("ubla"),
    update(
      "均一なバケットレベルのアクセス（UBLA）を有効にする",
      "ubla",
      "--uniform-bucket-level-access",
      "以後はACLが効かなくなり、アクセスはIAMだけで決まります。",
    ),
  ],
  iam: [
    create("UBLAを有効にしてバケットを作る", "iam", "--uniform-bucket-level-access"),
    upload("iam"),
    readerAccount("読み取り専用のサービスアカウントを作る"),
    bind(
      "storage-readerにObject Viewerを付ける",
      b("iam"),
      reader,
      "objectViewer",
      "プロジェクトではなくバケットに付けるので、ほかのバケットには効きません。",
    ),
    decision("storage-readerがreport.jsonを読めるか判定する", "iam", reader),
  ],
  softDelete: [
    create("soft delete期間7日でバケットを作る", "softDelete", "--soft-delete-duration=7d"),
    upload("softDelete"),
    MissionStep.run(
      "report.jsonを削除する",
      "gcloud storage rm gs://storage-softdelete/report.json --quiet",
      "soft delete期間のあいだは、削除された世代が残ります。",
    ),
    MissionStep.run(
      "削除した世代を復元する",
      "gcloud storage restore gs://storage-softdelete/report.json#1",
      "復元した世代が新しいlive世代になります。",
    ),
  ],
  retention: [
    create("保持期間1時間でバケットを作る", "retention", "--retention-period=1h"),
    update(
      "保持ポリシーをロックする",
      "retention",
      "--lock-retention-period",
      "ロックすると、保持期間の短縮や解除ができなくなります。",
    ),
    upload("retention", "report.jsonを保存する", "保持期間が過ぎるまで削除も上書きもできません。"),
  ],
  pap: [
    create("公開を試すバケットを作る", "pap"),
    upload("pap"),
    MissionStep.run(
      "allUsersに公開読み取りを付ける",
      "gsutil iam ch allUsers:objectViewer gs://storage-pap",
      "PAPの効果を見るために、わざと公開設定を入れます。",
    ),
    update("Public Access Preventionを有効にする", "pap", "--public-access-prevention"),
    decision(
      "匿名アクセスが拒否されるか判定する",
      "pap",
      "anonymous",
      "公開IAMが残っていても、PAPが有効なら匿名アクセスは拒否されます。",
    ),
  ],
  cmek: [
    MissionStep.run(
      "us-central1にキーリングを作る",
      "gcloud kms keyrings create storage-ring --location=us-central1",
    ),
    MissionStep.run(
      "暗号化用の鍵を作る",
      "gcloud kms keys create storage-key --keyring=storage-ring --location=us-central1 --purpose=encryption",
    ),
    MissionStep.run(
      "Cloud Storageのサービスエージェントに鍵の使用を許可する",
      `gcloud storage service-agent --authorize-cmek=${key}`,
      "暗号化と復号を行うのはサービスエージェントなので、鍵の権限はここに付けます。",
    ),
    create(
      "この鍵を既定の暗号鍵にしてバケットを作る",
      "cmek",
      `--default-encryption-key=${key}`,
      "鍵はバケットと同じリージョンのものを使います。",
    ),
    upload("cmek", "report.jsonを保存して鍵で暗号化させる"),
  ],
  signed: [
    create("公開を禁止したバケットを作る", "signed", "--public-access-prevention"),
    upload("signed"),
    MissionStep.run(
      "署名用のサービスアカウントを作る",
      "gcloud iam service-accounts create storage-signer",
    ),
    MissionStep.run(
      "自分にstorage-signerで署名する権限を付ける",
      `gcloud iam service-accounts add-iam-policy-binding ${signer} --member=user:${F.owner} --role=roles/iam.serviceAccountTokenCreator`,
      "SAになりすまして署名するには、Service Account Token Creatorが要ります。",
    ),
    bind(
      "storage-signerにObject Viewerを付ける",
      b("signed"),
      signer,
      "objectViewer",
      "署名付きURLで読めるかどうかは、署名したSAの権限で決まります。",
    ),
    MissionStep.run(
      "10分だけ有効な署名付きURLを発行する",
      `gcloud storage sign-url gs://storage-signed/report.json --duration=10m --impersonate-service-account=${signer}`,
    ),
    MissionStep.run(
      "発行直後にURLが使えるか確かめる",
      "sim storage signed-url check signed-2",
      "signed-2は、教材が発行したURLに付けたIDです。",
    ),
    MissionStep.run("時間を10分1秒進める", "sim storage time advance --seconds=601"),
    MissionStep.run("期限切れのURLが拒否されるか確かめる", "sim storage signed-url check signed-2"),
  ],
  transfer: [
    create("コピー元のバケットを作る", "source"),
    create("コピー先のバケットを作る", "destination"),
    upload("source"),
    ...[b("source"), b("destination")].map((n) =>
      bind(
        `転送エージェントに${n}の一覧を読む権限を付ける`,
        n,
        agent,
        "legacyBucketReader",
        "Storage Transferは、両方のバケットのメタデータと一覧を読みます。",
      ),
    ),
    bind("転送エージェントにコピー元の読み取りを付ける", b("source"), agent, "objectViewer"),
    bind(
      "転送エージェントにコピー先への書き込みを付ける",
      b("destination"),
      agent,
      "objectCreator",
    ),
    MissionStep.run(
      "すぐには走らない転送ジョブを作る",
      "gcloud transfer jobs create gs://storage-source gs://storage-destination --name=transferJobs/storage-lesson --do-not-run",
    ),
    MissionStep.run(
      "転送ジョブを実行して完了を待つ",
      "gcloud transfer jobs run transferJobs/storage-lesson --no-async",
    ),
    MissionStep.run(
      "大量転送の手段としてこのジョブを選ぶ",
      "sim storage choose --workload=bulk-transfer --resource=transferJobs/storage-lesson",
    ),
  ],
  filestore: [
    MissionStep.run(
      "BASIC_HDD・1TBのFilestoreを作る",
      "gcloud filestore instances create shared-files --zone=us-central1-c --tier=BASIC_HDD --file-share=name=my_vol,capacity=1TB --network=name=default",
    ),
    MissionStep.run(
      "NFS共有の手段としてFilestoreを選ぶ",
      "sim storage choose --workload=nfs --resource=shared-files",
    ),
  ],
  netapp: [
    MissionStep.run(
      "2048GiBのストレージプールを作る",
      "gcloud netapp storage-pools create shared-pool --location=us-central1 --capacity=2048 --service-level=standard --network=name=default",
    ),
    MissionStep.run(
      "プールからNFSv3/v4で共有するボリュームを切り出す",
      "gcloud netapp volumes create shared-volume --location=us-central1 --capacity=1024 --protocols=nfsv3,nfsv4 --share-name=share1 --storage-pool=shared-pool",
    ),
    MissionStep.run(
      "エンタープライズNFSの手段としてNetApp Volumesを選ぶ",
      "sim storage choose --workload=enterprise-nfs --resource=shared-volume",
    ),
  ],
  lustre: [
    MissionStep.run(
      "18,000GiBのManaged Lustreを作る",
      `gcloud lustre instances create hpc-files --location=us-central1-a --capacity-gib=18000 --per-unit-storage-throughput=1000 --filesystem=lustrefs --network=projects/${p}/global/networks/default`,
    ),
    MissionStep.run(
      "HPC共有の手段としてManaged Lustreを選ぶ",
      "sim storage choose --workload=hpc --resource=hpc-files",
    ),
  ],
  recovery: [
    privateBucket("recovery"),
    versioning("recovery"),
    upload("recovery"),
    MissionStep.run(
      "report.jsonを誤って削除する",
      "gcloud storage rm gs://storage-recovery/report.json --quiet",
      "バージョニングが有効なので、削除前の世代は非現行として残ります。",
    ),
    MissionStep.run(
      "削除前の世代を復元する",
      "sim storage versions restore gs://storage-recovery/report.json#1",
    ),
  ],
  infrequent: [privateBucket("infrequent"), upload("infrequent"), ...nearline("infrequent")],
  state: [
    privateBucket("state", "stateファイル用の非公開バケットを作る"),
    versioning("state"),
    readerAccount("state操作用のサービスアカウントを作る"),
    bind(
      "storage-readerにObject Adminを付ける",
      b("state"),
      reader,
      "objectAdmin",
      "stateの読み書きと、ロック用オブジェクトの削除に必要です。",
    ),
    MissionStep.run(
      "同名のオブジェクトが無いときだけstateを保存する",
      "gcloud storage cp ./terraform.tfstate gs://storage-state/report.json --if-generation-match=0",
      "--if-generation-match=0は、まだ存在しない場合だけ書き込む条件です。",
    ),
    decision("storage-readerがstateを扱えるか判定する", "state", reader),
  ],
};
export const StorageSolutions: Readonly<Record<StorageLesson, readonly string[]>> =
  Object.fromEntries(
    Object.entries<readonly MissionStep[]>(StorageSteps).map(([k, v]) => [k, MissionStep.lines(v)]),
  ) as Record<StorageLesson, readonly string[]>;
export type StorageLesson = keyof typeof StorageSteps;
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
export const StorageMissions: readonly Mission[] = Object.keys(StorageSteps).map((key) => {
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
    steps: [...StoragePreludeSteps, ...StorageSteps[lesson]],
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
