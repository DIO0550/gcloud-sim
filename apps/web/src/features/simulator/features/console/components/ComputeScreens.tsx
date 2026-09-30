import { type ReactElement, useState } from "react";

import { DefaultImage, MachineType, PublicImage, Zone } from "@/engine/domains/catalog";
import {
  BootDiskTypes,
  ExternalIp,
  type Instance,
  ProvisioningModels,
} from "@/engine/domains/compute";
import { GcloudConfig } from "@/engine/domains/gcloud-config";
import { ServiceAccount } from "@/engine/domains/service-account";
import { World } from "@/engine/domains/world";
import {
  DataTable,
  EquivalentCommandPanel,
  Field,
  inputClass,
  OutcomeBanner,
  PrimaryButton,
  ScreenTitle,
  SecondaryButton,
} from "@/features/simulator/features/console/components/parts";
import { ConsoleScreens } from "@/features/simulator/features/console/domains/console-screen";
import {
  EnableApiCommand,
  type VmAction,
  VmAction as VmActionOps,
  VmCreateForm,
} from "@/features/simulator/features/console/domains/equivalent-command";
import type { ScreenProps } from "@/features/simulator/features/console/types/screen-props";
import { Option } from "@/utils/Option";

/** 操作ボタンの綴り（UI 案 2b）。 */
const actionText = (action: VmAction): string => {
  switch (action) {
    case "start":
      return "開始 / 再開";
    case "stop":
      return "停止";
    case "suspend":
      return "一時停止";
    case "resume":
      return "再開";
    case "delete":
      return "削除";
    case "ssh":
      return "SSH";
  }
};

const StatusDot = ({ status }: Readonly<{ status: Instance["status"] }>): ReactElement => (
  <span className="flex items-center gap-1.5">
    <span
      role="img"
      aria-label={status}
      className={`inline-block h-2 w-2 rounded-full ${status === "RUNNING" ? "bg-ok" : "bg-line"}`}
    />
    <span className="text-xs">{status}</span>
  </span>
);

/** Compute Engine › VM インスタンス（UI 案 2b）。選んだ VM に対する操作は CLI のコマンドとして流す。 */
export const VmListScreen = (props: ScreenProps): ReactElement => {
  const { world, projectId, actions } = props;
  const [selectedName, setSelectedName] = useState<Option<string>>(Option.none);
  const instances = World.instancesOf(world, projectId);
  const selected = Option.flatMap(selectedName, (name) =>
    Option.fromNullable(instances.find((i) => i.name === name)),
  );
  const perform = (action: VmAction, instance: Instance): void => {
    const isDelete = action === "delete";
    if (isDelete && !actions.confirm(`${instance.name} を削除しますか？`)) return;
    actions.submit({
      line: VmActionOps.toCommand(action, instance),
      note: `${actionText(action)} (${instance.name})`,
      next: Option.none,
    });
  };
  return (
    <div>
      <ScreenTitle
        eyebrow="Compute Engine"
        title="VM インスタンス"
        actions={
          <PrimaryButton onClick={() => actions.changeScreen(ConsoleScreens.VmCreate)}>
            インスタンスを作成
          </PrimaryButton>
        }
      />
      <OutcomeBanner
        outcome={props.outcome}
        onEnableApi={() =>
          actions.submit({
            line: EnableApiCommand.toCommand("compute.googleapis.com", projectId),
            note: "Compute Engine API を有効にする",
            next: Option.none,
          })
        }
        onDismiss={props.onOutcomeDismiss}
      />
      {Option.isSome(selected) && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-line bg-canvas px-3 py-2 text-sm">
          <span className="font-mono">{selected.value.name}</span>
          <span className="text-muted">を選択中:</span>
          {VmActionOps.availableFor(selected.value).map((action) => (
            <SecondaryButton key={action} onClick={() => perform(action, selected.value)}>
              {actionText(action)}
            </SecondaryButton>
          ))}
        </div>
      )}
      <DataTable
        label="VM インスタンス"
        rows={instances}
        keyOf={(i) => `${i.zone}/${i.name}`}
        empty="VM はまだありません。「インスタンスを作成」から作れます。"
        columns={[
          {
            header: "",
            className: "w-8",
            cell: (i) => (
              <input
                type="radio"
                name="vm"
                aria-label={`${i.name} を選択`}
                checked={Option.isSome(selectedName) && selectedName.value === i.name}
                onChange={() => setSelectedName(Option.some(i.name))}
              />
            ),
          },
          { header: "状態", cell: (i) => <StatusDot status={i.status} /> },
          { header: "名前", cell: (i) => <span className="font-mono">{i.name}</span> },
          { header: "ゾーン", cell: (i) => <span className="font-mono">{i.zone}</span> },
          {
            header: "マシンタイプ",
            cell: (i) => <span className="font-mono">{i.machineType}</span>,
          },
          {
            header: "内部 IP",
            cell: (i) => (
              <span className="font-mono">{i.networkInterfaces[0]?.networkIP ?? "-"}</span>
            ),
          },
          {
            header: "外部 IP",
            cell: (i) => {
              const nic = i.networkInterfaces[0];
              const address = nic === undefined ? Option.none : ExternalIp.address(nic.externalIP);
              return <span className="font-mono">{Option.unwrapOr(address, "なし")}</span>;
            },
          },
        ]}
      />
    </div>
  );
};

const zoneOf = (world: World): Zone =>
  Option.unwrapOr(
    Option.flatMap(GcloudConfig.get(world.config, "compute/zone"), Zone.parse),
    "asia-northeast1-a",
  );

/** Compute Engine › インスタンスを作成（UI 案 2c / s1）。入力のたびに同等のコマンドを出す。 */
export const VmCreateScreen = (props: ScreenProps): ReactElement => {
  const { world, projectId, actions } = props;
  const project = World.findProject(world, projectId);
  const defaultAccount = Option.isSome(project)
    ? ServiceAccount.defaultComputeEmail(project.value.projectNumber)
    : "default";
  const [form, setForm] = useState<VmCreateForm>(() =>
    VmCreateForm.initial({ zone: zoneOf(world), serviceAccount: defaultAccount }),
  );
  const [submitted, setSubmitted] = useState(false);
  const errors = submitted ? VmCreateForm.validate(form) : {};
  const command = VmCreateForm.toCommand(form, projectId);
  const set = <K extends keyof VmCreateForm>(key: K, value: VmCreateForm[K]): void =>
    setForm((f) => ({ ...f, [key]: value }));
  const accounts = [
    defaultAccount,
    ...World.serviceAccountsOf(world, projectId).map((s) => s.email),
  ];
  const images = PublicImage.all();
  const create = (): void => {
    setSubmitted(true);
    if (!VmCreateForm.isValid(form)) return;
    actions.submit({
      line: command,
      note: `インスタンスを作成 (${form.name})`,
      next: Option.some(ConsoleScreens.VmList),
    });
  };
  return (
    <div>
      <ScreenTitle eyebrow="Compute Engine › VM インスタンス" title="インスタンスを作成" />
      <OutcomeBanner
        outcome={props.outcome}
        onEnableApi={() =>
          actions.submit({
            line: EnableApiCommand.toCommand("compute.googleapis.com", projectId),
            note: "Compute Engine API を有効にする",
            next: Option.none,
          })
        }
        onDismiss={props.onOutcomeDismiss}
      />
      <div className="grid max-w-3xl grid-cols-2 gap-4">
        <Field label="名前" error={errors.name}>
          {(id) => (
            <input
              id={id}
              className={inputClass}
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
            />
          )}
        </Field>
        <Field label="ゾーン" hint={`リージョン: ${Zone.region(form.zone)}`}>
          {(id) => (
            <select
              id={id}
              className={inputClass}
              value={form.zone}
              onChange={(e) => set("zone", Option.unwrapOr(Zone.parse(e.target.value), form.zone))}
            >
              {Zone.all().map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="マシンタイプ" hint="シリーズ: E2 / N2 / N2D / C3 / N1">
          {(id) => (
            <select
              id={id}
              className={inputClass}
              value={form.machineType}
              onChange={(e) => set("machineType", e.target.value)}
            >
              {MachineType.all().map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}（{m.description}）
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="プロビジョニング モデル">
          {(id) => (
            <select
              id={id}
              className={inputClass}
              value={form.provisioningModel}
              onChange={(e) =>
                set("provisioningModel", e.target.value === "SPOT" ? "SPOT" : "STANDARD")
              }
            >
              {Object.values(ProvisioningModels).map((m) => (
                <option key={m} value={m}>
                  {m === "SPOT" ? "Spot" : "標準"}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="ブートディスク: イメージ">
          {(id) => (
            <select
              id={id}
              className={inputClass}
              value={`${form.imageProject}/${form.imageFamily}`}
              onChange={(e) => {
                const image =
                  images.find((i) => `${i.project}/${i.family}` === e.target.value) ?? DefaultImage;
                setForm((f) => ({ ...f, imageFamily: image.family, imageProject: image.project }));
              }}
            >
              {images.map((i) => (
                <option key={i.name} value={`${i.project}/${i.family}`}>
                  {i.family}（{i.project}）
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="サイズ" error={errors.bootDiskSize}>
            {(id) => (
              <input
                id={id}
                className={inputClass}
                value={form.bootDiskSize}
                onChange={(e) => set("bootDiskSize", e.target.value)}
              />
            )}
          </Field>
          <Field label="種類" error={errors.bootDiskType}>
            {(id) => (
              <select
                id={id}
                className={inputClass}
                value={form.bootDiskType}
                onChange={(e) => set("bootDiskType", e.target.value)}
              >
                {Object.values(BootDiskTypes).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <Field label="サービスアカウント">
          {(id) => (
            <select
              id={id}
              className={inputClass}
              value={form.serviceAccount}
              onChange={(e) => set("serviceAccount", e.target.value)}
            >
              {accounts.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="アクセススコープ">
          {(id) => (
            <select
              id={id}
              className={inputClass}
              value={form.scopes}
              onChange={(e) =>
                set("scopes", e.target.value === "cloud-platform" ? "cloud-platform" : "default")
              }
            >
              <option value="default">デフォルトのアクセス権を許可</option>
              <option value="cloud-platform">すべての Cloud API に完全アクセス権を許可</option>
            </select>
          )}
        </Field>
        <Field label="ネットワークタグ" hint="カンマ区切り（例: http-server,https-server）">
          {(id) => (
            <input
              id={id}
              className={inputClass}
              value={form.tags}
              onChange={(e) => set("tags", e.target.value)}
            />
          )}
        </Field>
        <Field label="外部 IP">
          {(id) => (
            <select
              id={id}
              className={inputClass}
              value={form.externalIp ? "ephemeral" : "none"}
              onChange={(e) => set("externalIp", e.target.value === "ephemeral")}
            >
              <option value="ephemeral">エフェメラル</option>
              <option value="none">なし</option>
            </select>
          )}
        </Field>
      </div>
      <EquivalentCommandPanel command={command} onCopy={actions.copy} onInsert={actions.insert} />
      <div className="mt-4 flex gap-2">
        <PrimaryButton onClick={create}>作成</PrimaryButton>
        <SecondaryButton onClick={() => actions.changeScreen(ConsoleScreens.VmList)}>
          キャンセル
        </SecondaryButton>
      </div>
    </div>
  );
};
