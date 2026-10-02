import { type ReactElement, useState } from "react";

import { Select } from "@/components/Select";

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
  CreatePage,
  Field,
  InputClass,
  PrimaryButton,
  RadioGroup,
  ScreenTitle,
  SecondaryButton,
} from "@/features/simulator/features/console/components/ConsoleParts";
import { ConsoleScreens } from "@/features/simulator/features/console/domains/console-screen";
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
const StatusIcon = ({ instance }: Readonly<{ instance: Instance }>): ReactElement => (
  <span role="img" aria-label={instance.status} title={instance.status} className="inline-flex">
    {InstanceOps.isRunning(instance) ? (
      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5">
        <circle cx="10" cy="10" r="9" className="fill-ok" />
        <path d="M6 10.2l2.6 2.6L14 7.4" fill="none" stroke="white" strokeWidth="1.8" />
      </svg>
    ) : (
      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5">
        <circle cx="10" cy="10" r="9" className="fill-[#8a919c]" />
        {instance.status === "SUSPENDED" ? (
          <path d="M8 6.5v7M12 6.5v7" stroke="white" strokeWidth="1.8" />
        ) : (
          <rect x="7" y="7" width="6" height="6" rx="0.5" fill="white" />
        )}
      </svg>
    )}
  </span>
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

/** Compute Engine › VM インスタンス（UI 案 2b）。選んだ VM に対する操作は CLI のコマンドとして流す。 */
export const VmListScreen = ({ world, project, handlers }: ScreenProps): ReactElement => {
  const [selectedNames, setSelectedNames] = useState<ReadonlySet<string>>(new Set());
  const [filter, setFilter] = useState("");
  const instances = World.instancesOf(world, project.projectId);
  const shown = instances.filter((i) => searchableText(i).includes(filter.trim().toLowerCase()));
  const selected = instances.filter((i) => selectedNames.has(i.name));
  const allChecked = shown.length > 0 && shown.every((i) => selectedNames.has(i.name));
  const toggle = (name: string): void =>
    setSelectedNames((names) => {
      const next = new Set(names);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  const run = (action: VmAction, instance: Instance): void =>
    handlers.submit({
      line: VmActionOps.toCommand(action, instance),
      note: `${actionText(action)} (${instance.name})`,
      next: Option.none,
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
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2">
        <div>
          <p className="mb-1 text-muted text-sm">Compute Engine</p>
          <h2 className="font-bold text-[28px] leading-tight">VM インスタンス</h2>
        </div>
        <div className="flex items-center gap-1 self-end pb-1 text-[15px]">
          <button
            type="button"
            className="rounded-md px-2.5 py-1 font-bold text-accent hover:bg-accent-soft"
            onClick={() => handlers.changeScreen(ConsoleScreens.VmCreate)}
          >
            <span aria-hidden="true">＋ </span>インスタンスを作成
          </button>
          <span aria-hidden="true" className="mx-2 h-5 border-line border-l" />
          {ToolbarActions.map((action) => (
            <button
              key={action}
              type="button"
              disabled={!isEnabled(action)}
              className="rounded-md px-2.5 py-1 text-accent hover:bg-accent-soft disabled:cursor-not-allowed disabled:text-muted/60 disabled:hover:bg-transparent"
              onClick={() => perform(action)}
            >
              {toolbarText(action)}
            </button>
          ))}
        </div>
      </div>
      <label className="mb-4 flex h-11 items-center gap-3 rounded-lg border border-line bg-surface px-4">
        <span className="font-bold text-[15px]">フィルタ</span>
        <input
          className="min-w-0 flex-1 bg-transparent text-[15px] placeholder:text-muted focus:outline-none"
          placeholder="プロパティ名または値を入力"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="font-mono text-muted text-sm">= --filter</span>
      </label>
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <table className="w-full text-[15px]" aria-label="VM インスタンス">
          <thead className="bg-canvas text-left">
            <tr>
              <th className="w-12 py-3 pl-4">
                <input
                  type="checkbox"
                  aria-label="すべて選択"
                  className="h-4 w-4 accent-accent"
                  checked={allChecked}
                  onChange={() =>
                    setSelectedNames(allChecked ? new Set() : new Set(shown.map((i) => i.name)))
                  }
                />
              </th>
              <th className="w-14 py-3 pr-3 font-bold">状態</th>
              <th className="py-3 pr-3 font-bold">名前 ↑</th>
              <th className="py-3 pr-3 font-bold">ゾーン</th>
              <th className="py-3 pr-3 font-bold">マシンタイプ</th>
              <th className="py-3 pr-3 font-bold">内部 IP</th>
              <th className="py-3 pr-3 font-bold">外部 IP</th>
              <th className="py-3 pr-4 font-bold">接続</th>
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
              const nic = i.networkInterfaces[0];
              const address = nic === undefined ? Option.none : ExternalIp.address(nic.externalIP);
              const isChecked = selectedNames.has(i.name);
              const canSsh = VmActionOps.availableFor(i).includes("ssh");
              return (
                <tr
                  key={`${i.zone}/${i.name}`}
                  className={`border-line border-t ${isChecked ? "bg-accent-soft/60" : ""}`}
                >
                  <td className="py-3.5 pl-4">
                    <input
                      type="checkbox"
                      aria-label={`${i.name} を選択`}
                      className="h-4 w-4 accent-accent"
                      checked={isChecked}
                      onChange={() => toggle(i.name)}
                    />
                  </td>
                  <td className="py-3.5 pr-3">
                    <StatusIcon instance={i} />
                  </td>
                  <td className="py-3.5 pr-3 font-bold text-accent">{i.name}</td>
                  <td className="py-3.5 pr-3">{i.zone}</td>
                  <td className="py-3.5 pr-3 font-mono">{i.machineType}</td>
                  <td className="py-3.5 pr-3 font-mono">{nic?.networkIP ?? "-"}</td>
                  <td className="py-3.5 pr-3">
                    {Option.isSome(address) ? (
                      <span className="font-mono text-accent">{address.value}</span>
                    ) : (
                      <span className="text-muted">なし</span>
                    )}
                  </td>
                  <td className="py-3.5 pr-4">
                    <button
                      type="button"
                      aria-label={`${i.name} に SSH`}
                      disabled={!canSsh}
                      className="font-bold text-accent disabled:font-normal disabled:text-muted/70"
                      onClick={() => run("ssh", i)}
                    >
                      SSH
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-right text-muted text-sm">
        {shown.length === 0 ? 0 : 1}〜{shown.length} / {shown.length}
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
const seriesOf = (machineType: string): string =>
  (machineType.split("-")[0] ?? machineType).toUpperCase();

const machineTypeText = (m: MachineType): string =>
  `${m.name}（${m.guestCpus} vCPU、${m.memoryMb / 1024} GB メモリ）`;

const diskTypeText = (type: BootDiskType): string => {
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
const TagInput = ({
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
          <button
            type="button"
            aria-label={`${tag} を外す`}
            className="text-muted text-xs"
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
          </button>
        </span>
      ))}
      <input
        id={id}
        className="min-w-24 flex-1 bg-transparent px-1 font-mono text-[15px] focus:outline-none"
        value={draft}
        onChange={(e) => onChange(withTags(committed, e.target.value))}
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

const NameRuleText = "小文字英字で始め、小文字・数字・ハイフンのみ使用できます";

/** Compute Engine › インスタンスを作成（UI 案 s1）。入力のたびに同等のコマンドを出す。 */
export const VmCreateScreen = ({ world, project, handlers }: ScreenProps): ReactElement => {
  const projectId = project.projectId;
  const defaultAccount = ServiceAccount.defaultComputeEmail(project.projectNumber);
  const [isDiskOpen, setDiskOpen] = useState(false);
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
  };
  const canCreate = FieldErrors.isEmpty(live);
  const parts = VmCreateForm.toParts(form, projectId);
  const accounts = [
    defaultAccount,
    ...World.serviceAccountsOf(world, projectId).map((s) => s.email),
  ];
  const images = PublicImage.all();
  const region = Zone.region(form.zone);
  const series = seriesOf(form.machineType);
  const allSeries = [...new Set(MachineType.all().map((m) => seriesOf(m.name)))];
  const create = (): void => {
    const valid = editor.submit();
    if (!Option.isSome(valid)) return;
    handlers.submit({
      line: VmCreateForm.toCommand(valid.value, projectId),
      note: `インスタンスを作成 (${valid.value.name})`,
      next: Option.some(ConsoleScreens.VmList),
    });
  };
  return (
    <CreatePage
      header={<ScreenTitle eyebrow="VM インスタンス /" title="インスタンスを作成" />}
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
        <Field label="名前" required error={errors.name}>
          {(id) => (
            <input
              id={id}
              className={InputClass}
              aria-invalid={errors.name !== undefined}
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-5">
          <Field label="リージョン">
            {(id) => (
              <Select
                id={id}
                font="sans"
                value={region}
                onChange={(r) => set("zone", `${r}-a`)}
                options={Region.all().map((r) => ({ value: r, label: regionText(r) }))}
              />
            )}
          </Field>
          <Field label="ゾーン">
            {(id) => (
              <Select
                id={id}
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
        <Field label="マシンの構成">
          {(id) => (
            <div className="flex flex-col gap-3">
              <fieldset className="flex gap-2">
                <legend className="sr-only">シリーズ</legend>
                {allSeries.map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={s === series}
                    className={`rounded-md border px-4 py-1.5 text-[15px] ${s === series ? "border-accent bg-accent-soft font-bold text-accent" : "border-line bg-surface"}`}
                    onClick={() => {
                      const first = MachineType.all().find((m) => seriesOf(m.name) === s);
                      if (first !== undefined && s !== series) set("machineType", first.name);
                    }}
                  >
                    {s}
                  </button>
                ))}
              </fieldset>
              <Select
                id={id}
                value={form.machineType}
                onChange={(machineType) => set("machineType", machineType)}
                options={MachineType.all()
                  .filter((m) => seriesOf(m.name) === series)
                  .map((m) => ({ value: m.name, label: machineTypeText(m) }))}
              />
            </div>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-5">
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
          <div>
            <p className="mb-2 font-bold text-sm">ブートディスク</p>
            <div className="flex h-9 items-center justify-between rounded-md border border-line bg-surface px-3 text-[15px]">
              <span>
                {form.imageFamily} · {form.bootDiskSize.replace(/GB$/, " GB")} ·{" "}
                {diskTypeText(form.bootDiskType)}
              </span>
              <button
                type="button"
                className="text-accent"
                aria-expanded={isDiskOpen}
                onClick={() => setDiskOpen((v) => !v)}
              >
                {isDiskOpen ? "閉じる" : "変更"}
              </button>
            </div>
          </div>
        </div>
        {isDiskOpen && (
          <div className="grid grid-cols-[2fr_1fr_1fr] gap-3 rounded-lg border border-line bg-surface p-4">
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
                <input
                  id={id}
                  className={InputClass}
                  aria-invalid={errors.bootDiskSize !== undefined}
                  value={form.bootDiskSize}
                  onChange={(e) => set("bootDiskSize", e.target.value)}
                />
              )}
            </Field>
            <Field label="種類">
              {(id) => (
                <Select
                  id={id}
                  value={form.bootDiskType}
                  onChange={(type) => set("bootDiskType", type)}
                  options={Object.values(BootDiskTypes).map((t) => ({ value: t, label: t }))}
                />
              )}
            </Field>
          </div>
        )}
        <div className="grid grid-cols-2 gap-5">
          <Field label="サービスアカウント">
            {(id) => (
              <Select
                id={id}
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
        <Field label="ネットワーク タグ">
          {(id) => <TagInput id={id} value={form.tags} onChange={(tags) => set("tags", tags)} />}
        </Field>
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
    </CreatePage>
  );
};
