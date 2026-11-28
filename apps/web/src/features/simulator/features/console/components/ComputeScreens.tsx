import { type ReactElement, useId, useState } from "react";
import { Checkbox } from "@/components/Checkbox";
import { GhostButton } from "@/components/GhostButton";
import { Select } from "@/components/Select";
import { type DotStatus, StatusDot } from "@/components/StatusDot";
import { TextButton } from "@/components/TextButton";

import { MachineType, PublicImage, Region, Zone } from "@/engine/domains/catalog";
import {
  type BootDiskType,
  BootDiskTypes,
  ExternalIp,
  type Instance,
  Instance as InstanceOps,
  ProvisioningModels,
} from "@/engine/domains/compute";
import { GcloudConfig } from "@/engine/domains/gcloud-config";
import { ServiceAccount } from "@/engine/domains/service-account";
import { World } from "@/engine/domains/world";
import {
  CreateFormSection,
  CreatePage,
  Field,
  PrimaryButton,
  RadioGroup,
  SecondaryButton,
  TextInput,
} from "@/features/simulator/features/console/components/ConsoleParts";
import { ConsoleScreens } from "@/features/simulator/features/console/domains/console-screen";
import {
  VmAttachDiskForm,
  VmDiskCommand,
  VmEditForm,
} from "@/features/simulator/features/console/domains/edit-command/compute";
import {
  FieldErrors,
  type VmAction,
  VmAction as VmActionOps,
  VmCreateForm,
} from "@/features/simulator/features/console/domains/equivalent-command";
import { useCreateForm } from "@/features/simulator/features/console/hooks/use-create-form";
import type { ScreenProps } from "@/features/simulator/features/console/types/screen-props";
import { Option } from "@/utils/Option";
import { StringEx } from "@/utils/StringEx";

/** 操作ボタンの綴り（UI 案 2b: 停止中でも一時停止中でも「開始 / 再開」の 1 つ）。 */
const actionText = (action: VmAction): string => {
  switch (action) {
    case "start":
    case "resume":
      return "開始 / 再開";
    case "stop":
      return "停止";
    case "suspend":
      return "一時停止";
    case "delete":
      return "削除";
    case "ssh":
      return "SSH";
  }
};

/** 一覧の上の操作（UI 案 2b）。開始と再開は 1 つのボタンにまとめる。 */
type ToolbarAction = "start-or-resume" | "stop" | "suspend" | "delete";

const ToolbarActions: readonly ToolbarAction[] = ["start-or-resume", "stop", "suspend", "delete"];

/** ツールバーの操作を、その VM に対する実際の操作にする。その VM に出せなければ `none`。 */
const resolveAction = (action: ToolbarAction, instance: Instance): Option<VmAction> => {
  const available = VmActionOps.availableFor(instance);
  const candidates: readonly VmAction[] =
    action === "start-or-resume" ? ["start", "resume"] : [action];
  return Option.fromNullable(candidates.find((c) => available.includes(c)));
};

const toolbarText = (action: ToolbarAction): string =>
  action === "start-or-resume" ? actionText("start") : actionText(action);

/** 状態のアイコン（UI 案 2b: 実行中は緑の丸にチェック、それ以外は灰色の丸に停止の四角）。 */
const dotStatus = (instance: Instance): DotStatus => {
  if (InstanceOps.isRunning(instance)) {
    return "running";
  }
  return instance.status === "SUSPENDED" ? "suspended" : "stopped";
};

const StatusIcon = ({ instance }: Readonly<{ instance: Instance }>): ReactElement => (
  <StatusDot status={dotStatus(instance)} label={instance.status} variant="icon" />
);

/** 検索の対象にする綴り（名前・ゾーン・マシンタイプ・状態・IP）。 */
const searchableText = (instance: Instance): string => {
  const nic = instance.networkInterfaces[0];
  return [
    instance.name,
    instance.zone,
    instance.machineType,
    instance.status,
    nic?.networkIP ?? "",
    nic === undefined ? "" : Option.unwrapOr(ExternalIp.address(nic.externalIP), ""),
  ]
    .join(" ")
    .toLowerCase();
};

const instanceKey = (instance: Instance): string => `${instance.zone}/${instance.name}`;

const EmptyVmEditForm = (): VmEditForm => ({
  name: "",
  zone: "asia-northeast1-a",
  status: "RUNNING",
  initialMachineType: "e2-small",
  machineType: "e2-small",
  initialTags: [],
  tags: "",
  initialMetadata: {},
  metadata: "",
});

const ReadOnlyField = ({ id, value }: Readonly<{ id: string; value: string }>): ReactElement => (
  <output
    id={id}
    className="flex h-9 items-center rounded-md border border-line bg-canvas px-3 font-mono text-muted text-sm"
  >
    {value}
  </output>
);

/** Compute Engine › VM インスタンス（UI 案 2b）。選んだ VM に対する操作は CLI のコマンドとして流す。 */
export const VmListScreen = ({ world, project, handlers, outcome }: ScreenProps): ReactElement => {
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [sortAsc, setSortAsc] = useState(true);
  const [diskTargetKey, setDiskTargetKey] = useState<Option<string>>(Option.none);
  const [attachDiskName, setAttachDiskName] = useState("");
  const [attachError, setAttachError] = useState<string | undefined>(undefined);
  const filterId = useId();
  const editEditor = useCreateForm(VmEditForm, EmptyVmEditForm, false, outcome);
  const instances = World.instancesOf(world, project.projectId);
  const shown = instances
    .filter((i) => searchableText(i).includes(filter.trim().toLowerCase()))
    .sort((a, b) => (sortAsc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)));
  const selected = instances.filter((i) => selectedKeys.has(instanceKey(i)));
  const allChecked = shown.length > 0 && shown.every((i) => selectedKeys.has(instanceKey(i)));
  const toggle = (key: string): void =>
    setSelectedKeys((keys) => {
      const next = new Set(keys);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const run = (action: VmAction, instance: Instance): void =>
    handlers.submit({
      line: VmActionOps.toCommand(action, instance),
      note: `${actionText(action)} (${instance.name})`,
      next: Option.none,
      openTerminal: action === "ssh",
    });
  const perform = (action: ToolbarAction): void => {
    if (
      action === "delete" &&
      !handlers.confirm(`${selected.map((i) => i.name).join(", ")} を削除しますか？`)
    )
      return;
    for (const instance of selected) {
      const resolved = resolveAction(action, instance);
      if (Option.isSome(resolved)) run(resolved.value, instance);
    }
  };
  const isEnabled = (action: ToolbarAction): boolean =>
    selected.length > 0 && selected.every((i) => Option.isSome(resolveAction(action, i)));
  const saveEdit = (): void => {
    const valid = editEditor.submit();
    if (!Option.isSome(valid)) return;
    const [first, ...rest] = VmEditForm.toSteps(valid.value, project.projectId);
    if (first === undefined) {
      editEditor.close();
      return;
    }
    handlers.submit({ ...first, next: Option.none, rest });
    editEditor.awaitClose();
  };
  return (
    <div>
      <div className="-mx-5 -mt-5 mb-0 flex min-h-14 flex-wrap items-center gap-x-6 gap-y-2 border-line border-b px-5 py-3">
        <div>
          <p className="text-muted text-xs">Compute Engine</p>
          <h2 className="font-medium text-2xl leading-tight">VM インスタンス</h2>
        </div>
        <div className="flex items-center gap-1 self-end pb-1 text-[15px]">
          <GhostButton
            tone="accent"
            className="font-bold"
            onClick={() => handlers.changeScreen(ConsoleScreens.VmCreate)}
          >
            <span aria-hidden="true">＋ </span>インスタンスを作成
          </GhostButton>
          <GhostButton
            tone="accent"
            onClick={() =>
              handlers.submit({
                line: `gcloud compute instances list --project=${project.projectId}`,
                note: "VM インスタンス一覧を更新",
                next: Option.none,
              })
            }
          >
            <span aria-hidden="true">↻ </span>更新
          </GhostButton>
          <span aria-hidden="true" className="mx-2 h-5 border-line border-l" />
          {ToolbarActions.map((action) => (
            <GhostButton
              key={action}
              tone="accent"
              disabled={!isEnabled(action)}
              onClick={() => perform(action)}
            >
              {toolbarText(action)}
            </GhostButton>
          ))}
        </div>
      </div>
      <div className="-mx-5 mb-4 border-line border-b px-5">
        <span className="inline-block border-accent border-b-2 px-4 py-3 text-accent text-sm">
          インスタンス
        </span>
      </div>
      {Option.isSome(editEditor.form) &&
        (() => {
          const editForm = editEditor.form.value;
          const editSteps = VmEditForm.toSteps(editForm, project.projectId);
          return (
            <CreateFormSection
              label="VM インスタンスを編集"
              columns={2}
              command={VmEditForm.toCommand(editForm, project.projectId)}
              onCopy={handlers.copy}
              onInsert={() => handlers.insert(editSteps[0]?.line ?? "")}
              onSubmit={saveEdit}
              onCancel={editEditor.close}
              submitLabel="保存"
            >
              <Field label="名前">{(id) => <ReadOnlyField id={id} value={editForm.name} />}</Field>
              <Field label="ゾーン">
                {(id) => <ReadOnlyField id={id} value={editForm.zone} />}
              </Field>
              <Field
                label="マシンタイプ"
                error={editEditor.errors.machineType}
                hint={
                  editForm.status === "TERMINATED"
                    ? undefined
                    : "マシンタイプを変更するにはインスタンスを停止してください"
                }
              >
                {(id) =>
                  editForm.status === "TERMINATED" ? (
                    <Select
                      id={id}
                      value={editForm.machineType}
                      onChange={(machineType) => editEditor.set("machineType", machineType)}
                      options={MachineType.all().map((m) => ({
                        value: m.name,
                        label: machineTypeText(m),
                      }))}
                    />
                  ) : (
                    <ReadOnlyField id={id} value={editForm.machineType} />
                  )
                }
              </Field>
              <Field label="ネットワーク タグ">
                {(id) => (
                  <TagInput
                    id={id}
                    value={editForm.tags}
                    onChange={(tags) => editEditor.set("tags", tags)}
                  />
                )}
              </Field>
              <div className="sm:col-span-2">
                <Field
                  label="メタデータ"
                  error={editEditor.errors.metadata}
                  hint="key=value をカンマ区切りで入力（例: env=prod,enable-oslogin=TRUE）"
                >
                  {(id) => (
                    <TextInput
                      id={id}
                      value={editForm.metadata}
                      placeholder="env=prod,enable-oslogin=TRUE"
                      onChange={(metadata) => editEditor.set("metadata", metadata)}
                    />
                  )}
                </Field>
              </div>
            </CreateFormSection>
          );
        })()}
      {Option.isSome(diskTargetKey) &&
        (() => {
          const diskVm = instances.find((i) => instanceKey(i) === diskTargetKey.value);
          if (diskVm === undefined) return null;
          const attachedDisks = [
            ...diskVm.disks.map((d) => ({
              name: d.deviceName,
              sizeGb: d.sizeGb,
              type: d.type,
              boot: d.boot,
            })),
            ...world.computeLab.disks
              .filter(
                (d) =>
                  d.projectId === project.projectId &&
                  d.users.includes(`${diskVm.zone}/${diskVm.name}`),
              )
              .map((d) => ({
                name: d.name,
                sizeGb: d.sizeGb,
                type: d.type,
                boot: false,
              })),
          ];
          const seenUnattached = new Set<string>();
          const unattachedDisks: { name: string; label: string }[] = [];
          for (const d of World.disksOf(world, project.projectId)) {
            if (d.zone === diskVm.zone && d.users.length === 0 && !seenUnattached.has(d.name)) {
              seenUnattached.add(d.name);
              unattachedDisks.push({
                name: d.name,
                label: `${d.name} (${d.sizeGb} GB・${d.type})`,
              });
            }
          }
          for (const d of world.computeLab.disks) {
            if (
              d.projectId === project.projectId &&
              d.location === diskVm.zone &&
              d.users.length === 0 &&
              !seenUnattached.has(d.name)
            ) {
              seenUnattached.add(d.name);
              unattachedDisks.push({
                name: d.name,
                label: `${d.name} (${d.sizeGb} GB・${d.type})`,
              });
            }
          }
          const selectedDisk = unattachedDisks.some((d) => d.name === attachDiskName)
            ? attachDiskName
            : (unattachedDisks[0]?.name ?? "");
          const attachForm = VmAttachDiskForm.create(diskVm.name, diskVm.zone, selectedDisk);
          const submitAttach = (): void => {
            const errors = VmAttachDiskForm.collectErrors(attachForm);
            if (!FieldErrors.isEmpty(errors)) {
              setAttachError(errors.disk);
              return;
            }
            setAttachError(undefined);
            handlers.submit({
              line: VmAttachDiskForm.toCommand(attachForm, project.projectId),
              note: `ディスクを接続 (${attachForm.disk})`,
              next: Option.none,
            });
            setAttachDiskName("");
          };
          return (
            <div className="mb-5 flex flex-col gap-3">
              <section
                className="rounded border border-line bg-surface p-4"
                aria-label="接続中のディスク"
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="font-medium text-ink text-sm">
                    接続中のディスク（<span className="font-mono">{diskVm.name}</span> ·{" "}
                    <span className="font-mono text-muted">{diskVm.zone}</span>）
                  </h3>
                  <SecondaryButton onClick={() => setDiskTargetKey(Option.none)}>
                    閉じる
                  </SecondaryButton>
                </div>
                <ul className="divide-y divide-line rounded border border-line bg-canvas text-sm">
                  {attachedDisks.map((d) => (
                    <li
                      key={d.name}
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium font-mono">{d.name}</span>
                        <span className="text-muted text-xs">
                          {d.sizeGb} GB · {d.type}
                        </span>
                        <span className="rounded bg-surface px-1.5 py-0.5 text-muted text-xs">
                          {d.boot ? "ブートディスク" : "データディスク"}
                        </span>
                      </div>
                      {!d.boot && (
                        <SecondaryButton
                          ariaLabel={`${d.name} を切断`}
                          onClick={() =>
                            handlers.submit({
                              line: VmDiskCommand.detach(
                                diskVm.name,
                                d.name,
                                diskVm.zone,
                                project.projectId,
                              ),
                              note: `ディスクを切断 (${d.name})`,
                              next: Option.none,
                            })
                          }
                        >
                          切断
                        </SecondaryButton>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
              <CreateFormSection
                label="ディスクを接続"
                columns={2}
                command={VmAttachDiskForm.toCommand(attachForm, project.projectId)}
                onCopy={handlers.copy}
                onInsert={handlers.insert}
                onSubmit={submitAttach}
                onCancel={() => setDiskTargetKey(Option.none)}
                submitLabel="接続"
              >
                <Field label="インスタンス">
                  {(id) => <ReadOnlyField id={id} value={`${diskVm.name} (${diskVm.zone})`} />}
                </Field>
                <Field
                  label="未接続のディスク"
                  required
                  error={attachError}
                  hint={
                    unattachedDisks.length === 0
                      ? "同じゾーンに未接続のディスクがありません。「ディスク」画面から作成できます。"
                      : undefined
                  }
                >
                  {(id) => (
                    <Select
                      id={id}
                      value={selectedDisk}
                      onChange={(value) => {
                        setAttachDiskName(value);
                        setAttachError(undefined);
                      }}
                      options={
                        unattachedDisks.length > 0
                          ? unattachedDisks.map((d) => ({ value: d.name, label: d.label }))
                          : [{ value: "", label: "（未接続のディスクがありません）" }]
                      }
                    />
                  )}
                </Field>
              </CreateFormSection>
            </div>
          );
        })()}
      <label
        htmlFor={filterId}
        className="mb-4 flex h-11 items-center gap-3 rounded-lg border border-line bg-surface px-4"
      >
        <span className="font-bold text-[15px]">フィルタ</span>
        <TextInput
          id={filterId}
          variant="bare"
          font="sans"
          className="min-w-0 flex-1"
          placeholder="名前・ゾーン・マシンタイプ・IP で絞り込み"
          value={filter}
          onChange={setFilter}
        />
        <span className="hidden text-muted text-xs sm:inline">部分一致</span>
      </label>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[760px] text-sm" aria-label="VM インスタンス">
          <thead className="bg-canvas text-left">
            <tr>
              <th className="w-12 py-3 pl-4">
                <Checkbox
                  ariaLabel="すべて選択"
                  checked={allChecked}
                  onChange={() =>
                    setSelectedKeys(allChecked ? new Set() : new Set(shown.map(instanceKey)))
                  }
                />
              </th>
              <th className="w-14 py-3 pr-3 font-bold">状態</th>
              <th className="py-3 pr-3 font-bold" aria-sort={sortAsc ? "ascending" : "descending"}>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 font-bold hover:text-accent"
                  onClick={() => setSortAsc((asc) => !asc)}
                >
                  名前 <span aria-hidden="true">{sortAsc ? "↑" : "↓"}</span>
                </button>
              </th>
              <th className="py-3 pr-3 font-bold">ゾーン</th>
              <th className="py-3 pr-3 font-bold">マシンタイプ</th>
              <th className="py-3 pr-3 font-bold">内部 IP</th>
              <th className="py-3 pr-3 font-bold">外部 IP</th>
              <th className="py-3 pr-4 font-bold">接続 / 操作</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr className="border-line border-t">
                <td colSpan={8} className="py-6 text-center text-muted">
                  {instances.length === 0
                    ? "VM はまだありません。「インスタンスを作成」から作れます。"
                    : "フィルタに合う VM はありません。"}
                </td>
              </tr>
            )}
            {shown.map((i) => {
              const key = instanceKey(i);
              const nic = i.networkInterfaces[0];
              const address = nic === undefined ? Option.none : ExternalIp.address(nic.externalIP);
              const isChecked = selectedKeys.has(key);
              const canSsh = VmActionOps.availableFor(i).includes("ssh");
              return (
                <tr
                  key={key}
                  className={`border-line border-t ${isChecked ? "bg-accent-soft/60" : ""}`}
                >
                  <td className="py-3.5 pl-4">
                    <Checkbox
                      ariaLabel={`${i.name} を選択`}
                      checked={isChecked}
                      onChange={() => toggle(key)}
                    />
                  </td>
                  <td className="py-3.5 pr-3">
                    <StatusIcon instance={i} />
                  </td>
                  <td className="py-3.5 pr-3 font-bold">{i.name}</td>
                  <td className="py-3.5 pr-3">{i.zone}</td>
                  <td className="py-3.5 pr-3 font-mono">{i.machineType}</td>
                  <td className="py-3.5 pr-3 font-mono">{nic?.networkIP ?? "-"}</td>
                  <td className="py-3.5 pr-3">
                    {Option.isSome(address) ? (
                      <span className="font-mono">{address.value}</span>
                    ) : (
                      <span className="text-muted">なし</span>
                    )}
                  </td>
                  <td className="py-3.5 pr-4">
                    <div className="inline-flex items-center gap-2">
                      <TextButton
                        ariaLabel={`${i.name} に SSH`}
                        disabled={!canSsh}
                        className="font-bold disabled:font-normal"
                        onClick={() => run("ssh", i)}
                      >
                        SSH
                      </TextButton>
                      <SecondaryButton
                        ariaLabel={`${i.name} を編集`}
                        onClick={() => {
                          setDiskTargetKey(Option.none);
                          editEditor.openWith(VmEditForm.from(i));
                        }}
                      >
                        編集
                      </SecondaryButton>
                      <SecondaryButton
                        ariaLabel={`${i.name} のディスクを管理`}
                        onClick={() => {
                          editEditor.close();
                          setDiskTargetKey(Option.some(key));
                          setAttachDiskName("");
                          setAttachError(undefined);
                        }}
                      >
                        ディスク
                      </SecondaryButton>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-right text-muted text-sm">
        {shown.length === 0 ? 0 : 1}〜{shown.length} / {shown.length}
        {filter.trim() !== "" ? `（全 ${instances.length} 件）` : ""}
      </p>
    </div>
  );
};

const zoneOf = (world: World): Zone =>
  Option.unwrapOr(
    Option.flatMap(GcloudConfig.get(world.config, "compute/zone"), Zone.parse),
    "asia-northeast1-a",
  );

/** リージョンの綴り（UI 案 s1: `asia-northeast1（東京）`）。 */
const regionText = (region: Region): string => {
  switch (region) {
    case "asia-northeast1":
      return "asia-northeast1（東京）";
    case "asia-northeast2":
      return "asia-northeast2（大阪）";
    case "us-central1":
      return "us-central1（アイオワ）";
    case "us-east1":
      return "us-east1（サウスカロライナ）";
    case "europe-west1":
      return "europe-west1（ベルギー）";
  }
};

/** マシンタイプのシリーズ（`e2-small` の `E2`）。 */
export const seriesOf = (machineType: string): string =>
  (machineType.split("-")[0] ?? machineType).toUpperCase();

export const machineTypeText = (m: MachineType): string =>
  `${m.name}（${m.guestCpus} vCPU、${m.memoryMb / 1024} GB メモリ）`;

export const diskTypeText = (type: BootDiskType): string => {
  switch (type) {
    case "pd-standard":
      return "標準";
    case "pd-balanced":
      return "バランス";
    case "pd-ssd":
      return "SSD";
  }
};

/**
 * ネットワーク タグの入力（UI 案 s1: 確定したタグは札、打ちかけの 1 語は入力欄）。
 * 値はカンマ区切りの 1 つの文字列のまま持ち、カンマか空白・Enter で札になる。
 */
export const TagInput = ({
  id,
  value,
  onChange,
}: Readonly<{ id: string; value: string; onChange: (value: string) => void }>): ReactElement => {
  const separator = Math.max(value.lastIndexOf(","), value.lastIndexOf(" "));
  const committed = StringEx.splitList(value.slice(0, separator + 1));
  const draft = value.slice(separator + 1);
  const withTags = (tags: readonly string[], rest: string): string =>
    tags.length === 0 ? rest : `${tags.join(",")},${rest}`;
  return (
    <div className="flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 focus-within:border-accent">
      {committed.map((tag, index) => (
        <span
          key={`${tag}-${index.toString()}`}
          className="flex items-center gap-1.5 rounded bg-code px-2 py-0.5 font-mono text-sm"
        >
          {tag}
          <TextButton
            tone="muted"
            ariaLabel={`${tag} を外す`}
            className="text-xs"
            onClick={() =>
              onChange(
                withTags(
                  committed.filter((_, i) => i !== index),
                  draft,
                ),
              )
            }
          >
            ×
          </TextButton>
        </span>
      ))}
      <TextInput
        id={id}
        variant="bare"
        className="min-w-24 flex-1 px-1"
        value={draft}
        onChange={(v) => onChange(withTags(committed, v))}
        onKeyDown={(e) => {
          if (e.key === "Enter" && draft !== "") {
            e.preventDefault();
            onChange(`${withTags(committed, draft)},`);
          }
          if (e.key === "Backspace" && draft === "" && committed.length > 0) {
            onChange(withTags(committed.slice(0, -1), ""));
          }
        }}
      />
    </div>
  );
};

/** このシミュレータに収録されたマシンタイプの範囲。 */
export const seriesRange = (series: string, readValue: (type: MachineType) => number): string => {
  const values = MachineType.all()
    .filter((type) => seriesOf(type.name) === series)
    .map(readValue);
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? String(min) : `${min}〜${max}`;
};

export const NameRuleText = "小文字英字で始め、小文字・数字・ハイフンのみ使用できます";

/** Compute Engine › インスタンスを作成（UI 案 2c）。入力のたびに同等のコマンドを出す。 */
export const VmCreateScreen = ({
  world,
  project,
  handlers,
  navigationOpen = true,
}: ScreenProps): ReactElement => {
  const projectId = project.projectId;
  const defaultAccount = ServiceAccount.defaultComputeEmail(project.projectNumber);
  const [activeSection, setActiveSection] = useState("machine");
  const editor = useCreateForm(
    VmCreateForm,
    () => VmCreateForm.create({ zone: zoneOf(world), serviceAccount: defaultAccount }),
    true,
  );
  if (!Option.isSome(editor.form)) return <span className="hidden" />;
  const form = editor.form.value;
  const { set } = editor;
  // 名前は打った時点で検証して項目の下に出す（UI 案 s1）。そのほかは送信を試みた後に出す。
  // 判定はドメイン（CLI と同じ規則）で、綴りだけ Console 向けの言い方にする。
  const live = VmCreateForm.collectErrors(form);
  const errors = {
    ...editor.errors,
    ...(form.name !== "" && live.name !== undefined ? { name: NameRuleText } : {}),
    ...(live.bootDiskSize !== undefined ? { bootDiskSize: live.bootDiskSize } : {}),
  };
  const canCreate = FieldErrors.isEmpty(live);
  // サブネットはネットワークとゾーンのリージョンで決まる。ゾーンを変えて合わなくなったら、そのリージョンの最初のものにする。
  const subnetChoices = World.subnetsOf(world, projectId)
    .filter((s) => s.network === form.network && s.region === Zone.region(form.zone))
    .map((s) => s.name);
  const withSubnet = (f: VmCreateForm): VmCreateForm => ({
    ...f,
    subnet: subnetChoices.includes(f.subnet) ? f.subnet : (subnetChoices[0] ?? ""),
  });
  const parts = VmCreateForm.toParts(withSubnet(form), projectId);
  const accounts = [
    defaultAccount,
    ...World.serviceAccountsOf(world, projectId).map((s) => s.email),
  ];
  const images = PublicImage.all();
  const region = Zone.region(form.zone);
  const series = seriesOf(form.machineType);
  const allSeries = [...new Set(MachineType.all().map((m) => seriesOf(m.name)))];
  const provisioningField = (
    <RadioGroup
      label="プロビジョニング モデル"
      name="provisioning-model"
      inline
      value={form.provisioningModel}
      onChange={(model) => set("provisioningModel", model)}
      options={[
        { value: ProvisioningModels.Standard, label: "標準" },
        { value: ProvisioningModels.Spot, label: "Spot" },
      ]}
    />
  );
  const create = (): void => {
    const valid = editor.submit();
    if (!Option.isSome(valid)) return;
    handlers.submit({
      line: VmCreateForm.toCommand(withSubnet(valid.value), projectId),
      note: `インスタンスを作成 (${valid.value.name})`,
      next: Option.some(ConsoleScreens.VmList),
    });
  };
  return (
    <CreatePage
      header={
        <>
          <GhostButton
            ariaLabel="VM インスタンスに戻る"
            onClick={() => handlers.changeScreen(ConsoleScreens.VmList)}
          >
            ←
          </GhostButton>
          <h2 className="font-medium text-2xl">インスタンスを作成</h2>
        </>
      }
      navigationOpen={navigationOpen}
      navigation={[
        { id: "machine", title: "マシンの構成", detail: form.machineType },
        {
          id: "storage",
          title: "OS とストレージ",
          detail: `${form.imageFamily} · ${form.bootDiskSize}`,
        },
        {
          id: "network",
          title: "ネットワーキング",
          detail: form.tags === "" ? form.network : `${form.network} · ${form.tags}`,
        },
        { id: "security", title: "セキュリティ", detail: "サービスアカウント、スコープ" },
        { id: "advanced", title: "詳細設定", detail: form.provisioningModel },
      ].map((item) => (
        <button
          type="button"
          key={item.id}
          aria-label={item.title}
          aria-pressed={activeSection === item.id}
          className={`min-w-40 shrink-0 border-l-2 px-5 py-4 text-left lg:w-full ${activeSection === item.id ? "border-accent bg-accent-soft text-accent" : "border-transparent hover:bg-canvas"}`}
          onClick={() => setActiveSection(item.id)}
        >
          <span className="block font-medium text-sm">{item.title}</span>
          <span className="mt-1 block break-all text-muted text-xs">{item.detail}</span>
        </button>
      ))}
      summary={
        <>
          <h3 className="mb-4 font-medium text-xl">構成の概要</h3>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted">マシンタイプ</dt>
            <dd className="font-mono">{form.machineType}</dd>
            <dt className="text-muted">ブートディスク</dt>
            <dd>
              {form.imageFamily} · {form.bootDiskSize.replace(/GB$/, " GB")}
            </dd>
            <dt className="text-muted">ゾーン</dt>
            <dd className="font-mono">{form.zone}</dd>
          </dl>
        </>
      }
      parts={parts}
      onCopy={handlers.copy}
      onInsert={handlers.insert}
      actions={
        <>
          <PrimaryButton onClick={create} disabled={!canCreate}>
            作成
          </PrimaryButton>
          <SecondaryButton onClick={() => handlers.changeScreen(ConsoleScreens.VmList)}>
            キャンセル
          </SecondaryButton>
          {!canCreate && form.name === "" && (
            <span className="text-muted text-xs">名前を入力すると作成できます</span>
          )}
        </>
      }
      note={
        <>
          <span className="mr-2 font-bold">試験メモ</span>
          「すべての Cloud API に完全アクセス権」は{" "}
          <span className="font-mono">--scopes=cloud-platform</span>。権限は SA の IAM
          ロールで絞るのが推奨。
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <Field label="名前" required outlined error={errors.name}>
            {(id) => (
              <TextInput
                id={id}
                variant="outlined"
                invalid={errors.name !== undefined}
                value={form.name}
                onChange={(v) => set("name", v)}
              />
            )}
          </Field>
          <Field label="リージョン" required outlined>
            {(id) => (
              <Select
                id={id}
                variant="outlined"
                font="sans"
                value={region}
                onChange={(r) => set("zone", Zone.defaultForRegion(r))}
                options={Region.all().map((r) => ({ value: r, label: regionText(r) }))}
              />
            )}
          </Field>
          <Field label="ゾーン" required outlined>
            {(id) => (
              <Select
                id={id}
                variant="outlined"
                font="sans"
                value={form.zone}
                onChange={(zone) => set("zone", zone)}
                options={Zone.all()
                  .filter((z) => Zone.region(z) === region)
                  .map((z) => ({ value: z, label: z }))}
              />
            )}
          </Field>
        </div>
        {activeSection === "machine" && (
          <section>
            <h3 className="mb-4 font-medium text-xl">マシンの構成</h3>
            <fieldset>
              <legend className="mb-2 text-muted text-sm">シリーズ</legend>
              <div className="mb-5 overflow-hidden rounded border border-line">
                <table className="w-full text-sm">
                  <thead className="bg-canvas text-left text-muted">
                    <tr>
                      <th className="px-3 py-2 font-medium">シリーズ</th>
                      <th className="px-3 py-2 font-medium">vCPU</th>
                      <th className="px-3 py-2 font-medium">メモリ (GB)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allSeries.map((item) => (
                      <tr
                        key={item}
                        className={`border-line border-t ${item === series ? "bg-accent-soft" : ""}`}
                      >
                        <td className="px-3 py-2">
                          <label className="flex items-center gap-3">
                            <input
                              type="radio"
                              name="machine-series"
                              value={item}
                              checked={item === series}
                              className="h-4 w-4 accent-accent"
                              onChange={() => {
                                const first = MachineType.all().find(
                                  (m) => seriesOf(m.name) === item,
                                );
                                if (first !== undefined) set("machineType", first.name);
                              }}
                            />
                            {item}
                          </label>
                        </td>
                        <td className="px-3 py-2 text-muted">
                          {seriesRange(item, (type) => type.guestCpus)}
                        </td>
                        <td className="px-3 py-2 text-muted">
                          {seriesRange(item, (type) => type.memoryMb / 1024)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </fieldset>
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              <Field label="マシンタイプ" outlined>
                {(id) => (
                  <Select
                    id={id}
                    variant="outlined"
                    value={form.machineType}
                    onChange={(machineType) => set("machineType", machineType)}
                    options={MachineType.all()
                      .filter((m) => seriesOf(m.name) === series)
                      .map((m) => ({ value: m.name, label: machineTypeText(m) }))}
                  />
                )}
              </Field>
            </div>
          </section>
        )}
        {activeSection === "advanced" && (
          <section>
            <h3 className="mb-4 font-medium text-xl">詳細設定</h3>
            {provisioningField}
          </section>
        )}
        {activeSection === "storage" && (
          <section>
            <h3 className="mb-4 font-medium text-xl">OS とストレージ</h3>
            <p className="mb-4 text-muted text-sm">
              {form.imageFamily} · {form.bootDiskSize.replace(/GB$/, " GB")} ·{" "}
              {diskTypeText(form.bootDiskType)}
            </p>
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-[2fr_1fr_1fr] rounded-lg border border-line bg-surface p-4">
              <Field label="イメージ">
                {(id) => (
                  <Select
                    id={id}
                    value={`${form.imageProject}/${form.imageFamily}`}
                    onChange={(value) => {
                      const image = images.find((i) => `${i.project}/${i.family}` === value);
                      if (image !== undefined) {
                        set("imageFamily", image.family);
                        set("imageProject", image.project);
                      }
                    }}
                    options={images.map((i) => ({
                      value: `${i.project}/${i.family}`,
                      label: `${i.family}（${i.project}）`,
                    }))}
                  />
                )}
              </Field>
              <Field label="サイズ" error={errors.bootDiskSize}>
                {(id) => (
                  <TextInput
                    id={id}
                    invalid={errors.bootDiskSize !== undefined}
                    value={form.bootDiskSize}
                    onChange={(v) => set("bootDiskSize", v)}
                  />
                )}
              </Field>
              <Field label="種類">
                {(id) => (
                  <Select
                    id={id}
                    value={form.bootDiskType}
                    onChange={(type) => set("bootDiskType", type)}
                    options={Object.values(BootDiskTypes).map((t) => ({
                      value: t,
                      label: `${diskTypeText(t)}永続ディスク (${t})`,
                    }))}
                  />
                )}
              </Field>
            </div>
          </section>
        )}
        {activeSection === "security" && (
          <section>
            <h3 className="mb-4 font-medium text-xl">セキュリティ</h3>
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              <Field label="サービスアカウント" outlined>
                {(id) => (
                  <Select
                    id={id}
                    variant="outlined"
                    value={form.serviceAccount}
                    onChange={(account) => set("serviceAccount", account)}
                    options={accounts.map((a) => ({ value: a, label: a }))}
                  />
                )}
              </Field>
              <RadioGroup
                label="アクセス スコープ"
                name="scopes"
                value={form.scopes}
                onChange={(scopes) => set("scopes", scopes)}
                options={[
                  { value: "default", label: "デフォルトのアクセス権を許可" },
                  { value: "cloud-platform", label: "すべての Cloud API に完全アクセス権を許可" },
                ]}
              />
            </div>
          </section>
        )}
        {activeSection === "network" && (
          <section>
            <h3 className="mb-4 font-medium text-xl">ネットワーキング</h3>
            <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="ネットワーク">
                {(id) => (
                  <Select
                    id={id}
                    variant="outlined"
                    value={form.network}
                    onChange={(network) => set("network", network)}
                    options={World.networksOf(world, projectId).map((n) => ({
                      value: n.name,
                      label: n.name,
                    }))}
                  />
                )}
              </Field>
              <Field
                label="サブネットワーク"
                hint={
                  subnetChoices.length === 0 ? "このリージョンにサブネットがありません" : undefined
                }
              >
                {(id) => (
                  <Select
                    id={id}
                    variant="outlined"
                    value={withSubnet(form).subnet}
                    onChange={(subnet) => set("subnet", subnet)}
                    options={subnetChoices.map((name) => ({ value: name, label: name }))}
                  />
                )}
              </Field>
            </div>
            <Field label="ネットワーク タグ">
              {(id) => (
                <TagInput id={id} value={form.tags} onChange={(tags) => set("tags", tags)} />
              )}
            </Field>
            <div className="mt-4">
              <RadioGroup
                label="外部 IP"
                name="external-ip"
                inline
                value={form.externalIp ? "ephemeral" : "none"}
                onChange={(v) => set("externalIp", v === "ephemeral")}
                options={[
                  { value: "ephemeral", label: "エフェメラル" },
                  { value: "none", label: "なし" },
                ]}
              />
            </div>
          </section>
        )}
      </div>
    </CreatePage>
  );
};
