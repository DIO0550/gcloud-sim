import { type ReactElement, useState } from "react";

import { MachineType, PublicImage, Zone } from "@/engine/domains/catalog";
import {
  BootDiskType,
  BootDiskTypes,
  ExternalIp,
  type Instance,
  Instance as InstanceOps,
  ProvisioningModel,
  ProvisioningModels,
} from "@/engine/domains/compute";
import { GcloudConfig } from "@/engine/domains/gcloud-config";
import { ServiceAccount } from "@/engine/domains/service-account";
import { World } from "@/engine/domains/world";
import {
  EquivalentCommandPanel,
  Field,
  InputClass,
  PrimaryButton,
  ResourceTable,
  ScreenTitle,
  SecondaryButton,
} from "@/features/simulator/features/console/components/ConsoleParts";
import { ConsoleScreens } from "@/features/simulator/features/console/domains/console-screen";
import {
  type VmAction,
  VmAction as VmActionOps,
  VmCreateForm,
} from "@/features/simulator/features/console/domains/equivalent-command";
import { useCreateForm } from "@/features/simulator/features/console/hooks/use-create-form";
import type { ScreenProps } from "@/features/simulator/features/console/types/screen-props";
import { Option } from "@/utils/Option";

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

const StatusDot = ({ instance }: Readonly<{ instance: Instance }>): ReactElement => (
  <span className="flex items-center gap-1.5">
    <span
      role="img"
      aria-label={instance.status}
      className={`inline-block h-2 w-2 rounded-full ${InstanceOps.isRunning(instance) ? "bg-ok" : "bg-line"}`}
    />
    <span className="text-xs">{instance.status}</span>
  </span>
);

/** Compute Engine › VM インスタンス（UI 案 2b）。選んだ VM に対する操作は CLI のコマンドとして流す。 */
export const VmListScreen = ({ world, project, handlers }: ScreenProps): ReactElement => {
  const [selectedName, setSelectedName] = useState<Option<string>>(Option.none);
  const instances = World.instancesOf(world, project.projectId);
  const selected = Option.flatMap(selectedName, (name) =>
    Option.fromNullable(instances.find((i) => i.name === name)),
  );
  const perform = (action: VmAction, instance: Instance): void => {
    const isDelete = action === "delete";
    if (isDelete && !handlers.confirm(`${instance.name} を削除しますか？`)) return;
    handlers.submit({
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
        trailing={
          <PrimaryButton onClick={() => handlers.changeScreen(ConsoleScreens.VmCreate)}>
            インスタンスを作成
          </PrimaryButton>
        }
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
      <ResourceTable
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
          { header: "状態", cell: (i) => <StatusDot instance={i} /> },
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
export const VmCreateScreen = ({ world, project, handlers }: ScreenProps): ReactElement => {
  const projectId = project.projectId;
  const defaultAccount = ServiceAccount.defaultComputeEmail(project.projectNumber);
  const editor = useCreateForm(
    VmCreateForm,
    () => VmCreateForm.create({ zone: zoneOf(world), serviceAccount: defaultAccount }),
    true,
  );
  if (!Option.isSome(editor.form)) return <span className="hidden" />;
  const form = editor.form.value;
  const { set, errors } = editor;
  const command = VmCreateForm.toCommand(form, projectId);
  const accounts = [
    defaultAccount,
    ...World.serviceAccountsOf(world, projectId).map((s) => s.email),
  ];
  const images = PublicImage.all();
  const create = (): void => {
    const valid = editor.submit();
    if (!Option.isSome(valid)) return;
    handlers.submit({
      line: command,
      note: `インスタンスを作成 (${valid.value.name})`,
      next: Option.some(ConsoleScreens.VmList),
    });
  };
  /** 選択肢に無い値は無視して今の値を保つ（select は選択肢しか出さないので、届くのは選択肢だけ）。 */
  const setParsed = <K extends keyof VmCreateForm>(
    key: K,
    parsed: Option<VmCreateForm[K]>,
  ): void => {
    if (Option.isSome(parsed)) set(key, parsed.value);
  };
  return (
    <div>
      <ScreenTitle eyebrow="Compute Engine › VM インスタンス" title="インスタンスを作成" />
      <div className="grid max-w-3xl grid-cols-2 gap-4">
        <Field label="名前" error={errors.name}>
          {(id) => (
            <input
              id={id}
              className={InputClass}
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
            />
          )}
        </Field>
        <Field label="ゾーン" hint={`リージョン: ${Zone.region(form.zone)}`}>
          {(id) => (
            <select
              id={id}
              className={InputClass}
              value={form.zone}
              onChange={(e) => setParsed("zone", Zone.parse(e.target.value))}
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
              className={InputClass}
              value={form.machineType}
              onChange={(e) =>
                setParsed(
                  "machineType",
                  Option.map(MachineType.parse(e.target.value), (m) => m.name),
                )
              }
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
              className={InputClass}
              value={form.provisioningModel}
              onChange={(e) =>
                setParsed("provisioningModel", ProvisioningModel.parse(e.target.value))
              }
            >
              {Object.values(ProvisioningModels).map((m) => (
                <option key={m} value={m}>
                  {m === ProvisioningModels.Spot ? "Spot" : "標準"}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="ブートディスク: イメージ">
          {(id) => (
            <select
              id={id}
              className={InputClass}
              value={`${form.imageProject}/${form.imageFamily}`}
              onChange={(e) => {
                const image = images.find((i) => `${i.project}/${i.family}` === e.target.value);
                if (image !== undefined) {
                  set("imageFamily", image.family);
                  set("imageProject", image.project);
                }
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
                className={InputClass}
                value={form.bootDiskSize}
                onChange={(e) => set("bootDiskSize", e.target.value)}
              />
            )}
          </Field>
          <Field label="種類">
            {(id) => (
              <select
                id={id}
                className={InputClass}
                value={form.bootDiskType}
                onChange={(e) => setParsed("bootDiskType", BootDiskType.parse(e.target.value))}
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
        <Field label="サービス アカウント">
          {(id) => (
            <select
              id={id}
              className={InputClass}
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
        <Field label="アクセス スコープ">
          {(id) => (
            <select
              id={id}
              className={InputClass}
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
        <Field label="ネットワーク タグ" hint="カンマ区切り（例: http-server,https-server）">
          {(id) => (
            <input
              id={id}
              className={InputClass}
              value={form.tags}
              onChange={(e) => set("tags", e.target.value)}
            />
          )}
        </Field>
        <Field label="外部 IP">
          {(id) => (
            <select
              id={id}
              className={InputClass}
              value={form.externalIp ? "ephemeral" : "none"}
              onChange={(e) => set("externalIp", e.target.value === "ephemeral")}
            >
              <option value="ephemeral">エフェメラル</option>
              <option value="none">なし</option>
            </select>
          )}
        </Field>
      </div>
      <EquivalentCommandPanel command={command} onCopy={handlers.copy} onInsert={handlers.insert} />
      <div className="mt-4 flex gap-2">
        <PrimaryButton onClick={create}>作成</PrimaryButton>
        <SecondaryButton onClick={() => handlers.changeScreen(ConsoleScreens.VmList)}>
          キャンセル
        </SecondaryButton>
      </div>
    </div>
  );
};
