import { type ReactElement, useState } from "react";
import { Checkbox } from "@/components/Checkbox";
import { GhostButton } from "@/components/GhostButton";
import { Select } from "@/components/Select";
import { MachineType, PublicImage } from "@/engine/domains/catalog";
import { BootDiskTypes, ProvisioningModels } from "@/engine/domains/compute";
import { ServiceAccount } from "@/engine/domains/service-account";
import { World } from "@/engine/domains/world";
import {
  diskTypeText,
  machineTypeText,
  NameRuleText,
  seriesOf,
  seriesRange,
  TagInput,
} from "@/features/simulator/features/console/components/ComputeScreens";
import {
  CreatePage,
  Field,
  PrimaryButton,
  RadioGroup,
  SecondaryButton,
  TextInput,
} from "@/features/simulator/features/console/components/ConsoleParts";
import { ConsoleScreens } from "@/features/simulator/features/console/domains/console-screen";
import {
  FieldErrors,
  InstanceTemplateCreateForm,
  type MetadataEntry,
  type TemplateImageKind,
} from "@/features/simulator/features/console/domains/equivalent-command";
import { useCreateForm } from "@/features/simulator/features/console/hooks/use-create-form";
import type { ScreenProps } from "@/features/simulator/features/console/types/screen-props";
import { Option } from "@/utils/Option";
import { StringEx } from "@/utils/StringEx";

const toggleTag = (raw: string, tag: string, checked: boolean): string => {
  const list = StringEx.splitList(raw);
  const next = checked
    ? list.includes(tag)
      ? list
      : [...list, tag]
    : list.filter((t) => t !== tag);
  return next.join(",");
};

/** Compute Engine › インスタンス テンプレートを作成。VM 作成と同じフルページ構成でグローバル テンプレートを組む。 */
export const InstanceTemplateCreateScreen = ({
  world,
  project,
  handlers,
  navigationOpen = true,
}: ScreenProps): ReactElement => {
  const projectId = project.projectId;
  const defaultAccount = ServiceAccount.defaultComputeEmail(project.projectNumber);
  const [activeSection, setActiveSection] = useState("machine");
  const editor = useCreateForm(
    InstanceTemplateCreateForm,
    () => InstanceTemplateCreateForm.create({ serviceAccount: defaultAccount }),
    true,
  );
  if (!Option.isSome(editor.form)) return <span className="hidden" />;
  const form = editor.form.value;
  const { set } = editor;

  const customImages = world.computeLab.images.filter((img) => img.projectId === projectId);
  const publicImages = PublicImage.all();
  const networks = World.networksOf(world, projectId);
  const subnetChoices = World.subnetsOf(world, projectId).filter((s) => s.network === form.network);
  const normalizedSubnet = subnetChoices.some((s) => s.name === form.subnet) ? form.subnet : "";
  const effectiveForm: InstanceTemplateCreateForm = {
    ...form,
    subnet: normalizedSubnet,
    customImage:
      form.imageKind === "custom"
        ? form.customImage || (customImages[0]?.name ?? "")
        : form.customImage,
  };

  const live = InstanceTemplateCreateForm.collectErrors(effectiveForm);
  const errors = {
    ...editor.errors,
    ...(effectiveForm.name !== "" && live.name !== undefined ? { name: NameRuleText } : {}),
    ...(live.bootDiskSize !== undefined ? { bootDiskSize: live.bootDiskSize } : {}),
    ...(live.startupScript !== undefined ? { startupScript: live.startupScript } : {}),
    ...(live.metadata !== undefined ? { metadata: live.metadata } : {}),
    ...(effectiveForm.imageKind === "custom" && live.customImage !== undefined
      ? { customImage: live.customImage }
      : {}),
  };
  const canCreate = FieldErrors.isEmpty(live);
  const parts = InstanceTemplateCreateForm.toParts(effectiveForm, projectId);

  const accounts = [
    defaultAccount,
    ...World.serviceAccountsOf(world, projectId).map((s) => s.email),
  ];
  const series = seriesOf(effectiveForm.machineType);
  const allSeries = [...new Set(MachineType.all().map((m) => seriesOf(m.name)))];
  const tagList = StringEx.splitList(effectiveForm.tags);
  const hasHttp = tagList.includes("http-server");
  const hasHttps = tagList.includes("https-server");
  const metadataCount =
    (effectiveForm.startupScript.trim() !== "" ? 1 : 0) +
    effectiveForm.metadata.filter((m) => m.key.trim() !== "").length;
  const imageLabel =
    effectiveForm.imageKind === "custom"
      ? effectiveForm.customImage || "（未選択）"
      : effectiveForm.imageFamily;

  const updateMetadataRow = (index: number, patch: Partial<MetadataEntry>): void => {
    set(
      "metadata",
      form.metadata.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  };

  const removeMetadataRow = (index: number): void => {
    set(
      "metadata",
      form.metadata.filter((_, i) => i !== index),
    );
  };

  const addMetadataRow = (): void => {
    set("metadata", [...form.metadata, { key: "", value: "" }]);
  };

  const create = (): void => {
    if (!canCreate) {
      editor.submit();
      return;
    }
    handlers.submit({
      line: InstanceTemplateCreateForm.toCommand(effectiveForm, projectId),
      note: `インスタンス テンプレートを作成 (${effectiveForm.name})`,
      next: Option.some(ConsoleScreens.InstanceTemplates),
    });
  };

  return (
    <CreatePage
      header={
        <>
          <GhostButton
            ariaLabel="インスタンス テンプレートに戻る"
            onClick={() => handlers.changeScreen(ConsoleScreens.InstanceTemplates)}
          >
            ←
          </GhostButton>
          <div>
            <p className="text-[11px] text-muted leading-tight">Compute Engine</p>
            <h2 className="font-normal text-ink text-xl leading-snug">
              インスタンス テンプレートを作成
            </h2>
          </div>
        </>
      }
      navigationLabel="インスタンス テンプレート作成の設定"
      navigationOpen={navigationOpen}
      navigation={[
        { id: "machine", title: "マシンの構成", detail: effectiveForm.machineType },
        {
          id: "storage",
          title: "OS とストレージ",
          detail: `${imageLabel} · ${effectiveForm.bootDiskSize}`,
        },
        {
          id: "network",
          title: "ネットワーキング",
          detail:
            effectiveForm.tags === ""
              ? effectiveForm.network
              : `${effectiveForm.network} · ${effectiveForm.tags}`,
        },
        { id: "security", title: "セキュリティ", detail: "サービスアカウント、スコープ" },
        {
          id: "advanced",
          title: "管理・詳細設定",
          detail:
            metadataCount > 0
              ? `${effectiveForm.provisioningModel} · メタデータ ${metadataCount} 件`
              : effectiveForm.provisioningModel,
        },
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
          <h3 className="mb-4 font-medium text-lg text-ink">テンプレート構成の概要</h3>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted">ロケーション</dt>
            <dd>グローバル</dd>
            <dt className="text-muted">マシンタイプ</dt>
            <dd className="font-mono">{effectiveForm.machineType}</dd>
            <dt className="text-muted">ブートディスク</dt>
            <dd>
              {imageLabel} · {effectiveForm.bootDiskSize.replace(/GB$/, " GB")}
            </dd>
            <dt className="text-muted">ネットワーク</dt>
            <dd className="font-mono">
              {effectiveForm.network}
              {effectiveForm.subnet !== "" ? ` / ${effectiveForm.subnet}` : ""}
            </dd>
            <dt className="text-muted">プロビジョニング</dt>
            <dd>{effectiveForm.provisioningModel === "SPOT" ? "Spot" : "標準"}</dd>
            <dt className="text-muted">メタデータ</dt>
            <dd>{metadataCount === 0 ? "なし" : `${metadataCount} 件`}</dd>
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
          <SecondaryButton onClick={() => handlers.changeScreen(ConsoleScreens.InstanceTemplates)}>
            キャンセル
          </SecondaryButton>
          {!canCreate && effectiveForm.name === "" && (
            <span className="self-center text-muted text-xs">名前を入力すると作成できます</span>
          )}
        </>
      }
      note={
        <>
          <span className="mr-2 font-bold">試験メモ</span>
          インスタンス テンプレートは<strong>不変（イミュータブル）</strong>なグローバル
          リソースです。作成後に変更できないため、MIG
          を更新する際は新しいテンプレートを作成してローリング アップデートします。
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <Field label="名前" required outlined error={errors.name}>
            {(id) => (
              <TextInput
                id={id}
                variant="outlined"
                invalid={errors.name !== undefined}
                placeholder="web-template-v1"
                value={effectiveForm.name}
                onChange={(v) => set("name", v)}
              />
            )}
          </Field>
          <div className="rounded border border-line bg-canvas px-3.5 py-2.5">
            <p className="font-medium text-ink text-xs">ロケーション: グローバル</p>
            <p className="mt-0.5 text-muted text-xs leading-snug">
              ゾーン・リージョンに縛られず、各リージョンの MIG から再利用できます。
            </p>
          </div>
        </div>

        {activeSection === "machine" && (
          <section>
            <h3 className="mb-4 font-medium text-lg text-ink">マシンの構成</h3>
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
                              name="template-machine-series"
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
                    value={effectiveForm.machineType}
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

        {activeSection === "storage" && (
          <section className="flex flex-col gap-5">
            <div>
              <h3 className="mb-1 font-medium text-lg text-ink">OS とストレージ</h3>
              <p className="text-muted text-sm">
                {imageLabel} · {effectiveForm.bootDiskSize.replace(/GB$/, " GB")} ·{" "}
                {diskTypeText(effectiveForm.bootDiskType)}
              </p>
            </div>
            <RadioGroup<TemplateImageKind>
              label="イメージ ソース"
              name="template-image-kind"
              inline
              value={effectiveForm.imageKind}
              onChange={(kind) => {
                set("imageKind", kind);
                if (kind === "custom" && form.customImage === "" && customImages[0] !== undefined) {
                  set("customImage", customImages[0].name);
                }
              }}
              options={[
                { value: "public", label: "パブリック イメージ" },
                { value: "custom", label: `カスタム イメージ（${customImages.length} 件）` },
              ]}
            />
            <div className="grid grid-cols-1 gap-4 rounded border border-line bg-surface p-4 xl:grid-cols-[2fr_1fr_1fr]">
              {effectiveForm.imageKind === "public" ? (
                <Field label="パブリック イメージ">
                  {(id) => (
                    <Select
                      id={id}
                      value={`${effectiveForm.imageProject}/${effectiveForm.imageFamily}`}
                      onChange={(value) => {
                        const image = publicImages.find(
                          (i) => `${i.project}/${i.family}` === value,
                        );
                        if (image !== undefined) {
                          set("imageFamily", image.family);
                          set("imageProject", image.project);
                        }
                      }}
                      options={publicImages.map((i) => ({
                        value: `${i.project}/${i.family}`,
                        label: `${i.family}（${i.project}）`,
                      }))}
                    />
                  )}
                </Field>
              ) : (
                <Field
                  label="カスタム イメージ"
                  required
                  error={errors.customImage}
                  hint={
                    customImages.length === 0
                      ? "Compute Engine › イメージ からカスタム イメージを作成すると選べます"
                      : undefined
                  }
                >
                  {(id) => (
                    <Select
                      id={id}
                      value={effectiveForm.customImage}
                      onChange={(v) => set("customImage", v)}
                      options={
                        customImages.length > 0
                          ? customImages.map((i) => ({
                              value: i.name,
                              label: i.family ? `${i.name} (family: ${i.family})` : i.name,
                            }))
                          : [{ value: "", label: "（カスタム イメージがありません）" }]
                      }
                    />
                  )}
                </Field>
              )}
              <Field label="サイズ" error={errors.bootDiskSize}>
                {(id) => (
                  <TextInput
                    id={id}
                    invalid={errors.bootDiskSize !== undefined}
                    value={effectiveForm.bootDiskSize}
                    onChange={(v) => set("bootDiskSize", v)}
                  />
                )}
              </Field>
              <Field label="種類">
                {(id) => (
                  <Select
                    id={id}
                    value={effectiveForm.bootDiskType}
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

        {activeSection === "network" && (
          <section className="flex flex-col gap-5">
            <h3 className="font-medium text-lg text-ink">ネットワーキング</h3>
            <fieldset className="rounded border border-line bg-canvas p-4">
              <legend className="px-1 font-medium text-ink text-xs">ファイアウォール</legend>
              <div className="mt-1 flex flex-col gap-2">
                <Checkbox
                  checked={hasHttp}
                  onChange={(checked) => set("tags", toggleTag(form.tags, "http-server", checked))}
                >
                  HTTP トラフィックを許可する（
                  <span className="font-mono text-xs">http-server</span> タグ）
                </Checkbox>
                <Checkbox
                  checked={hasHttps}
                  onChange={(checked) => set("tags", toggleTag(form.tags, "https-server", checked))}
                >
                  HTTPS トラフィックを許可する（
                  <span className="font-mono text-xs">https-server</span> タグ）
                </Checkbox>
              </div>
            </fieldset>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="ネットワーク">
                {(id) => (
                  <Select
                    id={id}
                    variant="outlined"
                    value={effectiveForm.network}
                    onChange={(network) => {
                      set("network", network);
                      set("subnet", "");
                    }}
                    options={
                      networks.length > 0
                        ? networks.map((n) => ({ value: n.name, label: n.name }))
                        : [{ value: "default", label: "default" }]
                    }
                  />
                )}
              </Field>
              <Field
                label="サブネットワーク"
                hint="省略すると MIG 作成時のリージョンに合わせて自動解決されます"
              >
                {(id) => (
                  <Select
                    id={id}
                    variant="outlined"
                    value={effectiveForm.subnet}
                    onChange={(subnet) => set("subnet", subnet)}
                    options={[
                      { value: "", label: "指定なし（自動）" },
                      ...subnetChoices.map((s) => ({
                        value: s.name,
                        label: `${s.name}（${s.region} · ${s.ipCidrRange}）`,
                      })),
                    ]}
                  />
                )}
              </Field>
            </div>
            <Field label="ネットワーク タグ">
              {(id) => (
                <TagInput
                  id={id}
                  value={effectiveForm.tags}
                  onChange={(tags) => set("tags", tags)}
                />
              )}
            </Field>
            <RadioGroup
              label="外部 IP"
              name="template-external-ip"
              inline
              value={effectiveForm.externalIp ? "ephemeral" : "none"}
              onChange={(v) => set("externalIp", v === "ephemeral")}
              options={[
                { value: "ephemeral", label: "エフェメラル" },
                { value: "none", label: "なし（--no-address）" },
              ]}
            />
          </section>
        )}

        {activeSection === "security" && (
          <section className="flex flex-col gap-5">
            <h3 className="font-medium text-lg text-ink">セキュリティ</h3>
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              <Field label="サービスアカウント" outlined>
                {(id) => (
                  <Select
                    id={id}
                    variant="outlined"
                    value={effectiveForm.serviceAccount}
                    onChange={(account) => set("serviceAccount", account)}
                    options={accounts.map((a) => ({ value: a, label: a }))}
                  />
                )}
              </Field>
              <RadioGroup
                label="アクセス スコープ"
                name="template-scopes"
                value={effectiveForm.scopes}
                onChange={(scopes) => set("scopes", scopes)}
                options={[
                  { value: "default", label: "デフォルトのアクセス権を許可" },
                  { value: "cloud-platform", label: "すべての Cloud API に完全アクセス権を許可" },
                ]}
              />
            </div>
          </section>
        )}

        {activeSection === "advanced" && (
          <section className="flex flex-col gap-6">
            <h3 className="font-medium text-lg text-ink">管理・詳細設定</h3>
            <RadioGroup
              label="プロビジョニング モデル"
              name="template-provisioning-model"
              inline
              value={effectiveForm.provisioningModel}
              onChange={(model) => set("provisioningModel", model)}
              options={[
                { value: ProvisioningModels.Standard, label: "標準 (STANDARD)" },
                { value: ProvisioningModels.Spot, label: "Spot (SPOT)" },
              ]}
            />
            <div className="rounded border border-line bg-canvas p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-medium text-ink text-sm">自動化（起動スクリプト）</h4>
                <SecondaryButton
                  onClick={() =>
                    set("startupScript", "#!/bin/bash; apt-get update && apt-get install -y nginx")
                  }
                >
                  サンプルを入力
                </SecondaryButton>
              </div>
              <Field
                label="起動スクリプト (startup-script)"
                error={errors.startupScript}
                hint="VM 起動時に自動実行するコマンド（--metadata=startup-script=... として設定されます）"
              >
                {(id) => (
                  <TextInput
                    id={id}
                    invalid={errors.startupScript !== undefined}
                    placeholder="#!/bin/bash; apt-get update && apt-get install -y nginx"
                    value={effectiveForm.startupScript}
                    onChange={(v) => set("startupScript", v)}
                  />
                )}
              </Field>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <h4 className="font-medium text-ink text-sm">メタデータ</h4>
                  <p className="text-muted text-xs">
                    任意のキーと値（例: enable-oslogin = TRUE、env = prod）
                  </p>
                </div>
                <SecondaryButton onClick={addMetadataRow}>＋ 項目を追加</SecondaryButton>
              </div>
              {errors.metadata !== undefined && (
                <p role="alert" className="mb-2 text-danger text-xs">
                  {errors.metadata}
                </p>
              )}
              {effectiveForm.metadata.length > 0 && (
                <div className="flex flex-col gap-2">
                  {effectiveForm.metadata.map((entry, index) => (
                    <div
                      key={`meta-${index.toString()}`}
                      className="grid grid-cols-1 gap-2 rounded border border-line bg-surface p-2.5 sm:grid-cols-[1fr_1fr_auto]"
                    >
                      <TextInput
                        ariaLabel={`メタデータ キー ${index + 1}`}
                        placeholder="キー（例: env）"
                        value={entry.key}
                        onChange={(key) => updateMetadataRow(index, { key })}
                      />
                      <TextInput
                        ariaLabel={`メタデータ 値 ${index + 1}`}
                        placeholder="値（例: prod）"
                        value={entry.value}
                        onChange={(value) => updateMetadataRow(index, { value })}
                      />
                      <SecondaryButton
                        ariaLabel={`メタデータ ${index + 1} を削除`}
                        onClick={() => removeMetadataRow(index)}
                      >
                        削除
                      </SecondaryButton>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </CreatePage>
  );
};
