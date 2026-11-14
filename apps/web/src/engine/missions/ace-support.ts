import { AceScenarios } from "@/engine/domains/ace-support/catalog";
import type { AiResource } from "@/engine/domains/ace-support/model";
import { EffectivePermissions } from "@/engine/domains/effective-permissions";
import { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import type { Mission } from "@/engine/missions";
import { MissionStep } from "@/engine/missions/mission-step";

export type AiLesson = "agent" | "notebook" | "workstation";
export type AceAssertion =
  | Readonly<{ kind: "aceDecision"; scenario: string }>
  | Readonly<{ kind: "aiLesson"; lesson: AiLesson }>;
const p = F.devProjectId;
export const aiLessonName = (kind: AiLesson): string => `ace-${kind}`;
export const aiLessonSa = (kind: AiLesson): string =>
  `${aiLessonName(kind)}@${p}.iam.gserviceaccount.com`;
const platform: Record<AiLesson, AiResource["platform"]> = {
  agent: "vertex-ai",
  notebook: "workbench",
  workstation: "workstations",
};
const api = {
  agent: "aiplatform.googleapis.com",
  notebook: "notebooks.googleapis.com",
  workstation: "workstations.googleapis.com",
} as const;
export const aiSolutions = (kind: AiLesson): readonly MissionStep[] => {
  const name = aiLessonName(kind);
  const net = `${name}-net`;
  const subnet = `${name}-subnet`;
  const sa = aiLessonSa(kind);
  const idle = kind === "agent" ? "" : " --idle-minutes=60";
  const updateIdle = kind === "agent" ? "" : " --idle-minutes=15";
  const target = `${name} --region=us-central1`;
  return [
    MissionStep.run(
      "教材で使う Compute・IAM・製品の API を有効にする",
      `gcloud services enable compute.googleapis.com iam.googleapis.com ${api[kind]}`,
    ),
    MissionStep.run(
      "教材専用のカスタムモード VPC を作る",
      `gcloud compute networks create ${net} --subnet-mode=custom`,
    ),
    MissionStep.run(
      "限定公開の Google アクセス付きのサブネットを作る",
      `gcloud compute networks subnets create ${subnet} --network=${net} --region=us-central1 --range=10.60.0.0/24 --enable-private-ip-google-access`,
      "外部 IP の無いリソースからでも Google API に届くようにします。",
    ),
    MissionStep.run(
      "リソース専用のサービスアカウントを作る",
      `gcloud iam service-accounts create ${name}`,
    ),
    MissionStep.run(
      "自分がこの SA をリソースに割り当てられるようにする",
      `gcloud iam service-accounts add-iam-policy-binding ${sa} --member=user:${F.owner} --role=roles/iam.serviceAccountUser`,
      "SA を割り当てる人には、その SA に対する serviceAccountUser が要ります。",
    ),
    MissionStep.run(
      "SA に Storage の閲覧ロールだけを付ける",
      `gcloud projects add-iam-policy-binding ${p} --member=serviceAccount:${sa} --role=roles/storage.objectViewer`,
      "最小権限にするため、これ以外のロールは付けません。",
    ),
    MissionStep.run(
      "まず public 構成で教材リソースを作る",
      `sim ai resources create ${target} --kind=${kind} --platform=${platform[kind]} --service-account=${sa} --subnet=${subnet} --access=public${idle}`,
    ),
    MissionStep.run("public 構成のまま開始する", `sim ai resources start ${target}`),
    MissionStep.run("構成を直すために停止する", `sim ai resources stop ${target}`),
    MissionStep.run(
      kind === "agent"
        ? "接続を private 構成に直す"
        : "private 構成に直し、idle timeout を 15 分にする",
      `sim ai resources update ${target} --access=private${updateIdle}`,
    ),
    MissionStep.run("直した構成で再開する", `sim ai resources start ${target}`),
  ];
};

/** 正解の選択と現在の構成を確認する。理由の自由文は意味採点しない。 */
export const aceSatisfied = (world: World, a: AceAssertion): boolean => {
  if (a.kind === "aceDecision") {
    const scenario = AceScenarios.find((s) => s.id === a.scenario);
    return world.aceSupport.decisions.some(
      (d) => d.projectId === p && d.scenario === scenario?.id && d.choice === scenario.answer,
    );
  }
  const kind = a.lesson;
  const r = world.aceSupport.resources.find(
    (item) =>
      item.projectId === p && item.name === aiLessonName(kind) && item.region === "us-central1",
  );
  if (!r || r.kind !== kind || r.platform !== platform[kind]) {
    return false;
  }
  if (
    r.status !== "RUNNING" ||
    r.access !== "private" ||
    r.revision < 2 ||
    r.lastStartedRevision !== r.revision ||
    r.securedFromRevision === 0 ||
    r.securedFromRevision !== r.publicStoppedRevision ||
    r.revision <= r.securedFromRevision
  ) {
    return false;
  }
  if (
    r.starts < 2 ||
    r.stops < 1 ||
    r.subnet !== `${aiLessonName(kind)}-subnet` ||
    r.serviceAccount !== aiLessonSa(kind)
  ) {
    return false;
  }
  if (kind !== "agent" && r.idleMinutes !== 15) {
    return false;
  }
  const sa = world.serviceAccounts.find((s) => s.email === r.serviceAccount);
  const subnet = world.subnets.find(
    (s) => s.projectId === p && s.name === r.subnet && s.region === r.region,
  );
  if (!sa || !subnet?.privateIpGoogleAccess || !World.hasApi(world, p, api[kind])) {
    return false;
  }
  const permissions = EffectivePermissions.resolve(world, `serviceAccount:${sa.email}`, {
    type: "project",
    id: p,
  });
  const allowed = new Set(["storage.objects.get", "storage.objects.list", "storage.buckets.get"]);
  return (
    permissions.permissions.has("storage.objects.get") &&
    [...permissions.permissions].every((permission) => allowed.has(permission))
  );
};

export const AceDecisionMissions: readonly Mission[] = AceScenarios.map((s) => ({
  id: `m-ace-${s.id}`,
  domain: s.domain,
  title: s.title,
  description: `判断演習: ${s.requirements} 選択肢: ${s.choices.join(" / ")}。理由を記録してください。固定した選択を採点し、自由文の意味は採点しません。`,
  steps: [
    MissionStep.run("要件・選択肢・解説を確かめる", `sim ace scenarios describe ${s.id}`),
    MissionStep.run(
      "要件に合う選択肢を選び、理由を記録する",
      `sim ace scenarios choose ${s.id} --choice=${s.answer} --reason='${s.reason}'`,
      "採点されるのは選んだ選択肢だけで、理由の文は採点されません。",
    ),
  ],
  setup: [
    { kind: "setProject", projectId: p },
    { kind: "setPrincipal", principal: F.owner },
  ],
  assertions: [{ kind: "aceDecision", scenario: s.id }],
}));
export const AiMissions: readonly Mission[] = (["agent", "notebook", "workstation"] as const).map(
  (kind) => ({
    id: `m-ai-${kind}`,
    domain: "運用の維持",
    title: `${kind}の教材構成を停止・修正・再開する`,
    description:
      "専用SAとregional subnetを用意し、public構成の開始・停止後、private構成に修正して再開する。notebook/IDEのidle timeoutは15分。SAはStorage閲覧だけにする。教材のRUNNINGは構成状態であり、実agent・VM・IDEの起動や推論は行いません。",
    steps: aiSolutions(kind),
    setup: [
      { kind: "setProject", projectId: p },
      { kind: "setPrincipal", principal: F.owner },
    ],
    assertions: [{ kind: "aiLesson", lesson: kind }],
  }),
);
