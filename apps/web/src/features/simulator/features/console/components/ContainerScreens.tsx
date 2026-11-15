import type { ReactElement } from "react";

import { CloudRunService, type GkeCluster } from "@/engine/domains/managed-services";
import { World } from "@/engine/domains/world";
import {
  ResourceTable,
  ScreenTitle,
} from "@/features/simulator/features/console/components/ConsoleParts";
import { DeleteCommand } from "@/features/simulator/features/console/domains/equivalent-command";
import type { ScreenProps } from "@/features/simulator/features/console/types/screen-props";
import { Option } from "@/utils/Option";

/** Kubernetes Engine › クラスタ: 一覧と削除（作成は CLI から: 設計書 3.1 の Console の範囲）。 */
export const ClustersScreen = ({ world, project, handlers }: ScreenProps): ReactElement => {
  const remove = (cluster: GkeCluster): void => {
    if (!handlers.confirm(`クラスタ ${cluster.name} を削除しますか？`)) return;
    handlers.submit({
      line: DeleteCommand.cluster(cluster, project.projectId),
      note: `クラスタを削除 (${cluster.name})`,
      next: Option.none,
    });
  };
  return (
    <div>
      <ScreenTitle eyebrow="Kubernetes Engine" title="クラスタ" />
      <ResourceTable
        label="クラスタ"
        rows={World.clustersOf(world, project.projectId)}
        keyOf={(c) => c.name}
        empty="クラスタはまだありません。gcloud container clusters create で作れます。"
        onDelete={remove}
        columns={[
          { header: "名前", cell: (c) => <span className="font-mono">{c.name}</span> },
          { header: "ロケーション", cell: (c) => c.location },
          { header: "モード", cell: (c) => (c.autopilot ? "Autopilot" : "Standard") },
          { header: "ノード数", cell: (c) => (c.autopilot ? "自動" : String(c.nodeCount)) },
          {
            header: "バージョン",
            cell: (c) => <span className="font-mono text-xs">{c.currentMasterVersion}</span>,
          },
          { header: "状態", cell: (c) => c.status },
        ]}
      />
    </div>
  );
};

/** Cloud Run › サービス: 一覧と削除（デプロイは CLI から: 設計書 3.1 の Console の範囲）。 */
export const RunServicesScreen = ({ world, project, handlers }: ScreenProps): ReactElement => {
  const remove = (service: CloudRunService): void => {
    if (!handlers.confirm(`サービス ${service.name} を削除しますか？`)) return;
    handlers.submit({
      line: DeleteCommand.runService(service, project.projectId),
      note: `Cloud Run サービスを削除 (${service.name})`,
      next: Option.none,
    });
  };
  return (
    <div>
      <ScreenTitle eyebrow="Cloud Run" title="サービス" />
      <ResourceTable
        label="Cloud Run サービス"
        rows={World.runServicesOf(world, project.projectId)}
        keyOf={(s) => s.name}
        empty="サービスはまだありません。gcloud run deploy で作れます。"
        onDelete={remove}
        columns={[
          { header: "名前", cell: (s) => <span className="font-mono">{s.name}</span> },
          { header: "リージョン", cell: (s) => s.region },
          {
            header: "URL",
            cell: (s) => <span className="font-mono text-xs">{CloudRunService.url(s)}</span>,
          },
          {
            header: "認証",
            cell: (s) => (s.allowUnauthenticated ? "未認証の呼び出しを許可" : "認証が必要"),
          },
          { header: "最終デプロイ", cell: (s) => s.lastDeployedAt },
        ]}
      />
    </div>
  );
};
