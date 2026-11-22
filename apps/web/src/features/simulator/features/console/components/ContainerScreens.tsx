import type { ReactElement } from "react";

import { Checkbox } from "@/components/Checkbox";
import { Select } from "@/components/Select";
import { MachineType, Region, Regions, Zone } from "@/engine/domains/catalog";
import { GcloudConfig } from "@/engine/domains/gcloud-config";
import { GkePlacement } from "@/engine/domains/gke-completion";
import { CloudRunService, type GkeCluster } from "@/engine/domains/managed-services";
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

/** Kubernetes Engine › クラスタ: 一覧・作成（Autopilot / Standard）・接続・削除。 */
export const ClustersScreen = ({
  world,
  project,
  handlers,
  outcome,
}: ScreenProps): ReactElement => {
  const projectId = project.projectId;
  const seed = (): ClusterCreateForm =>
    ClusterCreateForm.create({
      zone: defaultZoneOf(world),
      region: defaultRegionOf(world, "compute/region"),
    });
  const editor = useCreateForm(ClusterCreateForm, seed, false, outcome);
  const form = Option.unwrapOr(editor.form, seed());
  const networks = World.networksOf(world, projectId);

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

  return (
    <div>
      <ScreenTitle
        eyebrow="Kubernetes Engine"
        title="クラスタ"
        trailing={<PrimaryButton onClick={editor.open}>＋ クラスタを作成</PrimaryButton>}
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
      <ResourceTable
        label="クラスタ"
        rows={World.clustersOf(world, projectId)}
        keyOf={(c) => `${c.location}/${c.name}`}
        nameOf={(c) => c.name}
        empty="クラスタはまだありません。上の「クラスタを作成」または gcloud container clusters create で作れます。"
        rowActions={(c) => (
          <SecondaryButton ariaLabel={`${c.name} に接続`} onClick={() => connect(c)}>
            接続
          </SecondaryButton>
        )}
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

/** Cloud Run › サービス: 一覧・作成（デプロイ）・削除。 */
export const RunServicesScreen = ({
  world,
  project,
  handlers,
  outcome,
}: ScreenProps): ReactElement => {
  const projectId = project.projectId;
  const seed = (): RunServiceCreateForm =>
    RunServiceCreateForm.create(defaultRegionOf(world, "run/region"));
  const editor = useCreateForm(RunServiceCreateForm, seed, false, outcome);
  const form = Option.unwrapOr(editor.form, seed());

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
        trailing={<PrimaryButton onClick={editor.open}>＋ サービスを作成</PrimaryButton>}
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
      <ResourceTable
        label="Cloud Run サービス"
        rows={World.runServicesOf(world, projectId)}
        keyOf={(s) => `${s.region}/${s.name}`}
        nameOf={(s) => s.name}
        empty="サービスはまだありません。上の「サービスを作成」または gcloud run deploy で作れます。"
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
