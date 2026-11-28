import { type ReactElement, useState } from "react";

import { Checkbox } from "@/components/Checkbox";
import { Select } from "@/components/Select";
import { MachineType, Region, Regions, Zone } from "@/engine/domains/catalog";
import { GcloudConfig } from "@/engine/domains/gcloud-config";
import { GkePlacement } from "@/engine/domains/gke-completion";
import { CloudRunService, type GkeCluster, type NodePool } from "@/engine/domains/managed-services";
import {
  defaultConfig,
  findDeployment,
  latestRevision,
} from "@/engine/domains/serverless-lab/model";
import { ServiceAccount } from "@/engine/domains/service-account";
import { World } from "@/engine/domains/world";
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
import {
  ClusterEditForm,
  NodePoolCreateForm,
  type RunServiceCpu,
  RunServiceCpuChoices,
  RunServiceEditForm,
  type RunServiceIngress,
} from "@/features/simulator/features/console/domains/edit-command/containers";
import {
  ClusterCreateForm,
  type ClusterMode,
  type ClusterReleaseChannel,
  clusterCredentialsCommand,
  DeleteCommand,
  RunServiceCreateForm,
} from "@/features/simulator/features/console/domains/equivalent-command";
import { useCreateForm } from "@/features/simulator/features/console/hooks/use-create-form";
import type { ScreenProps } from "@/features/simulator/features/console/types/screen-props";
import { Option } from "@/utils/Option";

const defaultZoneOf = (world: World): Zone =>
  Option.unwrapOr(
    Option.flatMap(GcloudConfig.get(world.config, "compute/zone"), Zone.parse),
    "asia-northeast1-a",
  );

const defaultRegionOf = (world: World, key: "compute/region" | "run/region"): Region =>
  Option.unwrapOr(
    Option.flatMap(GcloudConfig.get(world.config, key), Region.parse),
    Zone.region(defaultZoneOf(world)),
  );

/** Kubernetes Engine › クラスタ › ノードプール: 一覧・追加・削除（Standard クラスタ専用）。 */
const ClusterNodePoolsView = ({
  world,
  cluster,
  projectId,
  handlers,
  outcome,
  onBack,
}: Readonly<{
  world: World;
  cluster: GkeCluster;
  projectId: string;
  handlers: ScreenProps["handlers"];
  outcome: ScreenProps["outcome"];
  onBack: () => void;
}>): ReactElement => {
  const pools = World.nodePoolsOf(world, cluster);
  const seed = (): NodePoolCreateForm => NodePoolCreateForm.create(cluster);
  const createEditor = useCreateForm(NodePoolCreateForm, seed, false, outcome);
  const form = Option.unwrapOr(createEditor.form, seed());

  const createPool = (): void => {
    const valid = createEditor.submit();
    if (!Option.isSome(valid)) return;
    handlers.submit({
      line: NodePoolCreateForm.toCommand(valid.value, projectId),
      note: `ノードプールを追加 (${valid.value.name})`,
      next: Option.none,
    });
    createEditor.awaitClose();
  };

  const removePool = (pool: NodePool): void => {
    if (!handlers.confirm(`クラスタ ${cluster.name} のノードプール ${pool.name} を削除しますか？`))
      return;
    handlers.submit({
      line: NodePoolCreateForm.deleteCommand(cluster, pool.name, projectId),
      note: `ノードプールを削除 (${pool.name})`,
      next: Option.none,
    });
  };

  return (
    <div>
      <ScreenTitle
        eyebrow="Kubernetes Engine › クラスタ › ノードプール"
        title={cluster.name}
        trailing={
          <>
            <SecondaryButton onClick={onBack}>← クラスタ一覧</SecondaryButton>
            <PrimaryButton onClick={() => createEditor.openWith(seed())}>
              ＋ ノードプールを追加
            </PrimaryButton>
          </>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-3 rounded border border-line bg-canvas px-3 py-2 text-muted text-xs">
        <span className="font-mono text-ink">{cluster.location}</span>
        <span>Standard</span>
        <span>コントロール プレーン: {cluster.currentMasterVersion}</span>
        <span className="ml-auto">{pools.length} ノードプール</span>
      </div>

      {Option.isSome(createEditor.form) && (
        <CreateFormSection
          label="ノードプールを追加"
          columns={2}
          command={NodePoolCreateForm.toCommand(form, projectId)}
          onCopy={handlers.copy}
          onInsert={handlers.insert}
          onSubmit={createPool}
          onCancel={createEditor.close}
          submitLabel="作成"
        >
          <Field
            label="名前"
            required
            error={createEditor.errors.name}
            hint="英小文字・数字・ハイフン（例: high-mem-pool）"
          >
            {(id) => (
              <TextInput
                id={id}
                value={form.name}
                placeholder="high-mem-pool"
                onChange={(v) => createEditor.set("name", v)}
              />
            )}
          </Field>
          <Field label="マシンタイプ">
            {(id) => (
              <Select
                id={id}
                value={form.machineType}
                onChange={(m) => createEditor.set("machineType", m)}
                options={MachineType.all().map((m) => ({
                  value: m.name,
                  label: `${m.name} (${m.guestCpus} vCPU, ${m.memoryMb / 1024} GB)`,
                }))}
              />
            )}
          </Field>
          <Field
            label="ノード数（ゾーンあたり）"
            error={createEditor.errors.numNodes}
            hint="0〜1000（既定: 3）"
          >
            {(id) => (
              <TextInput
                id={id}
                value={form.numNodes}
                onChange={(v) => createEditor.set("numNodes", v)}
              />
            )}
          </Field>
          <div className="flex items-center sm:col-span-2">
            <Checkbox
              checked={form.enableAutoscaling}
              onChange={(v) => createEditor.set("enableAutoscaling", v)}
            >
              オートスケーリングを有効にする（--enable-autoscaling）
            </Checkbox>
          </div>
          {form.enableAutoscaling && (
            <>
              <Field
                label="最小ノード数（ゾーンあたり）"
                error={createEditor.errors.minNodes}
                hint="0〜1000"
              >
                {(id) => (
                  <TextInput
                    id={id}
                    value={form.minNodes}
                    onChange={(v) => createEditor.set("minNodes", v)}
                  />
                )}
              </Field>
              <Field
                label="最大ノード数（ゾーンあたり）"
                error={createEditor.errors.maxNodes}
                hint="1〜1000"
              >
                {(id) => (
                  <TextInput
                    id={id}
                    value={form.maxNodes}
                    onChange={(v) => createEditor.set("maxNodes", v)}
                  />
                )}
              </Field>
            </>
          )}
        </CreateFormSection>
      )}

      <ResourceTable
        label="ノードプール"
        rows={pools}
        keyOf={(p) => p.name}
        nameOf={(p) => p.name}
        empty="ノードプールはありません。「ノードプールを追加」または gcloud container node-pools create で追加できます。"
        onDelete={removePool}
        columns={[
          {
            header: "名前",
            cell: (p) => <span className="font-medium font-mono text-accent">{p.name}</span>,
          },
          {
            header: "マシンタイプ",
            cell: (p) => <span className="font-mono text-xs">{p.machineType}</span>,
          },
          {
            header: "ノード数（ゾーンあたり）",
            cell: (p) => String(p.nodeCount),
          },
          {
            header: "オートスケーリング",
            cell: (p) =>
              Option.isSome(p.autoscaling)
                ? `有効 (${p.autoscaling.value.minNodes}〜${p.autoscaling.value.maxNodes})`
                : "無効",
          },
          {
            header: "バージョン",
            cell: (p) => <span className="font-mono text-xs">{p.version}</span>,
          },
        ]}
      />
    </div>
  );
};

/** Kubernetes Engine › クラスタ: 一覧・作成（Autopilot / Standard）・編集・接続・ノードプール・削除。 */
export const ClustersScreen = ({
  world,
  project,
  handlers,
  outcome,
}: ScreenProps): ReactElement => {
  const projectId = project.projectId;
  const [nodePoolsClusterName, setNodePoolsClusterName] = useState<Option<string>>(Option.none);
  const seed = (): ClusterCreateForm =>
    ClusterCreateForm.create({
      zone: defaultZoneOf(world),
      region: defaultRegionOf(world, "compute/region"),
    });
  const editor = useCreateForm(ClusterCreateForm, seed, false, outcome);
  const editEditor = useCreateForm(ClusterEditForm, ClusterEditForm.empty, false, outcome);
  const form = Option.unwrapOr(editor.form, seed());
  const editForm = Option.unwrapOr(editEditor.form, ClusterEditForm.empty());
  const editSteps = ClusterEditForm.toSteps(editForm, projectId);
  const networks = World.networksOf(world, projectId);
  const clusters = World.clustersOf(world, projectId);
  const nodePoolsCluster = Option.isSome(nodePoolsClusterName)
    ? clusters.find((c) => c.name === nodePoolsClusterName.value && !c.autopilot)
    : undefined;

  const openCreate = (): void => {
    editEditor.close();
    setNodePoolsClusterName(Option.none);
    editor.open();
  };

  const startEdit = (cluster: GkeCluster): void => {
    const pools = World.nodePoolsOf(world, cluster);
    const primaryPool = pools.find((p) => p.name === "default-pool") ?? pools[0];
    editor.close();
    setNodePoolsClusterName(Option.none);
    editEditor.openWith(ClusterEditForm.fromCluster(cluster, Option.fromNullable(primaryPool)));
  };

  const openNodePools = (cluster: GkeCluster): void => {
    editor.close();
    editEditor.close();
    setNodePoolsClusterName(Option.some(cluster.name));
  };

  const create = (): void => {
    const valid = editor.submit();
    if (!Option.isSome(valid)) return;
    handlers.submit({
      line: ClusterCreateForm.toCommand(valid.value, projectId),
      note: `クラスタを作成 (${valid.value.name})`,
      next: Option.none,
    });
    editor.awaitClose();
  };

  const saveEdit = (): void => {
    const valid = editEditor.submit();
    if (!Option.isSome(valid)) return;
    const [first, ...rest] = ClusterEditForm.toSteps(valid.value, projectId);
    if (first === undefined) {
      editEditor.close();
      return;
    }
    handlers.submit({ ...first, next: Option.none, rest });
    editEditor.awaitClose();
  };

  const connect = (cluster: GkeCluster): void => {
    handlers.submit({
      line: clusterCredentialsCommand(cluster, projectId),
      note: `クラスタの認証情報を取得 (${cluster.name})`,
      next: Option.none,
      openTerminal: true,
    });
  };

  const remove = (cluster: GkeCluster): void => {
    if (!handlers.confirm(`クラスタ ${cluster.name} を削除しますか？`)) return;
    handlers.submit({
      line: DeleteCommand.cluster(cluster, projectId),
      note: `クラスタを削除 (${cluster.name})`,
      next: Option.none,
    });
  };

  if (nodePoolsCluster !== undefined) {
    return (
      <ClusterNodePoolsView
        world={world}
        cluster={nodePoolsCluster}
        projectId={projectId}
        handlers={handlers}
        outcome={outcome}
        onBack={() => setNodePoolsClusterName(Option.none)}
      />
    );
  }

  return (
    <div>
      <ScreenTitle
        eyebrow="Kubernetes Engine"
        title="クラスタ"
        trailing={<PrimaryButton onClick={openCreate}>＋ クラスタを作成</PrimaryButton>}
      />
      {Option.isSome(editor.form) && (
        <CreateFormSection
          label="クラスタを作成"
          columns={2}
          command={ClusterCreateForm.toCommand(form, projectId)}
          onCopy={handlers.copy}
          onInsert={handlers.insert}
          onSubmit={create}
          onCancel={editor.close}
          submitLabel="作成"
        >
          <div className="sm:col-span-2">
            <RadioGroup<ClusterMode>
              label="クラスタ モード"
              name="gke-cluster-mode"
              value={form.mode}
              onChange={(mode) => editor.set("mode", mode)}
              options={[
                {
                  value: "autopilot",
                  label: "GKE Autopilot（Google がノードを自動管理・リージョン固定）",
                },
                {
                  value: "standard",
                  label: "GKE Standard（ノード数やマシンタイプを自分で構成）",
                },
              ]}
            />
          </div>
          <Field label="名前" required error={editor.errors.name}>
            {(id) => (
              <TextInput
                id={id}
                value={form.name}
                placeholder="my-cluster"
                onChange={(v) => editor.set("name", v)}
              />
            )}
          </Field>
          {form.mode === "autopilot" ? (
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
            <>
              <Field label="ロケーション タイプ">
                {(id) => (
                  <Select<"zone" | "region">
                    id={id}
                    value={form.locationType}
                    onChange={(v) => editor.set("locationType", v)}
                    options={[
                      { value: "zone", label: "ゾーン" },
                      { value: "region", label: "リージョン" },
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
              <Field label="ノード数（ゾーンあたり）" error={editor.errors.numNodes} hint="既定: 3">
                {(id) => (
                  <TextInput
                    id={id}
                    value={form.numNodes}
                    onChange={(v) => editor.set("numNodes", v)}
                  />
                )}
              </Field>
              <Field label="マシンタイプ">
                {(id) => (
                  <Select
                    id={id}
                    value={form.machineType}
                    onChange={(m) => editor.set("machineType", m)}
                    options={MachineType.all().map((m) => ({
                      value: m.name,
                      label: `${m.name} (${m.guestCpus} vCPU, ${m.memoryMb / 1024} GB)`,
                    }))}
                  />
                )}
              </Field>
            </>
          )}
          <Field label="リリース チャンネル">
            {(id) => (
              <Select<ClusterReleaseChannel>
                id={id}
                value={form.releaseChannel}
                onChange={(v) => editor.set("releaseChannel", v)}
                options={[
                  { value: "regular", label: "Regular（推奨）" },
                  { value: "rapid", label: "Rapid" },
                  { value: "stable", label: "Stable" },
                  { value: "None", label: "静的バージョン（None）" },
                ]}
              />
            )}
          </Field>
          <Field label="ネットワーク">
            {(id) => (
              <Select
                id={id}
                value={form.network}
                onChange={(v) => editor.set("network", v)}
                options={
                  networks.length > 0
                    ? networks.map((n) => ({ value: n.name, label: n.name }))
                    : [{ value: "default", label: "default" }]
                }
              />
            )}
          </Field>
          {form.mode === "standard" && (
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Checkbox
                checked={form.enableNetworkPolicy}
                onChange={(v) => editor.set("enableNetworkPolicy", v)}
              >
                ネットワーク ポリシーを有効にする（--enable-network-policy）
              </Checkbox>
              <Checkbox
                checked={form.enableWorkloadIdentity}
                onChange={(v) => editor.set("enableWorkloadIdentity", v)}
              >
                Workload Identity を有効にする（--workload-pool={projectId}.svc.id.goog）
              </Checkbox>
            </div>
          )}
        </CreateFormSection>
      )}
      {Option.isSome(editEditor.form) && (
        <CreateFormSection
          label={`クラスタを編集 (${editForm.name})`}
          columns={2}
          command={ClusterEditForm.toCommand(editForm, projectId)}
          onCopy={handlers.copy}
          onInsert={() => {
            const line = editSteps[0]?.line;
            if (line !== undefined) handlers.insert(line);
          }}
          onSubmit={saveEdit}
          onCancel={editEditor.close}
          submitLabel="保存"
        >
          <Field label="名前" hint="作成後に変更できません">
            {(id) => (
              <p
                id={id}
                className="rounded border border-line bg-canvas px-2.5 py-1.5 font-mono text-ink text-sm"
              >
                {editForm.name}
              </p>
            )}
          </Field>
          <Field label="ロケーション / モード" hint="作成後に変更できません">
            {(id) => (
              <p
                id={id}
                className="rounded border border-line bg-canvas px-2.5 py-1.5 font-mono text-ink text-sm"
              >
                {editForm.location} ({editForm.autopilot ? "Autopilot" : "Standard"})
              </p>
            )}
          </Field>
          {!editForm.autopilot && editForm.poolName !== "" && (
            <>
              <div className="sm:col-span-2">
                <Checkbox
                  checked={editForm.enableAutoscaling}
                  onChange={(v) => editEditor.set("enableAutoscaling", v)}
                >
                  ノードプール（{editForm.poolName}）のオートスケーリングを有効にする
                </Checkbox>
              </div>
              {editForm.enableAutoscaling ? (
                <>
                  <Field
                    label="最小ノード数（ゾーンあたり）"
                    error={editEditor.errors.minNodes}
                    hint="0〜1000"
                  >
                    {(id) => (
                      <TextInput
                        id={id}
                        value={editForm.minNodes}
                        onChange={(v) => editEditor.set("minNodes", v)}
                      />
                    )}
                  </Field>
                  <Field
                    label="最大ノード数（ゾーンあたり）"
                    error={editEditor.errors.maxNodes}
                    hint="1〜1000"
                  >
                    {(id) => (
                      <TextInput
                        id={id}
                        value={editForm.maxNodes}
                        onChange={(v) => editEditor.set("maxNodes", v)}
                      />
                    )}
                  </Field>
                </>
              ) : (
                <Field
                  label={`ノード数（ゾーンあたり・${editForm.poolName}）`}
                  error={editEditor.errors.numNodes}
                  hint="0〜1000"
                >
                  {(id) => (
                    <TextInput
                      id={id}
                      value={editForm.numNodes}
                      onChange={(v) => editEditor.set("numNodes", v)}
                    />
                  )}
                </Field>
              )}
              <div className="flex flex-col gap-2 sm:col-span-2">
                <Checkbox
                  checked={editForm.autoRepair}
                  onChange={(v) => editEditor.set("autoRepair", v)}
                >
                  ノードの自動修復を有効にする（--enable-autorepair）
                </Checkbox>
                <Checkbox
                  checked={editForm.autoUpgrade}
                  onChange={(v) => editEditor.set("autoUpgrade", v)}
                >
                  ノードの自動アップグレードを有効にする（--enable-autoupgrade）
                </Checkbox>
              </div>
            </>
          )}
          {!editForm.autopilot && (
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Checkbox
                checked={editForm.enableWorkloadIdentity}
                onChange={(v) => editEditor.set("enableWorkloadIdentity", v)}
              >
                Workload Identity を有効にする（--workload-pool={projectId}.svc.id.goog）
              </Checkbox>
              <Checkbox
                checked={editForm.enableVpa}
                onChange={(v) => editEditor.set("enableVpa", v)}
              >
                Vertical Pod Autoscaling を有効にする（--enable-vertical-pod-autoscaling）
              </Checkbox>
            </div>
          )}
          <div className="sm:col-span-2">
            <Checkbox
              checked={editForm.enableAuthorizedNetworks}
              onChange={(v) => editEditor.set("enableAuthorizedNetworks", v)}
            >
              コントロール プレーン承認済みネットワークを有効にする
            </Checkbox>
          </div>
          {editForm.enableAuthorizedNetworks && (
            <div className="sm:col-span-2">
              <Field
                label="承認済みネットワーク（IPv4 CIDR）"
                error={editEditor.errors.authorizedNetworks}
                hint="カンマ区切り（例: 203.0.113.0/24, 198.51.100.0/24）"
              >
                {(id) => (
                  <TextInput
                    id={id}
                    value={editForm.authorizedNetworks}
                    placeholder="203.0.113.0/24"
                    onChange={(v) => editEditor.set("authorizedNetworks", v)}
                  />
                )}
              </Field>
            </div>
          )}
        </CreateFormSection>
      )}
      <ResourceTable
        label="クラスタ"
        rows={clusters}
        keyOf={(c) => `${c.location}/${c.name}`}
        nameOf={(c) => c.name}
        empty="クラスタはまだありません。上の「クラスタを作成」または gcloud container clusters create で作れます。"
        rowActions={(c) => (
          <>
            {!c.autopilot && (
              <SecondaryButton
                ariaLabel={`${c.name} のノードプールを管理`}
                onClick={() => openNodePools(c)}
              >
                ノードプール
              </SecondaryButton>
            )}
            <SecondaryButton ariaLabel={`${c.name} に接続`} onClick={() => connect(c)}>
              接続
            </SecondaryButton>
          </>
        )}
        onEdit={startEdit}
        onDelete={remove}
        columns={[
          {
            header: "状態",
            cell: (c) => <ConsoleStatus status={c.status} />,
          },
          {
            header: "名前",
            cell: (c) => <span className="font-medium font-mono text-accent">{c.name}</span>,
          },
          { header: "ロケーション", cell: (c) => c.location },
          {
            header: "モード",
            cell: (c) => (
              <span className="inline-block rounded bg-code px-2 py-0.5 text-ink text-xs">
                {c.autopilot ? "Autopilot" : "Standard"}
              </span>
            ),
          },
          {
            header: "総ノード数",
            cell: (c) =>
              c.autopilot ? "自動" : String(c.nodeCount * GkePlacement.zones(c).length),
          },
          {
            header: "バージョン",
            cell: (c) => <span className="font-mono text-xs">{c.currentMasterVersion}</span>,
          },
        ]}
      />
    </div>
  );
};

/** Cloud Run › サービス: 一覧・作成（デプロイ）・編集・削除。 */
export const RunServicesScreen = ({
  world,
  project,
  handlers,
  outcome,
}: ScreenProps): ReactElement => {
  const projectId = project.projectId;
  const seed = (): RunServiceCreateForm =>
    RunServiceCreateForm.create(defaultRegionOf(world, "run/region"));
  const editSeed = (): RunServiceEditForm =>
    RunServiceEditForm.empty(defaultRegionOf(world, "run/region"));
  const editor = useCreateForm(RunServiceCreateForm, seed, false, outcome);
  const editEditor = useCreateForm(RunServiceEditForm, editSeed, false, outcome);
  const form = Option.unwrapOr(editor.form, seed());
  const editForm = Option.unwrapOr(editEditor.form, editSeed());
  const editSteps = RunServiceEditForm.toSteps(editForm, projectId);

  const openCreate = (): void => {
    editEditor.close();
    editor.open();
  };

  const startEdit = (service: CloudRunService): void => {
    const deployment = findDeployment(
      world,
      { projectId, region: service.region, name: service.name },
      "run",
    );
    const config =
      deployment !== undefined
        ? latestRevision(deployment).config
        : defaultConfig(ServiceAccount.defaultComputeEmail(project.projectNumber));
    editor.close();
    editEditor.openWith(RunServiceEditForm.fromService(service, config));
  };

  const create = (): void => {
    const valid = editor.submit();
    if (!Option.isSome(valid)) return;
    handlers.submit({
      line: RunServiceCreateForm.toCommand(valid.value, projectId),
      note: `Cloud Run サービスをデプロイ (${valid.value.name})`,
      next: Option.none,
    });
    editor.awaitClose();
  };

  const saveEdit = (): void => {
    const valid = editEditor.submit();
    if (!Option.isSome(valid)) return;
    const [first, ...rest] = RunServiceEditForm.toSteps(valid.value, projectId);
    if (first === undefined) {
      editEditor.close();
      return;
    }
    handlers.submit({ ...first, next: Option.none, rest });
    editEditor.awaitClose();
  };

  const remove = (service: CloudRunService): void => {
    if (!handlers.confirm(`サービス ${service.name} を削除しますか？`)) return;
    handlers.submit({
      line: DeleteCommand.runService(service, projectId),
      note: `Cloud Run サービスを削除 (${service.name})`,
      next: Option.none,
    });
  };

  return (
    <div>
      <ScreenTitle
        eyebrow="Cloud Run"
        title="サービス"
        trailing={<PrimaryButton onClick={openCreate}>＋ サービスを作成</PrimaryButton>}
      />
      {Option.isSome(editor.form) && (
        <CreateFormSection
          label="サービスを作成"
          columns={2}
          command={RunServiceCreateForm.toCommand(form, projectId)}
          onCopy={handlers.copy}
          onInsert={handlers.insert}
          onSubmit={create}
          onCancel={editor.close}
          submitLabel="作成"
        >
          <Field label="サービス名" required error={editor.errors.name}>
            {(id) => (
              <TextInput
                id={id}
                value={form.name}
                placeholder="hello-service"
                onChange={(v) => editor.set("name", v)}
              />
            )}
          </Field>
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
          <div className="sm:col-span-2">
            <Field
              label="コンテナ イメージの URL"
              required
              error={editor.errors.image}
              hint="例: us-docker.pkg.dev/cloudrun/container/hello"
            >
              {(id) => (
                <TextInput id={id} value={form.image} onChange={(v) => editor.set("image", v)} />
              )}
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Checkbox
              checked={form.allowUnauthenticated}
              onChange={(v) => editor.set("allowUnauthenticated", v)}
            >
              未認証の呼び出しを許可（公開 API やウェブサイト向け）
            </Checkbox>
          </div>
        </CreateFormSection>
      )}
      {Option.isSome(editEditor.form) && (
        <CreateFormSection
          label={`サービスを編集 (${editForm.name})`}
          columns={2}
          command={RunServiceEditForm.toCommand(editForm, projectId)}
          onCopy={handlers.copy}
          onInsert={() => {
            const line = editSteps[0]?.line;
            if (line !== undefined) handlers.insert(line);
          }}
          onSubmit={saveEdit}
          onCancel={editEditor.close}
          submitLabel="保存"
        >
          <Field label="サービス名" hint="作成後に変更できません">
            {(id) => (
              <p
                id={id}
                className="rounded border border-line bg-canvas px-2.5 py-1.5 font-mono text-ink text-sm"
              >
                {editForm.name}
              </p>
            )}
          </Field>
          <Field label="リージョン" hint="作成後に変更できません">
            {(id) => (
              <p
                id={id}
                className="rounded border border-line bg-canvas px-2.5 py-1.5 font-mono text-ink text-sm"
              >
                {editForm.region}
              </p>
            )}
          </Field>
          <div className="sm:col-span-2">
            <Field label="コンテナ イメージの URL" required error={editEditor.errors.image}>
              {(id) => (
                <TextInput
                  id={id}
                  value={editForm.image}
                  onChange={(v) => editEditor.set("image", v)}
                />
              )}
            </Field>
          </div>
          <Field label="CPU">
            {(id) => (
              <Select<RunServiceCpu>
                id={id}
                value={editForm.cpu}
                onChange={(v) => editEditor.set("cpu", v)}
                options={RunServiceCpuChoices.map((c) => ({ value: c, label: `${c} vCPU` }))}
              />
            )}
          </Field>
          <Field label="メモリ" error={editEditor.errors.memory} hint="例: 256Mi, 512Mi, 1Gi, 2Gi">
            {(id) => (
              <TextInput
                id={id}
                value={editForm.memory}
                onChange={(v) => editEditor.set("memory", v)}
              />
            )}
          </Field>
          <Field label="最小インスタンス数" error={editEditor.errors.minInstances} hint="0〜1000">
            {(id) => (
              <TextInput
                id={id}
                value={editForm.minInstances}
                onChange={(v) => editEditor.set("minInstances", v)}
              />
            )}
          </Field>
          <Field label="最大インスタンス数" error={editEditor.errors.maxInstances} hint="1〜1000">
            {(id) => (
              <TextInput
                id={id}
                value={editForm.maxInstances}
                onChange={(v) => editEditor.set("maxInstances", v)}
              />
            )}
          </Field>
          <Field label="最大同時リクエスト数" error={editEditor.errors.concurrency} hint="1〜1000">
            {(id) => (
              <TextInput
                id={id}
                value={editForm.concurrency}
                onChange={(v) => editEditor.set("concurrency", v)}
              />
            )}
          </Field>
          <Field
            label="リクエスト タイムアウト（秒）"
            error={editEditor.errors.timeout}
            hint="1〜3600"
          >
            {(id) => (
              <TextInput
                id={id}
                value={editForm.timeout}
                onChange={(v) => editEditor.set("timeout", v)}
              />
            )}
          </Field>
          <Field label="Ingress 制御">
            {(id) => (
              <Select<RunServiceIngress>
                id={id}
                value={editForm.ingress}
                onChange={(v) => editEditor.set("ingress", v)}
                options={[
                  { value: "all", label: "すべて（all）" },
                  { value: "internal", label: "内部のみ（internal）" },
                  {
                    value: "internal-and-cloud-load-balancing",
                    label: "内部と Cloud Load Balancing",
                  },
                ]}
              />
            )}
          </Field>
          <div className="sm:col-span-2">
            <Field
              label="環境変数"
              error={editEditor.errors.envVars}
              hint="KEY=VALUE をカンマ区切りで指定（空欄ですべて削除）"
            >
              {(id) => (
                <TextInput
                  id={id}
                  value={editForm.envVars}
                  placeholder="APP_ENV=prod, LOG_LEVEL=info"
                  onChange={(v) => editEditor.set("envVars", v)}
                />
              )}
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Checkbox
              checked={editForm.allowUnauthenticated}
              onChange={(v) => editEditor.set("allowUnauthenticated", v)}
            >
              未認証の呼び出しを許可（roles/run.invoker を allUsers に付与 / 削除）
            </Checkbox>
          </div>
        </CreateFormSection>
      )}
      <ResourceTable
        label="Cloud Run サービス"
        rows={World.runServicesOf(world, projectId)}
        keyOf={(s) => `${s.region}/${s.name}`}
        nameOf={(s) => s.name}
        empty="サービスはまだありません。上の「サービスを作成」または gcloud run deploy で作れます。"
        onEdit={startEdit}
        onDelete={remove}
        columns={[
          {
            header: "状態",
            cell: () => <ConsoleStatus status="READY" />,
          },
          {
            header: "名前",
            cell: (s) => <span className="font-medium font-mono text-accent">{s.name}</span>,
          },
          { header: "リージョン", cell: (s) => s.region },
          {
            header: "URL",
            cell: (s) => (
              <span className="font-mono text-accent text-xs">{CloudRunService.url(s)}</span>
            ),
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
