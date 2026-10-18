import type { ReactElement } from "react";
import { PublicImage, Zone } from "@/engine/domains/catalog";
import { MigLocation } from "@/engine/domains/resource-location";
import { World } from "@/engine/domains/world";
import { screenText } from "@/features/simulator/features/console/components/ConsoleNav";
import {
  ResourceTable,
  ScreenTitle,
} from "@/features/simulator/features/console/components/ConsoleParts";
import type { ScreenProps } from "@/features/simulator/features/console/types/screen-props";
import { Option } from "@/utils/Option";

type ResourceScreen =
  | "instance-templates"
  | "instance-groups"
  | "disks"
  | "snapshots"
  | "images"
  | "operations"
  | "zones";

type Row = Readonly<{ key: string; cells: readonly string[] }>;
type Listing = Readonly<{ headers: readonly string[]; rows: readonly Row[] }>;
const row = (key: string, ...cells: string[]): Row => ({ key, cells });

/** 一覧はコマンドを投入せず、CLI と共有する World の現在の内容を表示する。 */
const listingOf = (screen: ResourceScreen, world: World, projectId: string): Listing => {
  switch (screen) {
    case "instance-templates":
      return {
        headers: ["名前", "マシンタイプ", "イメージ", "ネットワーク"],
        rows: World.namedOf(world, "instanceTemplates", projectId).map((t) =>
          row(t.name, t.name, t.machineType, t.image.name, t.network),
        ),
      };
    case "instance-groups":
      return {
        headers: ["名前", "ロケーション", "テンプレート", "台数"],
        rows: world.instanceGroups
          .filter((g) => g.projectId === projectId)
          .map((g) =>
            row(
              `${MigLocation.name(g.location)}/${g.name}`,
              g.name,
              MigLocation.name(g.location),
              g.template,
              String(g.targetSize),
            ),
          ),
      };
    case "disks":
      return {
        headers: ["名前", "ロケーション", "サイズ (GB)", "種類"],
        rows: [
          ...World.instancesOf(world, projectId).flatMap((instance) =>
            instance.disks
              .filter((d) => d.boot)
              .map((d) =>
                row(
                  `${instance.zone}/${d.deviceName}`,
                  d.deviceName,
                  instance.zone,
                  String(d.sizeGb),
                  d.type,
                ),
              ),
          ),
          ...World.disksOf(world, projectId).map((d) =>
            row(`${d.zone}/${d.name}`, d.name, d.zone, String(d.sizeGb), d.type),
          ),
          ...world.computeLab.disks
            .filter((d) => d.projectId === projectId)
            .map((d) =>
              row(`${d.location}/${d.name}`, d.name, d.location, String(d.sizeGb), d.type),
            ),
        ],
      };
    case "snapshots":
      return {
        headers: ["名前", "ソースディスク", "ロケーション", "サイズ (GB)"],
        rows: World.diskSnapshotsOf(world, projectId).map((s) =>
          row(s.name, s.name, s.sourceDisk, s.sourceZone, String(s.diskSizeGb)),
        ),
      };
    case "images":
      return {
        headers: ["名前", "プロジェクト", "ファミリー"],
        rows: [
          ...PublicImage.all().map((i) =>
            row(`${i.project}/${i.name}`, i.name, i.project, i.family),
          ),
          ...world.computeLab.images
            .filter((i) => i.projectId === projectId)
            .map((i) => row(`${i.projectId}/${i.name}`, i.name, i.projectId, i.family)),
        ],
      };
    case "operations":
      return {
        headers: ["名前", "操作", "対象", "状態", "ロケーション"],
        rows: World.operationsOf(world, projectId).map((o) =>
          row(
            o.name,
            o.name,
            o.operationType,
            o.targetName,
            o.status,
            Option.unwrapOr(o.zone, "global"),
          ),
        ),
      };
    case "zones":
      return {
        headers: ["名前", "リージョン"],
        rows: Zone.all().map((zone) => row(zone, zone, Zone.region(zone))),
      };
  }
};

export const ComputeResourceScreen = ({
  screen,
  world,
  project,
}: ScreenProps & Readonly<{ screen: ResourceScreen }>): ReactElement => {
  const title = screenText(screen);
  const listing = listingOf(screen, world, project.projectId);

  return (
    <div>
      <ScreenTitle eyebrow="Compute Engine" title={title} />
      <div className="overflow-x-auto">
        <ResourceTable
          label={title}
          rows={listing.rows}
          keyOf={(item) => item.key}
          empty={`${title}はまだありません。`}
          columns={listing.headers.map((header, index) => ({
            header,
            cell: (item: Row) => item.cells[index],
          }))}
        />
      </div>
    </div>
  );
};
