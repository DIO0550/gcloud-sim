import type { ReactElement } from "react";
import { Checkbox } from "@/components/Checkbox";
import { Select } from "@/components/Select";
import { PublicImage, Region, Regions, Zone } from "@/engine/domains/catalog";
import { GcloudConfig } from "@/engine/domains/gcloud-config";
import { MigLocation } from "@/engine/domains/resource-location";
import { World } from "@/engine/domains/world";
import { screenText } from "@/features/simulator/features/console/components/ConsoleNav";
import {
  ConsoleStatus,
  CreateFormSection,
  Field,
  PrimaryButton,
  RadioGroup,
  ResourceTable,
  ScreenTitle,
  SecondaryButton,
  TextInput,
} from "@/features/simulator/features/console/components/ConsoleParts";
import { ConsoleScreens } from "@/features/simulator/features/console/domains/console-screen";
import {
  DiskEditForm,
  InstanceGroupEditForm,
} from "@/features/simulator/features/console/domains/edit-command/compute";
import {
  DeleteCommand,
  DiskCreateForm,
  type DiskCreateType,
  ImageCreateForm,
  type ImageSourceKind,
  InstanceGroupCreateForm,
  SnapshotCreateForm,
} from "@/features/simulator/features/console/domains/equivalent-command";
import { useCreateForm } from "@/features/simulator/features/console/hooks/use-create-form";
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

const defaultZoneOf = (world: World): Zone =>
  Option.unwrapOr(
    Option.flatMap(GcloudConfig.get(world.config, "compute/zone"), Zone.parse),
    "asia-northeast1-a",
  );

const defaultRegionOf = (world: World): Region =>
  Option.unwrapOr(
    Option.flatMap(GcloudConfig.get(world.config, "compute/region"), Region.parse),
    Zone.region(defaultZoneOf(world)),
  );

type DiskChoice = Readonly<{ ref: string; label: string }>;

const diskChoicesOf = (world: World, projectId: string): readonly DiskChoice[] => {
  const seen = new Set<string>();
  const list: DiskChoice[] = [];
  const push = (zone: string, name: string, note: string): void => {
    const ref = `${zone}/${name}`;
    if (seen.has(ref)) return;
    seen.add(ref);
    list.push({ ref, label: `${name} (${zone}・${note})` });
  };
  for (const d of World.disksOf(world, projectId)) {
    push(d.zone, d.name, `${d.sizeGb} GB`);
  }
  for (const d of world.computeLab.disks) {
    if (d.projectId === projectId) push(d.location, d.name, `${d.sizeGb} GB`);
  }
  for (const i of World.instancesOf(world, projectId)) {
    for (const d of i.disks) {
      if (d.boot) push(i.zone, d.deviceName, `VM ${i.name} のブートディスク`);
    }
  }
  return list;
};

const InstanceTemplatesScreen = ({ world, project, handlers }: ScreenProps): ReactElement => {
  const projectId = project.projectId;

  return (
    <div>
      <ScreenTitle
        eyebrow="Compute Engine"
        title="インスタンス テンプレート"
        trailing={
          <PrimaryButton
            onClick={() => handlers.changeScreen(ConsoleScreens.InstanceTemplateCreate)}
          >
            ＋ インスタンス テンプレートを作成
          </PrimaryButton>
        }
      />
      <p className="mb-4 text-muted text-xs">
        インスタンス テンプレートは不変のグローバル
        リソースです。作成後に変更はできないため、更新時は新しいテンプレートを作成します。
      </p>
      <ResourceTable
        label="インスタンス テンプレート"
        rows={World.namedOf(world, "instanceTemplates", projectId)}
        keyOf={(t) => t.name}
        empty="インスタンス テンプレートはまだありません。上の「インスタンス テンプレートを作成」または gcloud compute instance-templates create で作成できます。"
        rowActions={(t) => (
          <SecondaryButton
            ariaLabel={`${t.name} で MIG を作成`}
            onClick={() => handlers.changeScreen(ConsoleScreens.InstanceGroups)}
          >
            MIG を作成
          </SecondaryButton>
        )}
        columns={[
          {
            header: "名前",
            cell: (t) => <span className="font-medium font-mono text-accent">{t.name}</span>,
          },
          { header: "ロケーション", cell: () => "グローバル" },
          {
            header: "マシンタイプ",
            cell: (t) => <span className="font-mono">{t.machineType}</span>,
          },
          { header: "イメージ", cell: (t) => t.image.name },
          {
            header: "ネットワーク",
            cell: (t) => (Option.isSome(t.subnet) ? `${t.network} / ${t.subnet.value}` : t.network),
          },
          {
            header: "タグ",
            cell: (t) => (t.tags.length > 0 ? t.tags.join(", ") : "-"),
          },
          {
            header: "プロビジョニング",
            cell: (t) => (t.provisioningModel === "SPOT" ? "Spot" : "標準"),
          },
        ]}
      />
    </div>
  );
};

const ReadOnlyField = ({ id, value }: Readonly<{ id: string; value: string }>): ReactElement => (
  <output
    id={id}
    className="flex h-9 items-center rounded-md border border-line bg-canvas px-3 font-mono text-muted text-sm"
  >
    {value}
  </output>
);

const EmptyMigEditForm = (): InstanceGroupEditForm => ({
  name: "",
  location: "asia-northeast1-a",
  locationScope: "zone",
  initialTemplate: "",
  template: "",
  initialSize: 1,
  size: "1",
  initialAutoscalingEnabled: false,
  autoscalingEnabled: false,
  initialMinReplicas: 1,
  minReplicas: "1",
  initialMaxReplicas: 5,
  maxReplicas: "5",
  initialTargetCpu: 0.6,
  targetCpu: "0.6",
  initialCoolDownSec: 60,
  coolDownSec: "60",
});

const InstanceGroupsScreen = ({ world, project, handlers, outcome }: ScreenProps): ReactElement => {
  const projectId = project.projectId;
  const templates = World.namedOf(world, "instanceTemplates", projectId);
  const seed = (): InstanceGroupCreateForm =>
    InstanceGroupCreateForm.create({
      zone: defaultZoneOf(world),
      region: defaultRegionOf(world),
      template: templates[0]?.name ?? "",
    });
  const editor = useCreateForm(InstanceGroupCreateForm, seed, false, outcome);
  const editEditor = useCreateForm(InstanceGroupEditForm, EmptyMigEditForm, false, outcome);
  const form = Option.unwrapOr(editor.form, seed());

  const create = (): void => {
    const valid = editor.submit();
    if (!Option.isSome(valid)) return;
    handlers.submit({
      line: InstanceGroupCreateForm.toCommand(valid.value, projectId),
      note: `マネージド インスタンス グループを作成 (${valid.value.name})`,
      next: Option.none,
    });
    editor.awaitClose();
  };

  const saveEdit = (): void => {
    const valid = editEditor.submit();
    if (!Option.isSome(valid)) return;
    const [first, ...rest] = InstanceGroupEditForm.toSteps(valid.value, projectId);
    if (first === undefined) {
      editEditor.close();
      return;
    }
    handlers.submit({ ...first, next: Option.none, rest });
    editEditor.awaitClose();
  };

  return (
    <div>
      <ScreenTitle
        eyebrow="Compute Engine"
        title="インスタンス グループ"
        trailing={
          <PrimaryButton
            onClick={() => {
              editEditor.close();
              editor.open();
            }}
          >
            ＋ インスタンス グループを作成
          </PrimaryButton>
        }
      />
      {Option.isSome(editor.form) && (
        <CreateFormSection
          label="インスタンス グループを作成"
          columns={2}
          command={InstanceGroupCreateForm.toCommand(form, projectId)}
          onCopy={handlers.copy}
          onInsert={handlers.insert}
          onSubmit={create}
          onCancel={editor.close}
          submitLabel="作成"
        >
          <Field label="名前" required error={editor.errors.name}>
            {(id) => (
              <TextInput
                id={id}
                value={form.name}
                placeholder="web-mig"
                onChange={(v) => editor.set("name", v)}
              />
            )}
          </Field>
          <Field label="インスタンス テンプレート" required error={editor.errors.template}>
            {(id) => (
              <Select
                id={id}
                value={form.template}
                onChange={(v) => editor.set("template", v)}
                options={
                  templates.length > 0
                    ? templates.map((t) => ({ value: t.name, label: t.name }))
                    : [{ value: "", label: "（テンプレートがありません）" }]
                }
              />
            )}
          </Field>
          <Field label="ロケーション タイプ">
            {(id) => (
              <Select<"zone" | "region">
                id={id}
                value={form.locationType}
                onChange={(v) => editor.set("locationType", v)}
                options={[
                  { value: "zone", label: "単一ゾーン" },
                  { value: "region", label: "複数ゾーン（リージョン）" },
                ]}
              />
            )}
          </Field>
          {form.locationType === "region" ? (
            <Field label="リージョン">
              {(id) => (
                <Select
                  id={id}
                  value={form.region}
                  onChange={(r) => editor.set("region", r)}
                  options={Object.values(Regions).map((r) => ({ value: r, label: r }))}
                />
              )}
            </Field>
          ) : (
            <Field label="ゾーン">
              {(id) => (
                <Select
                  id={id}
                  value={form.zone}
                  onChange={(z) => editor.set("zone", z)}
                  options={Zone.all().map((z) => ({ value: z, label: z }))}
                />
              )}
            </Field>
          )}
          <Field label="インスタンス数" required error={editor.errors.size}>
            {(id) => (
              <TextInput id={id} value={form.size} onChange={(v) => editor.set("size", v)} />
            )}
          </Field>
          <Field
            label="ベース インスタンス名"
            error={editor.errors.baseInstanceName}
            hint="省略時はグループ名を使用"
          >
            {(id) => (
              <TextInput
                id={id}
                value={form.baseInstanceName}
                onChange={(v) => editor.set("baseInstanceName", v)}
              />
            )}
          </Field>
        </CreateFormSection>
      )}
      {Option.isSome(editEditor.form) &&
        (() => {
          const editForm = editEditor.form.value;
          const editSteps = InstanceGroupEditForm.toSteps(editForm, projectId);
          const templateOptions =
            templates.length > 0
              ? templates.map((t) => ({ value: t.name, label: t.name }))
              : [{ value: editForm.template, label: editForm.template }];
          return (
            <CreateFormSection
              label="インスタンス グループを編集"
              columns={2}
              command={InstanceGroupEditForm.toCommand(editForm, projectId)}
              onCopy={handlers.copy}
              onInsert={() => handlers.insert(editSteps[0]?.line ?? "")}
              onSubmit={saveEdit}
              onCancel={editEditor.close}
              submitLabel="保存"
            >
              <Field label="名前">{(id) => <ReadOnlyField id={id} value={editForm.name} />}</Field>
              <Field label="ロケーション">
                {(id) => <ReadOnlyField id={id} value={editForm.location} />}
              </Field>
              <Field label="インスタンス テンプレート" required error={editEditor.errors.template}>
                {(id) => (
                  <Select
                    id={id}
                    value={editForm.template}
                    onChange={(v) => editEditor.set("template", v)}
                    options={templateOptions}
                  />
                )}
              </Field>
              <Field label="インスタンス数" required error={editEditor.errors.size}>
                {(id) => (
                  <TextInput
                    id={id}
                    value={editForm.size}
                    onChange={(v) => editEditor.set("size", v)}
                  />
                )}
              </Field>
              <div className="sm:col-span-2">
                <Checkbox
                  checked={editForm.autoscalingEnabled}
                  onChange={(checked) => editEditor.set("autoscalingEnabled", checked)}
                >
                  オートスケーリングを有効にする
                </Checkbox>
              </div>
              {editForm.autoscalingEnabled && (
                <>
                  <Field label="最小インスタンス数" required error={editEditor.errors.minReplicas}>
                    {(id) => (
                      <TextInput
                        id={id}
                        value={editForm.minReplicas}
                        onChange={(v) => editEditor.set("minReplicas", v)}
                      />
                    )}
                  </Field>
                  <Field label="最大インスタンス数" required error={editEditor.errors.maxReplicas}>
                    {(id) => (
                      <TextInput
                        id={id}
                        value={editForm.maxReplicas}
                        onChange={(v) => editEditor.set("maxReplicas", v)}
                      />
                    )}
                  </Field>
                  <Field
                    label="目標 CPU 使用率"
                    required
                    error={editEditor.errors.targetCpu}
                    hint="0 より大きく 1 以下（例: 0.6）"
                  >
                    {(id) => (
                      <TextInput
                        id={id}
                        value={editForm.targetCpu}
                        onChange={(v) => editEditor.set("targetCpu", v)}
                      />
                    )}
                  </Field>
                  <Field
                    label="クールダウン期間 (秒)"
                    required
                    error={editEditor.errors.coolDownSec}
                  >
                    {(id) => (
                      <TextInput
                        id={id}
                        value={editForm.coolDownSec}
                        onChange={(v) => editEditor.set("coolDownSec", v)}
                      />
                    )}
                  </Field>
                </>
              )}
            </CreateFormSection>
          );
        })()}
      <ResourceTable
        label="インスタンス グループ"
        rows={world.instanceGroups.filter((g) => g.projectId === projectId)}
        keyOf={(g) => `${MigLocation.name(g.location)}/${g.name}`}
        nameOf={(g) => g.name}
        empty="インスタンス グループはまだありません。上の「インスタンス グループを作成」または gcloud compute instance-groups managed create で作成できます。"
        onEdit={(g) => {
          editor.close();
          editEditor.openWith(InstanceGroupEditForm.from(g));
        }}
        columns={[
          {
            header: "名前",
            cell: (g) => <span className="font-medium font-mono text-accent">{g.name}</span>,
          },
          { header: "ロケーション", cell: (g) => MigLocation.name(g.location) },
          { header: "テンプレート", cell: (g) => g.template },
          { header: "台数", cell: (g) => String(g.targetSize) },
          {
            header: "オートスケーリング",
            cell: (g) =>
              Option.isSome(g.autoscaling)
                ? `${g.autoscaling.value.minReplicas}〜${g.autoscaling.value.maxReplicas} (CPU ${Math.round(g.autoscaling.value.targetCpuUtilization * 100)}%)`
                : "オフ",
          },
        ]}
      />
    </div>
  );
};

const EmptyDiskEditForm = (): DiskEditForm =>
  DiskEditForm.from({
    name: "",
    location: "asia-northeast1-a",
    locationScope: "zone",
    type: "pd-balanced",
    sizeGb: 100,
  });

const DisksScreen = ({ world, project, handlers, outcome }: ScreenProps): ReactElement => {
  const projectId = project.projectId;
  const snapshots = World.diskSnapshotsOf(world, projectId);
  const seed = (): DiskCreateForm => DiskCreateForm.create(defaultZoneOf(world));
  const editor = useCreateForm(DiskCreateForm, seed, false, outcome);
  const editEditor = useCreateForm(DiskEditForm, EmptyDiskEditForm, false, outcome);
  const form = Option.unwrapOr(editor.form, seed());

  const create = (): void => {
    const valid = editor.submit();
    if (!Option.isSome(valid)) return;
    handlers.submit({
      line: DiskCreateForm.toCommand(valid.value, projectId),
      note: `ディスクを作成 (${valid.value.name})`,
      next: Option.none,
    });
    editor.awaitClose();
  };

  const saveEdit = (): void => {
    const valid = editEditor.submit();
    if (!Option.isSome(valid)) return;
    const [first, ...rest] = DiskEditForm.toSteps(valid.value, projectId);
    if (first === undefined) {
      editEditor.close();
      return;
    }
    handlers.submit({ ...first, next: Option.none, rest });
    editEditor.awaitClose();
  };

  const instances = World.instancesOf(world, projectId);
  const attachedTo = (zone: string, diskName: string, users: readonly string[]): string => {
    const fromUsers = users.map((u) => u.split("/").at(-1) ?? u);
    if (fromUsers.length > 0) return fromUsers.join(", ");
    const fromInstances = instances
      .filter((inst) => inst.zone === zone && inst.disks.some((d) => d.deviceName === diskName))
      .map((inst) => inst.name);
    return fromInstances.length > 0 ? fromInstances.join(", ") : "-";
  };

  const rows = [
    ...instances.flatMap((instance) =>
      instance.disks
        .filter((d) => d.boot)
        .map((d) => ({
          key: `${instance.zone}/${d.deviceName}`,
          name: d.deviceName,
          location: instance.zone,
          locationScope: "zone" as const,
          sizeGb: d.sizeGb,
          type: d.type,
          users: instance.name,
          iops: undefined,
          throughput: undefined,
        })),
    ),
    ...World.disksOf(world, projectId).map((d) => ({
      key: `${d.zone}/${d.name}`,
      name: d.name,
      location: d.zone,
      locationScope: "zone" as const,
      sizeGb: d.sizeGb,
      type: d.type,
      users: attachedTo(d.zone, d.name, d.users),
      iops: undefined,
      throughput: undefined,
    })),
    ...world.computeLab.disks
      .filter((d) => d.projectId === projectId)
      .map((d) => ({
        key: `${d.location}/${d.name}`,
        name: d.name,
        location: d.location,
        locationScope: Option.isSome(Region.parse(d.location))
          ? ("region" as const)
          : ("zone" as const),
        sizeGb: d.sizeGb,
        type: d.type,
        users: attachedTo(d.location, d.name, d.users),
        iops: d.iops,
        throughput: d.throughput,
      })),
  ];

  return (
    <div>
      <ScreenTitle
        eyebrow="Compute Engine"
        title="ディスク"
        trailing={
          <PrimaryButton
            onClick={() => {
              editEditor.close();
              editor.open();
            }}
          >
            ＋ ディスクを作成
          </PrimaryButton>
        }
      />
      {Option.isSome(editor.form) && (
        <CreateFormSection
          label="ディスクを作成"
          columns={2}
          command={DiskCreateForm.toCommand(form, projectId)}
          onCopy={handlers.copy}
          onInsert={handlers.insert}
          onSubmit={create}
          onCancel={editor.close}
          submitLabel="作成"
        >
          <Field label="名前" required error={editor.errors.name}>
            {(id) => (
              <TextInput
                id={id}
                value={form.name}
                placeholder="data-disk-1"
                onChange={(v) => editor.set("name", v)}
              />
            )}
          </Field>
          <Field label="ゾーン">
            {(id) => (
              <Select
                id={id}
                value={form.zone}
                onChange={(z) => editor.set("zone", z)}
                options={Zone.all().map((z) => ({ value: z, label: z }))}
              />
            )}
          </Field>
          <Field label="ディスク タイプ">
            {(id) => (
              <Select<DiskCreateType>
                id={id}
                value={form.type}
                onChange={(v) => editor.set("type", v)}
                options={[
                  { value: "pd-balanced", label: "バランス永続ディスク (pd-balanced)" },
                  { value: "pd-ssd", label: "SSD 永続ディスク (pd-ssd)" },
                  { value: "pd-standard", label: "標準永続ディスク (pd-standard)" },
                  { value: "hyperdisk-balanced", label: "Hyperdisk Balanced (hyperdisk-balanced)" },
                ]}
              />
            )}
          </Field>
          <Field label="サイズ" required error={editor.errors.size} hint="例: 100GB">
            {(id) => (
              <TextInput id={id} value={form.size} onChange={(v) => editor.set("size", v)} />
            )}
          </Field>
          <div className="sm:col-span-2">
            <Field label="ソース スナップショット" hint="空のままにすると空のディスクを作成します">
              {(id) => (
                <Select
                  id={id}
                  value={form.sourceSnapshot}
                  onChange={(v) => editor.set("sourceSnapshot", v)}
                  options={[
                    { value: "", label: "なし（空のディスク）" },
                    ...snapshots.map((s) => ({
                      value: s.name,
                      label: `${s.name} (${s.diskSizeGb} GB)`,
                    })),
                  ]}
                />
              )}
            </Field>
          </div>
        </CreateFormSection>
      )}
      {Option.isSome(editEditor.form) &&
        (() => {
          const editForm = editEditor.form.value;
          const editSteps = DiskEditForm.toSteps(editForm, projectId);
          return (
            <CreateFormSection
              label="ディスクを編集"
              columns={2}
              command={DiskEditForm.toCommand(editForm, projectId)}
              onCopy={handlers.copy}
              onInsert={() => handlers.insert(editSteps[0]?.line ?? "")}
              onSubmit={saveEdit}
              onCancel={editEditor.close}
              submitLabel="保存"
            >
              <Field label="名前">{(id) => <ReadOnlyField id={id} value={editForm.name} />}</Field>
              <Field label="ロケーション">
                {(id) => <ReadOnlyField id={id} value={editForm.location} />}
              </Field>
              <Field label="種類">{(id) => <ReadOnlyField id={id} value={editForm.type} />}</Field>
              <Field
                label="サイズ"
                required
                error={editEditor.errors.size}
                hint={`現在 ${editForm.initialSizeGb} GB（拡張のみ可能）`}
              >
                {(id) => (
                  <TextInput
                    id={id}
                    value={editForm.size}
                    onChange={(v) => editEditor.set("size", v)}
                  />
                )}
              </Field>
              {editForm.isHyperdisk && (
                <>
                  <Field label="プロビジョニング済み IOPS" required error={editEditor.errors.iops}>
                    {(id) => (
                      <TextInput
                        id={id}
                        value={editForm.iops}
                        onChange={(v) => editEditor.set("iops", v)}
                      />
                    )}
                  </Field>
                  <Field
                    label="プロビジョニング済みスループット (MiB/s)"
                    required
                    error={editEditor.errors.throughput}
                  >
                    {(id) => (
                      <TextInput
                        id={id}
                        value={editForm.throughput}
                        onChange={(v) => editEditor.set("throughput", v)}
                      />
                    )}
                  </Field>
                </>
              )}
            </CreateFormSection>
          );
        })()}
      <ResourceTable
        label="ディスク"
        rows={rows}
        keyOf={(d) => d.key}
        nameOf={(d) => d.name}
        empty="ディスクはまだありません。上の「ディスクを作成」または gcloud compute disks create で作成できます。"
        onEdit={(d) => {
          editor.close();
          editEditor.openWith(
            DiskEditForm.from({
              name: d.name,
              location: d.location,
              locationScope: d.locationScope,
              type: d.type,
              sizeGb: d.sizeGb,
              iops: d.iops,
              throughput: d.throughput,
            }),
          );
        }}
        columns={[
          {
            header: "名前",
            cell: (d) => <span className="font-medium font-mono text-accent">{d.name}</span>,
          },
          { header: "ロケーション", cell: (d) => d.location },
          { header: "サイズ (GB)", cell: (d) => String(d.sizeGb) },
          { header: "種類", cell: (d) => d.type },
          { header: "使用元", cell: (d) => d.users },
        ]}
      />
    </div>
  );
};

const SnapshotsScreen = ({ world, project, handlers, outcome }: ScreenProps): ReactElement => {
  const projectId = project.projectId;
  const disks = diskChoicesOf(world, projectId);
  const seed = (): SnapshotCreateForm => SnapshotCreateForm.create(disks[0]?.ref ?? "");
  const editor = useCreateForm(SnapshotCreateForm, seed, false, outcome);
  const form = Option.unwrapOr(editor.form, seed());

  const create = (): void => {
    const valid = editor.submit();
    if (!Option.isSome(valid)) return;
    handlers.submit({
      line: SnapshotCreateForm.toCommand(valid.value, projectId),
      note: `スナップショットを作成 (${valid.value.name})`,
      next: Option.none,
    });
    editor.awaitClose();
  };

  const remove = (name: string): void => {
    if (!handlers.confirm(`スナップショット ${name} を削除しますか？`)) return;
    handlers.submit({
      line: DeleteCommand.snapshot(name, projectId),
      note: `スナップショットを削除 (${name})`,
      next: Option.none,
    });
  };

  return (
    <div>
      <ScreenTitle
        eyebrow="Compute Engine"
        title="スナップショット"
        trailing={<PrimaryButton onClick={editor.open}>＋ スナップショットを作成</PrimaryButton>}
      />
      {Option.isSome(editor.form) && (
        <CreateFormSection
          label="スナップショットを作成"
          columns={2}
          command={SnapshotCreateForm.toCommand(form, projectId)}
          onCopy={handlers.copy}
          onInsert={handlers.insert}
          onSubmit={create}
          onCancel={editor.close}
          submitLabel="作成"
        >
          <Field label="名前" required error={editor.errors.name}>
            {(id) => (
              <TextInput
                id={id}
                value={form.name}
                placeholder="snapshot-1"
                onChange={(v) => editor.set("name", v)}
              />
            )}
          </Field>
          <Field label="ソース ディスク" required error={editor.errors.sourceDisk}>
            {(id) => (
              <Select
                id={id}
                value={form.sourceDisk}
                onChange={(v) => editor.set("sourceDisk", v)}
                options={
                  disks.length > 0
                    ? disks.map((d) => ({ value: d.ref, label: d.label }))
                    : [{ value: "", label: "（ディスクがありません）" }]
                }
              />
            )}
          </Field>
        </CreateFormSection>
      )}
      <ResourceTable
        label="スナップショット"
        rows={World.diskSnapshotsOf(world, projectId)}
        keyOf={(s) => s.name}
        nameOf={(s) => s.name}
        empty="スナップショットはまだありません。上の「スナップショットを作成」または gcloud compute disks snapshot で作成できます。"
        onDelete={(s) => remove(s.name)}
        columns={[
          {
            header: "名前",
            cell: (s) => <span className="font-medium font-mono text-accent">{s.name}</span>,
          },
          { header: "ソースディスク", cell: (s) => s.sourceDisk },
          { header: "ソースゾーン", cell: (s) => s.sourceZone },
          { header: "サイズ (GB)", cell: (s) => String(s.diskSizeGb) },
        ]}
      />
    </div>
  );
};

const ImagesScreen = ({ world, project, handlers, outcome }: ScreenProps): ReactElement => {
  const projectId = project.projectId;
  const disks = diskChoicesOf(world, projectId);
  const snapshots = World.diskSnapshotsOf(world, projectId);
  const seed = (): ImageCreateForm =>
    ImageCreateForm.create({
      sourceDisk: disks[0]?.ref ?? "",
      sourceSnapshot: snapshots[0]?.name ?? "",
    });
  const editor = useCreateForm(ImageCreateForm, seed, false, outcome);
  const form = Option.unwrapOr(editor.form, seed());

  const create = (): void => {
    const valid = editor.submit();
    if (!Option.isSome(valid)) return;
    handlers.submit({
      line: ImageCreateForm.toCommand(valid.value, projectId),
      note: `カスタム イメージを作成 (${valid.value.name})`,
      next: Option.none,
    });
    editor.awaitClose();
  };

  const remove = (name: string): void => {
    if (!handlers.confirm(`カスタム イメージ ${name} を削除しますか？`)) return;
    handlers.submit({
      line: DeleteCommand.image(name, projectId),
      note: `カスタム イメージを削除 (${name})`,
      next: Option.none,
    });
  };

  const rows = [
    ...world.computeLab.images
      .filter((i) => i.projectId === projectId)
      .map((i) => ({
        key: `${i.projectId}/${i.name}`,
        name: i.name,
        project: i.projectId,
        family: i.family || "-",
        custom: true,
      })),
    ...PublicImage.all().map((i) => ({
      key: `${i.project}/${i.name}`,
      name: i.name,
      project: i.project,
      family: i.family,
      custom: false,
    })),
  ];

  return (
    <div>
      <ScreenTitle
        eyebrow="Compute Engine"
        title="イメージ"
        trailing={<PrimaryButton onClick={editor.open}>＋ イメージを作成</PrimaryButton>}
      />
      {Option.isSome(editor.form) && (
        <CreateFormSection
          label="イメージを作成"
          columns={2}
          command={ImageCreateForm.toCommand(form, projectId)}
          onCopy={handlers.copy}
          onInsert={handlers.insert}
          onSubmit={create}
          onCancel={editor.close}
          submitLabel="作成"
        >
          <Field label="名前" required error={editor.errors.name}>
            {(id) => (
              <TextInput
                id={id}
                value={form.name}
                placeholder="custom-web-image"
                onChange={(v) => editor.set("name", v)}
              />
            )}
          </Field>
          <Field label="ファミリー" error={editor.errors.family} hint="任意（例: my-app-family）">
            {(id) => (
              <TextInput id={id} value={form.family} onChange={(v) => editor.set("family", v)} />
            )}
          </Field>
          <div className="sm:col-span-2">
            <RadioGroup<ImageSourceKind>
              label="ソース"
              name="image-source-kind"
              value={form.sourceKind}
              onChange={(v) => editor.set("sourceKind", v)}
              options={[
                { value: "snapshot", label: "スナップショットから作成" },
                { value: "disk", label: "ディスクから作成（VM のブートディスクは停止が必要）" },
              ]}
            />
          </div>
          {form.sourceKind === "snapshot" ? (
            <div className="sm:col-span-2">
              <Field label="ソース スナップショット" required error={editor.errors.sourceSnapshot}>
                {(id) => (
                  <Select
                    id={id}
                    value={form.sourceSnapshot}
                    onChange={(v) => editor.set("sourceSnapshot", v)}
                    options={
                      snapshots.length > 0
                        ? snapshots.map((s) => ({
                            value: s.name,
                            label: `${s.name} (${s.diskSizeGb} GB)`,
                          }))
                        : [{ value: "", label: "（スナップショットがありません）" }]
                    }
                  />
                )}
              </Field>
            </div>
          ) : (
            <div className="sm:col-span-2">
              <Field label="ソース ディスク" required error={editor.errors.sourceDisk}>
                {(id) => (
                  <Select
                    id={id}
                    value={form.sourceDisk}
                    onChange={(v) => editor.set("sourceDisk", v)}
                    options={
                      disks.length > 0
                        ? disks.map((d) => ({ value: d.ref, label: d.label }))
                        : [{ value: "", label: "（ディスクがありません）" }]
                    }
                  />
                )}
              </Field>
            </div>
          )}
        </CreateFormSection>
      )}
      <ResourceTable
        label="イメージ"
        rows={rows}
        keyOf={(i) => i.key}
        nameOf={(i) => i.name}
        empty="イメージはまだありません。"
        onDelete={(i) => remove(i.name)}
        deletable={(i) => i.custom}
        columns={[
          {
            header: "名前",
            cell: (i) => (
              <span className={`font-mono ${i.custom ? "font-medium text-accent" : ""}`}>
                {i.name}
              </span>
            ),
          },
          { header: "プロジェクト", cell: (i) => i.project },
          { header: "ファミリー", cell: (i) => i.family },
        ]}
      />
    </div>
  );
};

export const ComputeResourceScreen = ({
  screen,
  ...props
}: ScreenProps & Readonly<{ screen: ResourceScreen }>): ReactElement => {
  switch (screen) {
    case "instance-templates":
      return <InstanceTemplatesScreen {...props} />;
    case "instance-groups":
      return <InstanceGroupsScreen {...props} />;
    case "disks":
      return <DisksScreen {...props} />;
    case "snapshots":
      return <SnapshotsScreen {...props} />;
    case "images":
      return <ImagesScreen {...props} />;
    case "operations":
      return (
        <div>
          <ScreenTitle eyebrow="Compute Engine" title={screenText(screen)} />
          <ResourceTable
            label="オペレーション"
            rows={[...World.operationsOf(props.world, props.project.projectId)].reverse()}
            keyOf={(o) => o.name}
            empty="オペレーションはまだありません。Compute Engine のリソース操作を行うと履歴が表示されます。"
            columns={[
              { header: "名前", cell: (o) => <span className="font-mono text-xs">{o.name}</span> },
              { header: "操作", cell: (o) => o.operationType },
              { header: "対象", cell: (o) => o.targetName },
              { header: "状態", cell: (o) => <ConsoleStatus status={o.status} /> },
              { header: "ロケーション", cell: (o) => Option.unwrapOr(o.zone, "global") },
              { header: "時刻", cell: (o) => o.insertTime.slice(0, 19).replace("T", " ") },
            ]}
          />
        </div>
      );
    case "zones":
      return (
        <div>
          <ScreenTitle eyebrow="Compute Engine" title={screenText(screen)} />
          <ResourceTable
            label="ゾーン"
            rows={Zone.all()}
            keyOf={(zone) => zone}
            empty=""
            columns={[
              { header: "名前", cell: (zone) => <span className="font-mono">{zone}</span> },
              { header: "リージョン", cell: (zone) => Zone.region(zone) },
            ]}
          />
        </div>
      );
  }
};
