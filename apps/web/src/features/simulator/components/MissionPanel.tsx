import { type ReactElement, useState } from "react";
import { NavItemButton } from "@/components/NavItemButton";
import { Pill } from "@/components/Pill";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SecondaryButton } from "@/components/SecondaryButton";
import { SectionHeading } from "@/components/SectionHeading";
import { type MissionStatus, MissionStatuses } from "@/engine/domains/mission-progress";
import { World } from "@/engine/domains/world";
import { Mission, MissionDomains } from "@/engine/missions";
import { Option } from "@/utils/Option";

type MissionPanelProps = Readonly<{
  world: World;
  missions: readonly Mission[];
  selectedId: Option<string>;
  onSelect: (id: string) => void;
  onStart: (id: string) => void;
  onAbandon: (id: string) => void;
  onHint: (id: string) => void;
}>;

const StatusBadge = ({ status }: Readonly<{ status: MissionStatus }>): ReactElement => {
  switch (status) {
    case MissionStatuses.Completed:
      return <Pill tone="ok">クリア</Pill>;
    case MissionStatuses.InProgress:
      return <Pill tone="accent">挑戦中</Pill>;
    case MissionStatuses.Available:
      return <Pill tone="muted">未着手</Pill>;
  }
};

const assertionLabel = (assertion: Mission["assertions"][number]): string => {
  switch (assertion.kind) {
    case "kubeConfigInjected":
      return "ConfigMap/Secret参照とLOG_LEVELを設定し、2レプリカへ正しい値を注入";
    case "kubeConfigRefreshed":
      return "app-configのAPP_MODE=productionを再起動で2レプリカへ反映";
    case "kubeImageUpdated":
      return "helloをv1からv2へ更新し、履歴と取得権限を保って2レプリカで起動";
    case "kubeRollbackRecovered":
      return "missingへの更新履歴を残し、v1へのロールバック後も3レプリカで起動";
    case "artifactReleasePromoted":
      return "helloのv1を残し、v2とstableがhello-web-v2の同じdigestを指している";
    case "containerCleanupComplete":
      return "cleanup-localコンテナとタグ、oldイメージを削除し、cleanup-imagesとkeep:v2を保持";
    case "cloudBuildPublished":
      return "Cloud Buildが成功し、ace-imagesにhello:v1が登録されている";
    case "registryDeploymentReady":
      return "ノードの取得権限があり、helloの2レプリカとLoadBalancer（80→8080）がそろっている";
    case "localContainerReady":
      return `${assertion.name}: hello:v1で起動し ${assertion.hostPort} → 8080を公開`;
    case "artifactPublished":
      return assertion.readerOnly
        ? "hello:v1を登録し、developerのダウンロードだけを許可"
        : "ace-imagesへhello:v1を登録（hello-web v1）";
    case "terraformBackendMigrated":
      return `ローカルstateを gs://${assertion.bucket}/${assertion.prefix} へ移行（版管理有効）`;
    case "terraformDestroyed":
      return "構築した5リソースを保存済みdestroy planで削除し、stateと実リソースの両方から片付ける";
    case "terraformManaged":
      return `${assertion.resource.address}: 構成・state・実リソースが指定値と一致する`;
    case "terraformMoved":
      return `${assertion.from} → ${assertion.resource.address}: 保存した移行planがあり、再作成せずstateを移行済み`;
    case "logMetricConfigured":
      return `ログ指標 ${assertion.name} のフィルタが ${assertion.filter}`;
    case "uptimeConfigured":
      return `${assertion.displayName}: HTTPS ${assertion.host}${assertion.path} を ${assertion.period} 間隔で確認`;
    case "dashboardConfigured":
      return `ダッシュボード ${assertion.displayName} に指定のCPU指標がある`;
    case "alertConfigured":
      return `${assertion.displayName}: 指定のCPU指標 > ${assertion.threshold} が ${assertion.duration} 続く有効なアラート`;
    case "logExportConfigured":
      return `シンク ${assertion.name} の転送先・フィルタ・バケット書き込み権限がそろっている`;
    case "billingLinked":
      return `${assertion.projectId} に請求アカウントがリンクされている`;
    case "apiEnabled":
      return `${assertion.projectId} で ${assertion.api} が有効`;
    case "configurationProperty":
      return `configuration ${assertion.configuration} の ${assertion.property} が ${assertion.value}`;
    case "networkExists":
      return `VPC ${assertion.name}（${assertion.subnetMode}）がある`;
    case "subnetExists":
      return `サブネット ${assertion.name}（${assertion.region}, ${assertion.ipCidrRange}）がある`;
    case "serviceAccountExists":
      return `サービスアカウント ${assertion.accountId} がある`;
    case "bindingExists":
      return `${assertion.target.type} ${assertion.target.id} に ${assertion.member} → ${assertion.role}`;
    case "bindingAbsent":
      return `${assertion.target.type} ${assertion.target.id} に ${assertion.member} → ${assertion.role} が無い`;
    case "instanceExists":
      return `VM ${assertion.name}（${assertion.zone}${Option.isSome(assertion.machineType) ? `, ${assertion.machineType.value}` : ""}${Option.isSome(assertion.status) ? `, ${assertion.status.value}` : ""}${assertion.tags.length > 0 ? `, tags: ${assertion.tags.join(",")}` : ""}）がある`;
    case "firewallRuleExists":
      return `ファイアウォール ${assertion.name}（${assertion.allow} → ${assertion.targetTag}）がある`;
    case "bucketExists":
      return `バケット ${assertion.name}（${assertion.location}, ${assertion.storageClass}）がある`;
    case "clusterExists":
      return `クラスタ ${assertion.name}（${assertion.autopilot ? "Autopilot" : "Standard"}, ${assertion.location}）がある`;
    case "snapshotExists":
      return `スナップショット ${assertion.name} がある`;
    case "runServiceExists":
      return `Cloud Run ${assertion.name}（${assertion.region}${assertion.allowUnauthenticated ? ", 未認証許可" : ""}）がある`;
    case "effectivePermission":
      return `${assertion.member} が ${assertion.projectId} で ${assertion.permission} を持つ`;
    case "kubeDeploymentExists":
      return `クラスタ ${assertion.cluster} に Deployment ${assertion.name}（${assertion.replicas} レプリカ）がある`;
    case "kubeServiceExists":
      return `クラスタ ${assertion.cluster} に Service ${assertion.name}（${assertion.type}）がある`;
    case "functionExists":
      return `関数 ${assertion.name}（${assertion.region}, ${assertion.trigger === "http" ? "HTTP" : "Pub/Sub"}${assertion.allowUnauthenticated ? ", 未認証許可" : ""}）がある`;
    case "sqlInstanceExists":
      return `Cloud SQL ${assertion.name}（${assertion.databaseVersion}）がある`;
    case "topicExists":
      return `トピック ${assertion.name} がある`;
    case "subscriptionExists":
      return `サブスクリプション ${assertion.name}（topic: ${assertion.topic}）がある`;
    case "budgetExists":
      return `請求アカウント ${assertion.billingAccountId} に ${assertion.amount} JPY の予算がある`;
    case "instanceGroupExists":
      return `MIG ${assertion.name}（${assertion.targetSize} 台${assertion.autoscaled ? ", 自動スケール" : ""}）がある`;
    case "customRoleExists":
      return `カスタムロール ${assertion.roleId}（${assertion.permissions.join(", ")}）がある`;
  }
};

const MissionBrief = ({
  world,
  mission,
  onStart,
  onAbandon,
  onHint,
}: Readonly<
  { world: World; mission: Mission } & Pick<MissionPanelProps, "onStart" | "onAbandon" | "onHint">
>): ReactElement => {
  const progress = World.findMissionProgress(world, mission.id);
  const status = Option.isSome(progress) ? progress.value.status : MissionStatuses.Available;
  const revealed = Option.isSome(progress) ? progress.value.revealedHints : 0;
  const results = Mission.assertionResults(world, mission);
  return (
    <section aria-label={mission.title} className="border-line border-t p-4">
      <div className="mb-2 flex items-center gap-2">
        <h4 className="font-semibold">{mission.title}</h4>
        <StatusBadge status={status} />
      </div>
      <p className="mb-3 text-sm">{mission.description}</p>
      <h5 className="mb-2 font-semibold">達成条件</h5>
      <ul className="mb-3 space-y-1 text-sm">
        {mission.assertions.map((assertion, index) => (
          <li key={assertionLabel(assertion)} className="flex items-start gap-2">
            <span aria-hidden="true" className={results[index] ? "text-ok-ink" : "text-muted"}>
              {results[index] ? "✓" : "○"}
            </span>
            <span className={results[index] ? "text-ok-ink" : ""}>{assertionLabel(assertion)}</span>
          </li>
        ))}
      </ul>
      <h5 className="mb-2 font-semibold">手順・ヒント</h5>
      <p className="mb-3 text-sm text-muted">開始後、ヒントを押すと手順を1つずつ確認できます。</p>
      {revealed > 0 && (
        <ol className="mb-3 list-decimal space-y-1 rounded bg-canvas px-4 py-2 text-sm">
          {mission.hints.slice(0, revealed).map((hint) => (
            <li key={hint} className="ml-4 break-all font-mono text-xs">
              {hint}
            </li>
          ))}
        </ol>
      )}
      <div className="flex flex-wrap gap-2">
        {status !== MissionStatuses.InProgress && (
          <PrimaryButton onClick={() => onStart(mission.id)}>
            {status === MissionStatuses.Completed ? "再挑戦" : "開始"}
          </PrimaryButton>
        )}
        {status === MissionStatuses.InProgress && (
          <>
            <SecondaryButton
              onClick={() => onHint(mission.id)}
              disabled={revealed >= mission.hints.length}
            >
              ヒント（{revealed}/{mission.hints.length}）
            </SecondaryButton>
            <SecondaryButton onClick={() => onAbandon(mission.id)}>中断</SecondaryButton>
          </>
        )}
      </div>
    </section>
  );
};

/** カテゴリ → ミッション → 手順。詳細を一覧の下へ押し流さない。 */
export const MissionPanel = ({
  world,
  missions,
  selectedId,
  onSelect,
  onStart,
  onAbandon,
  onHint,
}: MissionPanelProps): ReactElement => {
  const [view, setView] = useState<
    { kind: "categories" } | { kind: "list"; domain: string } | { kind: "detail" }
  >(() => (Option.isSome(selectedId) ? { kind: "detail" } : { kind: "categories" }));
  const selected = Option.isSome(selectedId)
    ? missions.find((m) => m.id === selectedId.value)
    : undefined;
  const statusOf = (id: string): MissionStatus =>
    Option.unwrapOr(
      Option.map(World.findMissionProgress(world, id), (p) => p.status),
      MissionStatuses.Available,
    );
  if (view.kind === "detail" && selected)
    return (
      <div>
        <nav aria-label="ミッションの移動" className="flex flex-wrap gap-2 p-3">
          <SecondaryButton onClick={() => setView({ kind: "categories" })}>
            カテゴリへ
          </SecondaryButton>
          <SecondaryButton onClick={() => setView({ kind: "list", domain: selected.domain })}>
            一覧へ戻る
          </SecondaryButton>
        </nav>
        <p className="px-4 text-sm text-muted">{selected.domain}</p>
        <MissionBrief
          world={world}
          mission={selected}
          onStart={onStart}
          onAbandon={onAbandon}
          onHint={onHint}
        />
      </div>
    );
  if (view.kind === "list")
    return (
      <section aria-label={view.domain} className="p-3">
        <SecondaryButton onClick={() => setView({ kind: "categories" })}>
          カテゴリへ
        </SecondaryButton>
        <SectionHeading className="pt-4 pb-2">{view.domain}</SectionHeading>
        <p className="mb-3 text-sm text-muted">
          ミッションを1つ選ぶと、達成条件と手順を確認できます。
        </p>
        <ul className="space-y-2">
          {missions
            .filter((m) => m.domain === view.domain)
            .map((mission) => (
              <li key={mission.id}>
                <NavItemButton
                  current={selected?.id === mission.id}
                  className="flex items-center gap-2 rounded border border-line p-3 text-sm"
                  onClick={() => {
                    onSelect(mission.id);
                    setView({ kind: "detail" });
                  }}
                >
                  <span className="min-w-0 flex-1 text-left">{mission.title}</span>
                  <StatusBadge status={statusOf(mission.id)} />
                </NavItemButton>
              </li>
            ))}
        </ul>
      </section>
    );
  return (
    <section aria-label="ミッションカテゴリ" className="p-3">
      <SectionHeading className="pb-2">カテゴリを選択</SectionHeading>
      <p className="mb-3 text-sm text-muted">学習したい分野から、ミッションを選んで進めます。</p>
      <ul className="space-y-2">
        {Object.values(MissionDomains).map((domain) => {
          const items = missions.filter((m) => m.domain === domain);
          if (!items.length) return null;
          const completed = items.filter(
            (m) => statusOf(m.id) === MissionStatuses.Completed,
          ).length;
          const active = items.filter((m) => statusOf(m.id) === MissionStatuses.InProgress).length;
          return (
            <li key={domain}>
              <NavItemButton
                current={false}
                className="rounded border border-line p-3 text-left"
                onClick={() => setView({ kind: "list", domain })}
              >
                <span className="block font-semibold">{domain}</span>
                <span className="mt-1 block text-sm text-muted">
                  {completed}/{items.length} クリア{active > 0 ? ` ・ ${active}件 挑戦中` : ""}
                </span>
              </NavItemButton>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
