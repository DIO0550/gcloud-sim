import { type ReactElement, useId, useState } from "react";
import { SegmentedControl } from "@/components/SegmentedControl";
import { ApiService } from "@/engine/domains/catalog";
import { Project } from "@/engine/domains/resource-hierarchy";
import {
  ConsoleStatus,
  PrimaryButton,
  ResourceTable,
  ScreenTitle,
  SecondaryButton,
  TextInput,
} from "@/features/simulator/features/console/components/ConsoleParts";
import { ApiServiceCommand } from "@/features/simulator/features/console/domains/edit-command/apis";
import type { ScreenProps } from "@/features/simulator/features/console/types/screen-props";
import { Option } from "@/utils/Option";

type StatusFilter = "all" | "enabled" | "disabled";

/** API とサービス › 有効な API とサービス: カタログ内の全 API の状態表示・有効化・無効化。 */
export const ApisServicesScreen = ({ project, handlers }: ScreenProps): ReactElement => {
  const projectId = project.projectId;
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const filterId = useId();

  const allServices = ApiService.all()
    .map((service) => ({
      ...service,
      enabled: Project.hasApi(project, service.name),
    }))
    .toSorted((a, b) => a.name.localeCompare(b.name));

  const enabledCount = allServices.filter((s) => s.enabled).length;
  const needle = filter.trim().toLowerCase();
  const rows = allServices.filter((s) => {
    if (statusFilter === "enabled" && !s.enabled) return false;
    if (statusFilter === "disabled" && s.enabled) return false;
    if (needle === "") return true;
    return `${s.name} ${s.title}`.toLowerCase().includes(needle);
  });

  const enable = (service: ApiService): void => {
    handlers.submit({
      line: ApiServiceCommand.enable(service.name, projectId),
      note: `API を有効化 (${service.name})`,
      next: Option.none,
    });
  };

  const disable = (service: ApiService): void => {
    if (!handlers.confirm(`API「${service.title}」(${service.name}) を無効にしますか？`)) return;
    handlers.submit({
      line: ApiServiceCommand.disable(service.name, projectId),
      note: `API を無効化 (${service.name})`,
      next: Option.none,
    });
  };

  return (
    <div>
      <ScreenTitle eyebrow="API とサービス" title="有効な API とサービス" />
      <p className="mb-4 text-muted text-sm">
        プロジェクト「{projectId}」で利用可能な API の一覧です（有効: {enabledCount} / 全{" "}
        {allServices.length}）。
      </p>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          label="API の状態フィルタ"
          value={statusFilter}
          options={[
            { value: "all", label: "すべて" },
            { value: "enabled", label: "有効のみ" },
            { value: "disabled", label: "無効のみ" },
          ]}
          onChange={setStatusFilter}
          variant="tabs"
        />
        <label
          htmlFor={filterId}
          className="flex h-10 min-w-64 flex-1 items-center gap-3 rounded-lg border border-line px-3.5 sm:max-w-md"
        >
          <span className="shrink-0 text-muted text-xs">フィルタ</span>
          <TextInput
            id={filterId}
            variant="bare"
            font="sans"
            className="min-w-0 flex-1"
            placeholder="API 名やタイトルを検索"
            value={filter}
            onChange={setFilter}
          />
        </label>
      </div>
      <ResourceTable
        label="API とサービス"
        rows={rows}
        keyOf={(s) => s.name}
        empty="条件に一致する API はありません。"
        columns={[
          { header: "API 名", cell: (s) => <span className="font-mono text-xs">{s.name}</span> },
          { header: "タイトル", cell: (s) => s.title },
          {
            header: "状態",
            cell: (s) => <ConsoleStatus status={s.enabled ? "ENABLED" : "DISABLED"} />,
          },
        ]}
        rowActions={(s) =>
          s.enabled ? (
            <SecondaryButton ariaLabel={`${s.name} を無効にする`} onClick={() => disable(s)}>
              無効にする
            </SecondaryButton>
          ) : (
            <PrimaryButton ariaLabel={`${s.name} を有効にする`} onClick={() => enable(s)}>
              有効にする
            </PrimaryButton>
          )
        }
      />
    </div>
  );
};
