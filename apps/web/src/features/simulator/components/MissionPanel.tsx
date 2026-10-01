import type { ReactElement } from "react";

import { PrimaryButton, SecondaryButton } from "@/components/Button";
import { Pill } from "@/components/Pill";
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
      {revealed > 0 && (
        <ol className="mb-3 list-decimal space-y-1 rounded bg-canvas px-4 py-2 text-sm">
          {mission.hints.slice(0, revealed).map((hint) => (
            <li key={hint} className="ml-4 font-mono text-xs">
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

/** 右ペイン「ミッション」: ドメインごとの一覧と、選んだミッションの進捗（UC-006）。 */
export const MissionPanel = ({
  world,
  missions,
  selectedId,
  onSelect,
  onStart,
  onAbandon,
  onHint,
}: MissionPanelProps): ReactElement => {
  const selected = Option.flatMap(selectedId, (id) =>
    Option.fromNullable(missions.find((m) => m.id === id)),
  );
  return (
    <div>
      <ul className="p-2">
        {Object.values(MissionDomains).map((domain) => (
          <li key={domain}>
            <SectionHeading className="px-2 pt-3 pb-1">{domain}</SectionHeading>
            <ul>
              {missions
                .filter((m) => m.domain === domain)
                .map((mission) => {
                  const status = Option.unwrapOr(
                    Option.map(World.findMissionProgress(world, mission.id), (p) => p.status),
                    MissionStatuses.Available,
                  );
                  const isSelected = Option.isSome(selected) && selected.value.id === mission.id;
                  return (
                    <li key={mission.id}>
                      <button
                        type="button"
                        className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${isSelected ? "bg-accent-soft" : "hover:bg-canvas"}`}
                        onClick={() => onSelect(mission.id)}
                        aria-current={isSelected ? "true" : undefined}
                      >
                        <span className="flex-1">{mission.title}</span>
                        <StatusBadge status={status} />
                      </button>
                    </li>
                  );
                })}
            </ul>
          </li>
        ))}
      </ul>
      {Option.isSome(selected) && (
        <MissionBrief
          world={world}
          mission={selected.value}
          onStart={onStart}
          onAbandon={onAbandon}
          onHint={onHint}
        />
      )}
    </div>
  );
};
