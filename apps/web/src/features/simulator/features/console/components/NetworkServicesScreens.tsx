import { type ReactElement, useEffect, useState } from "react";

import { Checkbox } from "@/components/Checkbox";
import { Select } from "@/components/Select";
import { Region, Regions, Zone } from "@/engine/domains/catalog";
import { GcloudConfig } from "@/engine/domains/gcloud-config";
import { World } from "@/engine/domains/world";
import {
  ConsoleStatus,
  CreateFormSection,
  Field,
  PrimaryButton,
  ResourceTable,
  ScreenTitle,
  SecondaryButton,
  TextInput,
} from "@/features/simulator/features/console/components/ConsoleParts";
import {
  CloudNatCreateForm,
  CloudRouterCreateForm,
  DeleteCommand,
  type NatMappingMode,
} from "@/features/simulator/features/console/domains/equivalent-command";
import { useCreateForm } from "@/features/simulator/features/console/hooks/use-create-form";
import type { ScreenProps } from "@/features/simulator/features/console/types/screen-props";
import { Option } from "@/utils/Option";

const CREATE_NEW_ROUTER = "__create_new_router__";

const resolveDefaultRegion = (world: World): Region =>
  Option.unwrapOr(
    Option.flatMap(GcloudConfig.get(world.config, "compute/region"), Region.parse),
    Option.unwrapOr(
      Option.map(
        Option.flatMap(GcloudConfig.get(world.config, "compute/zone"), Zone.parse),
        Zone.region,
      ),
      "us-central1",
    ),
  );

const mappingModeText = (mode: NatMappingMode): string => {
  switch (mode) {
    case "all":
      return "すべてのサブネットのプライマリ IP 範囲とセカンダリ IP 範囲";
    case "custom":
      return "カスタム（指定したサブネットのみ）";
  }
};

const readOnlyClass =
  "w-full rounded border border-line bg-canvas px-2.5 py-1.5 font-mono text-muted text-xs";

/** ネットワーク サービス › Cloud NAT: 一覧・作成（インラインの Cloud Router 作成を含む）・削除。 */
export const CloudNatScreen = ({
  world,
  project,
  handlers,
  outcome,
}: ScreenProps): ReactElement => {
  const projectId = project.projectId;
  const networks = World.networksOf(world, projectId);
  const routers = world.routers.filter((r) => r.projectId === projectId);
  const nats = world.networkLab.nats.filter((n) => n.projectId === projectId);
  const subnets = World.subnetsOf(world, projectId);
  const defaultRegion = resolveDefaultRegion(world);
  const defaultNetwork = networks[0]?.name ?? "default";

  const seed = (): CloudNatCreateForm => {
    const matchingRouter = routers.find(
      (r) => r.network === defaultNetwork && r.region === defaultRegion,
    );
    return CloudNatCreateForm.create({
      network: defaultNetwork,
      region: defaultRegion,
      router: matchingRouter?.name ?? "",
    });
  };
  const editor = useCreateForm(CloudNatCreateForm, seed, false, outcome);
  const form = Option.unwrapOr(editor.form, seed());

  const routerSeed = (): CloudRouterCreateForm =>
    CloudRouterCreateForm.create({ network: form.network, region: form.region });
  const routerEditor = useCreateForm(CloudRouterCreateForm, routerSeed, false, outcome);
  const routerForm = Option.unwrapOr(routerEditor.form, routerSeed());

  const [pendingRouter, setPendingRouter] = useState<
    Readonly<{ afterId: number; name: string }> | undefined
  >(undefined);
  const currentOutcomeId = outcome !== undefined && Option.isSome(outcome) ? outcome.value.id : 0;

  useEffect(() => {
    if (pendingRouter === undefined || outcome === undefined || !Option.isSome(outcome)) return;
    if (outcome.value.id === pendingRouter.afterId) return;
    if (outcome.value.outcome.kind === "succeeded") {
      editor.set("router", pendingRouter.name);
    }
    setPendingRouter(undefined);
  }, [pendingRouter, outcome, editor]);

  const matchingRouters = routers.filter(
    (r) => r.network === form.network && r.region === form.region,
  );
  const matchingSubnets = subnets.filter(
    (s) => s.network === form.network && s.region === form.region,
  );

  const openCreate = (): void => {
    routerEditor.close();
    editor.open();
  };

  const closeCreate = (): void => {
    routerEditor.close();
    editor.close();
  };

  const changeNetwork = (network: string): void => {
    editor.set("network", network);
    const nextRouter = routers.find((r) => r.network === network && r.region === form.region);
    editor.set("router", nextRouter?.name ?? "");
    editor.set("subnets", []);
    if (Option.isSome(routerEditor.form)) {
      routerEditor.set("network", network);
    }
  };

  const changeRegion = (region: Region): void => {
    editor.set("region", region);
    const nextRouter = routers.find((r) => r.network === form.network && r.region === region);
    editor.set("router", nextRouter?.name ?? "");
    editor.set("subnets", []);
    if (Option.isSome(routerEditor.form)) {
      routerEditor.set("region", region);
    }
  };

  const changeRouter = (value: string): void => {
    if (value === CREATE_NEW_ROUTER) {
      routerEditor.openWith(
        CloudRouterCreateForm.create({ network: form.network, region: form.region }),
      );
      return;
    }
    routerEditor.close();
    editor.set("router", value);
  };

  const createInlineRouter = (): void => {
    const valid = routerEditor.submit();
    if (!Option.isSome(valid)) return;
    setPendingRouter({ afterId: currentOutcomeId, name: valid.value.name });
    handlers.submit({
      line: CloudRouterCreateForm.toCommand(valid.value, projectId),
      note: `Cloud Router を作成 (${valid.value.name})`,
      next: Option.none,
    });
    routerEditor.awaitClose();
  };

  const toggleSubnet = (subnetName: string, checked: boolean): void => {
    const next = checked
      ? [...form.subnets, subnetName]
      : form.subnets.filter((s) => s !== subnetName);
    editor.set("subnets", next);
  };

  const create = (): void => {
    const valid = editor.submit();
    if (!Option.isSome(valid)) return;
    handlers.submit({
      line: CloudNatCreateForm.toCommand(valid.value, projectId),
      note: `Cloud NAT ゲートウェイを作成 (${valid.value.name})`,
      next: Option.none,
    });
    editor.awaitClose();
  };

  const remove = (nat: (typeof nats)[number]): void => {
    if (!handlers.confirm(`Cloud NAT ゲートウェイ ${nat.name} を削除しますか？`)) return;
    handlers.submit({
      line: DeleteCommand.nat(nat, projectId),
      note: `Cloud NAT ゲートウェイを削除 (${nat.name})`,
      next: Option.none,
    });
  };

  const routerOptions = [
    ...(form.router === "" ? [{ value: "", label: "Cloud Router を選択" }] : []),
    ...matchingRouters.map((r) => ({ value: r.name, label: r.name })),
    ...(form.router !== "" && !matchingRouters.some((r) => r.name === form.router)
      ? [{ value: form.router, label: form.router }]
      : []),
    { value: CREATE_NEW_ROUTER, label: "新しいルーターを作成" },
  ];

  const networkOfNat = (nat: (typeof nats)[number]): string =>
    routers.find((r) => r.region === nat.region && r.name === nat.router)?.network ?? "-";

  return (
    <div>
      <ScreenTitle
        eyebrow="ネットワーク サービス"
        title="Cloud NAT"
        trailing={
          <PrimaryButton onClick={openCreate}>
            {nats.length === 0 ? "開始" : "Cloud NAT ゲートウェイを作成"}
          </PrimaryButton>
        }
      />
      {Option.isSome(editor.form) && (
        <CreateFormSection
          label="Cloud NAT ゲートウェイの作成"
          columns={2}
          command={CloudNatCreateForm.toCommand(form, projectId)}
          onCopy={handlers.copy}
          onInsert={() => handlers.insert(CloudNatCreateForm.toCommand(form, projectId))}
          onSubmit={create}
          onCancel={closeCreate}
          submitLabel="作成"
        >
          <Field label="ゲートウェイの名前" required error={editor.errors.name}>
            {(id) => (
              <TextInput
                id={id}
                value={form.name}
                placeholder="nat-config"
                onChange={(v) => editor.set("name", v)}
              />
            )}
          </Field>
          <Field label="ネットワーク" required error={editor.errors.network}>
            {(id) => (
              <Select
                id={id}
                value={form.network}
                onChange={changeNetwork}
                options={networks.map((n) => ({ value: n.name, label: n.name }))}
              />
            )}
          </Field>
          <Field label="リージョン" required>
            {(id) => (
              <Select<Region>
                id={id}
                value={form.region}
                onChange={changeRegion}
                options={Object.values(Regions).map((r) => ({ value: r, label: r }))}
              />
            )}
          </Field>
          <Field
            label="Cloud Router"
            required
            error={editor.errors.router}
            hint={
              matchingRouters.length === 0
                ? "選択したネットワークとリージョンに Cloud Router がありません。「新しいルーターを作成」を選んで作成できます。"
                : undefined
            }
          >
            {(id) => (
              <Select
                id={id}
                value={Option.isSome(routerEditor.form) ? CREATE_NEW_ROUTER : form.router}
                onChange={changeRouter}
                options={routerOptions}
              />
            )}
          </Field>
          {Option.isSome(routerEditor.form) && (
            <section
              aria-label="ルーターの作成"
              className="rounded border border-accent/40 bg-canvas p-4 sm:col-span-2"
            >
              <h4 className="mb-3 font-medium text-ink text-sm">ルーターの作成</h4>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="名前" required error={routerEditor.errors.name}>
                  {(id) => (
                    <TextInput
                      id={id}
                      value={routerForm.name}
                      placeholder="nat-router"
                      onChange={(v) => routerEditor.set("name", v)}
                    />
                  )}
                </Field>
                <Field
                  label="Google ASN"
                  error={routerEditor.errors.asn}
                  hint="空欄の場合は既定の 64512 が使われます"
                >
                  {(id) => (
                    <TextInput
                      id={id}
                      value={routerForm.asn}
                      placeholder="64512"
                      onChange={(v) => routerEditor.set("asn", v)}
                    />
                  )}
                </Field>
                <div>
                  <span className="mb-1.5 block font-medium text-ink text-xs">ネットワーク</span>
                  <div className={readOnlyClass}>{routerForm.network}</div>
                </div>
                <div>
                  <span className="mb-1.5 block font-medium text-ink text-xs">リージョン</span>
                  <div className={readOnlyClass}>{routerForm.region}</div>
                </div>
              </div>
              <p className="mt-3 break-all rounded border border-line bg-surface px-2.5 py-1.5 font-mono text-[11px] text-muted">
                {CloudRouterCreateForm.toCommand(routerForm, projectId)}
              </p>
              <div className="mt-3 flex gap-2">
                <PrimaryButton onClick={createInlineRouter}>作成</PrimaryButton>
                <SecondaryButton onClick={routerEditor.close}>キャンセル</SecondaryButton>
              </div>
            </section>
          )}
          <Field label="Cloud NAT マッピング（ソース範囲）">
            {(id) => (
              <Select<NatMappingMode>
                id={id}
                value={form.mappingMode}
                onChange={(mode) => {
                  editor.set("mappingMode", mode);
                  if (mode === "all") editor.set("subnets", []);
                }}
                options={(["all", "custom"] as const).map((m) => ({
                  value: m,
                  label: mappingModeText(m),
                }))}
              />
            )}
          </Field>
          <div>
            <span className="mb-1.5 block font-medium text-ink text-xs">Cloud NAT IP アドレス</span>
            <div className={readOnlyClass}>自動（推奨）</div>
          </div>
          {form.mappingMode === "custom" && (
            <div className="sm:col-span-2">
              <span className="mb-1.5 block font-medium text-ink text-xs">対象のサブネット</span>
              {matchingSubnets.length === 0 ? (
                <p className="text-muted text-xs">
                  選択したネットワーク（{form.network}）とリージョン（{form.region}
                  ）にサブネットがありません。
                </p>
              ) : (
                <div className="flex flex-wrap gap-3 rounded border border-line bg-canvas p-3">
                  {matchingSubnets.map((subnet) => (
                    <Checkbox
                      key={subnet.name}
                      checked={form.subnets.includes(subnet.name)}
                      onChange={(checked) => toggleSubnet(subnet.name, checked)}
                    >
                      {subnet.name} ({subnet.ipCidrRange})
                    </Checkbox>
                  ))}
                </div>
              )}
              {editor.errors.subnets !== undefined && (
                <p role="alert" className="mt-1 text-danger text-xs">
                  {editor.errors.subnets}
                </p>
              )}
            </div>
          )}
          <div className="sm:col-span-2">
            <Checkbox
              checked={form.enableLogging}
              onChange={(checked) => editor.set("enableLogging", checked)}
            >
              Cloud NAT ロギングを有効にする
            </Checkbox>
          </div>
        </CreateFormSection>
      )}
      <ResourceTable
        label="Cloud NAT ゲートウェイ"
        rows={nats}
        keyOf={(n) => `${n.region}/${n.router}/${n.name}`}
        nameOf={(n) => n.name}
        empty="Cloud NAT ゲートウェイがありません。「開始」をクリックして NAT ゲートウェイを構成できます。"
        onDelete={remove}
        columns={[
          { header: "ゲートウェイ名", cell: (n) => <span className="font-mono">{n.name}</span> },
          { header: "ステータス", cell: () => <ConsoleStatus status="RUNNING" /> },
          {
            header: "ネットワーク",
            cell: (n) => <span className="font-mono">{networkOfNat(n)}</span>,
          },
          { header: "リージョン", cell: (n) => <span className="font-mono">{n.region}</span> },
          { header: "Cloud Router", cell: (n) => <span className="font-mono">{n.router}</span> },
          {
            header: "ソースサブネット",
            cell: (n) =>
              n.allSubnets ? (
                "すべてのサブネット"
              ) : (
                <span className="font-mono">{n.subnets.join(", ")}</span>
              ),
          },
          { header: "ロギング", cell: (n) => (n.logging ? "有効" : "無効") },
        ]}
      />
    </div>
  );
};

/** ネットワーク サービス › Cloud Router: 一覧・作成・削除。 */
export const CloudRoutersScreen = ({
  world,
  project,
  handlers,
  outcome,
}: ScreenProps): ReactElement => {
  const projectId = project.projectId;
  const networks = World.networksOf(world, projectId);
  const routers = world.routers.filter((r) => r.projectId === projectId);
  const defaultRegion = resolveDefaultRegion(world);
  const seed = (): CloudRouterCreateForm =>
    CloudRouterCreateForm.create({
      network: networks[0]?.name ?? "default",
      region: defaultRegion,
    });
  const editor = useCreateForm(CloudRouterCreateForm, seed, false, outcome);
  const form = Option.unwrapOr(editor.form, seed());

  const create = (): void => {
    const valid = editor.submit();
    if (!Option.isSome(valid)) return;
    handlers.submit({
      line: CloudRouterCreateForm.toCommand(valid.value, projectId),
      note: `Cloud Router を作成 (${valid.value.name})`,
      next: Option.none,
    });
    editor.awaitClose();
  };

  const remove = (router: (typeof routers)[number]): void => {
    if (!handlers.confirm(`Cloud Router ${router.name} を削除しますか？`)) return;
    handlers.submit({
      line: DeleteCommand.router(router, projectId),
      note: `Cloud Router を削除 (${router.name})`,
      next: Option.none,
    });
  };

  return (
    <div>
      <ScreenTitle
        eyebrow="ネットワーク サービス"
        title="Cloud Router"
        trailing={<PrimaryButton onClick={editor.open}>ルーターを作成</PrimaryButton>}
      />
      {Option.isSome(editor.form) && (
        <CreateFormSection
          label="ルーターの作成"
          columns={2}
          command={CloudRouterCreateForm.toCommand(form, projectId)}
          onCopy={handlers.copy}
          onInsert={() => handlers.insert(CloudRouterCreateForm.toCommand(form, projectId))}
          onSubmit={create}
          onCancel={editor.close}
          submitLabel="作成"
        >
          <Field label="名前" required error={editor.errors.name}>
            {(id) => (
              <TextInput
                id={id}
                value={form.name}
                placeholder="nat-router"
                onChange={(v) => editor.set("name", v)}
              />
            )}
          </Field>
          <Field label="ネットワーク" required error={editor.errors.network}>
            {(id) => (
              <Select
                id={id}
                value={form.network}
                onChange={(v) => editor.set("network", v)}
                options={networks.map((n) => ({ value: n.name, label: n.name }))}
              />
            )}
          </Field>
          <Field label="リージョン" required>
            {(id) => (
              <Select<Region>
                id={id}
                value={form.region}
                onChange={(v) => editor.set("region", v)}
                options={Object.values(Regions).map((r) => ({ value: r, label: r }))}
              />
            )}
          </Field>
          <Field
            label="Google ASN"
            error={editor.errors.asn}
            hint="空欄の場合は既定の 64512 が使われます"
          >
            {(id) => (
              <TextInput
                id={id}
                value={form.asn}
                placeholder="64512"
                onChange={(v) => editor.set("asn", v)}
              />
            )}
          </Field>
        </CreateFormSection>
      )}
      <ResourceTable
        label="Cloud Router"
        rows={routers}
        keyOf={(r) => `${r.region}/${r.name}`}
        nameOf={(r) => r.name}
        empty="Cloud Router がありません。"
        onDelete={remove}
        columns={[
          { header: "名前", cell: (r) => <span className="font-mono">{r.name}</span> },
          { header: "ネットワーク", cell: (r) => <span className="font-mono">{r.network}</span> },
          { header: "リージョン", cell: (r) => <span className="font-mono">{r.region}</span> },
          { header: "Google ASN", cell: (r) => <span className="font-mono">{r.asn}</span> },
        ]}
      />
    </div>
  );
};
