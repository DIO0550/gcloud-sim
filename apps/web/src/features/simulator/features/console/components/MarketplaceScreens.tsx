import { type ReactElement, useState } from "react";

import { Checkbox } from "@/components/Checkbox";
import { Select } from "@/components/Select";
import { TextButton } from "@/components/TextButton";
import {
  type ApiName,
  ApiService,
  MachineType,
  type MachineTypeName,
  Zone,
} from "@/engine/domains/catalog";
import { ExternalIp } from "@/engine/domains/compute";
import { GcloudConfig } from "@/engine/domains/gcloud-config";
import { type InfraDeployment, MarketplaceSolution } from "@/engine/domains/infra-manager";
import type { Project } from "@/engine/domains/resource-hierarchy";
import { ServiceAccount } from "@/engine/domains/service-account";
import { World } from "@/engine/domains/world";
import {
  Field,
  FormWithCommand,
  PrimaryButton,
  ResourceTable,
  ScreenTitle,
  SecondaryButton,
  TextInput,
} from "@/features/simulator/features/console/components/ConsoleParts";
import {
  DeleteCommand,
  enableApisCommand,
  MarketplaceDeployForm,
} from "@/features/simulator/features/console/domains/equivalent-command";
import { useCreateForm } from "@/features/simulator/features/console/hooks/use-create-form";
import type {
  ConsoleHandlers,
  ScreenProps,
} from "@/features/simulator/features/console/types/screen-props";
import { Option } from "@/utils/Option";

/**
 * Cloud Marketplace（検索 → 製品の概要 → 規約への同意 → デプロイ設定）と、デプロイしたソリューションの一覧。
 * デプロイは Infrastructure Manager の `deployments apply` と同じ 1 行を CLI と同じ経路で流す。
 */

/** デプロイに要る API（本物の Marketplace も足りなければ有効化を促す）。 */
const RequiredApis: readonly ApiName[] = ["compute.googleapis.com", "config.googleapis.com"];

/** マシンタイプのシリーズ（`e2-medium` の `E2`）。 */
const seriesOf = (machineType: string): string => (machineType.split("-")[0] ?? "").toUpperCase();

type Stage =
  | Readonly<{ kind: "search" }>
  | Readonly<{ kind: "product"; id: string }>
  | Readonly<{ kind: "agreement"; id: string }>
  | Readonly<{ kind: "deploy"; id: string }>;

/** Marketplace › プロダクトを検索。製品を選び、規約に同意して、デプロイの設定へ進む。 */
export const MarketplaceScreen = ({ world, project, handlers }: ScreenProps): ReactElement => {
  const [stage, setStage] = useState<Stage>({ kind: "search" });
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  if (stage.kind === "search") {
    const results = MarketplaceSolution.search(query);
    return (
      <div>
        <ScreenTitle eyebrow="Marketplace" title="Marketplace" />
        <div className="mb-5 flex max-w-xl gap-2">
          <TextInput
            value={draft}
            onChange={setDraft}
            ariaLabel="Marketplace を検索"
            placeholder="プロダクトを検索（例: LAMP）"
            font="sans"
            onKeyDown={(event) => {
              if (event.key === "Enter") setQuery(draft);
            }}
          />
          <SecondaryButton onClick={() => setQuery(draft)}>検索</SecondaryButton>
        </div>
        <h3 className="mb-3 font-medium text-sm">
          {query === "" ? "すべてのプロダクト" : `「${query}」の検索結果`}（{results.length} 件）
        </h3>
        {results.length === 0 ? (
          <p className="text-muted text-sm">一致するプロダクトはありません。</p>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2" aria-label="検索結果">
            {results.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="w-full rounded-lg border border-line bg-surface p-4 text-left hover:border-accent"
                  onClick={() => setStage({ kind: "product", id: s.id })}
                >
                  <span className="block font-medium text-accent">{s.title}</span>
                  <span className="block text-muted text-xs">{s.provider}</span>
                  <span className="mt-2 block text-sm">{s.summary}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  const solution = MarketplaceSolution.find(stage.id);
  if (!Option.isSome(solution)) return <span className="hidden" />;
  const s = solution.value;
  const back = (
    <SecondaryButton onClick={() => setStage({ kind: "search" })}>検索結果に戻る</SecondaryButton>
  );
  switch (stage.kind) {
    case "product":
      return (
        <div>
          <ScreenTitle eyebrow="Marketplace" title={s.title} trailing={back} />
          <p className="mb-1 text-muted text-sm">{s.provider}</p>
          <p className="mb-4 text-sm">{s.summary}</p>
          {Option.isSome(s.blueprint) ? (
            <PrimaryButton
              className="mb-6"
              onClick={() => setStage({ kind: "agreement", id: s.id })}
            >
              使ってみる
            </PrimaryButton>
          ) : (
            <p className="mb-6 rounded-lg border border-line bg-canvas px-4 py-3 text-sm">
              このプロダクトはこのシミュレータではデプロイできません。提供元が Cloud Infrastructure
              Services の「LAMP Stack Server on Ubuntu」を選んでください。
            </p>
          )}
          <h3 className="mb-2 font-medium text-sm">構成</h3>
          <ResourceTable
            label="構成"
            rows={s.components}
            keyOf={(c) => c.name}
            empty="構成の情報はありません。"
            columns={[
              { header: "コンポーネント", cell: (c) => c.name },
              { header: "ロール", cell: (c) => c.role },
            ]}
          />
          {Option.isSome(s.blueprint) && (
            <p className="mt-4 text-muted text-xs">
              デプロイすると Compute Engine の VM（{s.blueprint.value.os}）が 1
              台できます。デプロイは Infrastructure Manager が Terraform
              のブループリントを適用して行います。
            </p>
          )}
        </div>
      );
    case "agreement":
      return (
        <AgreementStage
          title={s.title}
          back={back}
          onAccepted={() => setStage({ kind: "deploy", id: s.id })}
        />
      );
    case "deploy":
      return (
        <DeployStage
          world={world}
          project={project}
          handlers={handlers}
          solution={s}
          onCancel={() => setStage({ kind: "product", id: s.id })}
        />
      );
  }
};

/** 規約への同意（Agreements ページと「利用規約に同意しました」のポップアップ）。 */
const AgreementStage = ({
  title,
  back,
  onAccepted,
}: Readonly<{ title: string; back: ReactElement; onAccepted: () => void }>): ReactElement => {
  const [checked, setChecked] = useState(false);
  const [accepted, setAccepted] = useState(false);
  return (
    <div>
      <ScreenTitle eyebrow="Marketplace" title="利用規約への同意" trailing={back} />
      <p className="mb-4 text-sm">
        {title} を使うには、提供元の利用規約と Google Cloud Marketplace
        の利用規約に同意してください。
      </p>
      <div className="mb-4">
        <Checkbox checked={checked} onChange={setChecked}>
          利用規約への同意
        </Checkbox>
      </div>
      <PrimaryButton disabled={!checked} onClick={() => setAccepted(true)}>
        同意する
      </PrimaryButton>
      {accepted && (
        <section
          role="dialog"
          aria-label="利用規約に同意しました"
          className="mt-6 max-w-md rounded-lg border border-line bg-surface p-5 shadow"
        >
          <h3 className="mb-2 font-medium">利用規約に同意しました</h3>
          <p className="mb-4 text-muted text-sm">続けてデプロイの設定に進みます。</p>
          <PrimaryButton onClick={onAccepted}>デプロイ</PrimaryButton>
        </section>
      )}
    </div>
  );
};

/** デプロイの設定。API が足りなければ先に有効化を促す。 */
const DeployStage = ({
  world,
  project,
  handlers,
  solution,
  onCancel,
}: Readonly<{
  world: World;
  project: Project;
  handlers: ConsoleHandlers;
  solution: MarketplaceSolution;
  onCancel: () => void;
}>): ReactElement => {
  const projectId = project.projectId;
  const defaultAccount = ServiceAccount.defaultComputeEmail(project.projectNumber);
  const defaultZone: Zone = Option.unwrapOr(
    Option.flatMap(GcloudConfig.get(world.config, "compute/zone"), Zone.parse),
    "asia-northeast1-a",
  );
  const editor = useCreateForm(
    MarketplaceDeployForm,
    () => MarketplaceDeployForm.create({ zone: defaultZone, serviceAccount: defaultAccount }),
    true,
  );
  if (!Option.isSome(solution.blueprint)) return <span className="hidden" />;
  const source = solution.blueprint.value.source;
  const missing = RequiredApis.filter((api) => !World.hasApi(world, projectId, api));
  const title = (
    <ScreenTitle
      eyebrow="Marketplace"
      title={`${solution.title} のデプロイ`}
      trailing={<SecondaryButton onClick={onCancel}>キャンセル</SecondaryButton>}
    />
  );
  if (missing.length > 0) {
    return (
      <div>
        {title}
        <section
          aria-label="必要な API"
          className="max-w-xl rounded-lg border border-line bg-surface p-5"
        >
          <p className="mb-3 font-medium">このソリューションのデプロイには次の API が必要です</p>
          <ul className="mb-4 list-disc pl-5 text-sm">
            {missing.map((api) => (
              <li key={api}>
                {ApiService.find(api).title}（{api}）
              </li>
            ))}
          </ul>
          <PrimaryButton
            onClick={() =>
              handlers.submit({
                line: enableApisCommand(missing, projectId),
                note: `${missing.map((api) => ApiService.find(api).title).join(" と ")} を有効にする`,
                next: Option.none,
              })
            }
          >
            有効にする
          </PrimaryButton>
        </section>
      </div>
    );
  }
  const form = Option.unwrapOr(
    editor.form,
    MarketplaceDeployForm.create({ zone: defaultZone, serviceAccount: defaultAccount }),
  );
  const command = MarketplaceDeployForm.toCommand(form, projectId, source);
  const series = seriesOf(form.machineType);
  const allSeries = [...new Set(MachineType.all().map((m) => seriesOf(m.name)))];
  const accounts = [
    defaultAccount,
    ...World.serviceAccountsOf(world, projectId).map((a) => a.email),
  ];
  const deploy = (): void => {
    const valid = editor.submit();
    if (!Option.isSome(valid)) return;
    handlers.submit({
      line: MarketplaceDeployForm.toCommand(valid.value, projectId, source),
      note: `Marketplace から ${solution.title} をデプロイ (${valid.value.name})`,
      next: Option.some("solution-deployments"),
    });
  };
  return (
    <div>
      {title}
      <FormWithCommand
        command={command}
        onCopy={handlers.copy}
        onInsert={handlers.insert}
        actions={
          <>
            <PrimaryButton onClick={deploy}>デプロイ</PrimaryButton>
            <SecondaryButton onClick={onCancel}>キャンセル</SecondaryButton>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="デプロイ名"
            required
            error={editor.errors.name}
            hint={`VM は ${form.name}-vm という名前になります`}
          >
            {(id) => (
              <TextInput id={id} value={form.name} onChange={(v) => editor.set("name", v)} />
            )}
          </Field>
          <Field label="デプロイ サービス アカウント">
            {(id) => (
              <Select
                id={id}
                value={form.serviceAccount}
                onChange={(v) => editor.set("serviceAccount", v)}
                options={accounts.map((a) => ({
                  value: a,
                  label: a === defaultAccount ? `${a}（Compute Engine のデフォルト）` : a,
                }))}
              />
            )}
          </Field>
          <Field label="ゾーン" hint={`デプロイメントの置き場は ${Zone.region(form.zone)}`}>
            {(id) => (
              <Select
                id={id}
                value={form.zone}
                onChange={(v) => editor.set("zone", v)}
                options={Zone.all().map((z) => ({ value: z, label: z }))}
              />
            )}
          </Field>
          <div />
          <Field label="シリーズ">
            {(id) => (
              <Select
                id={id}
                value={series}
                onChange={(v) => {
                  const first = MachineType.all().find((m) => seriesOf(m.name) === v);
                  if (first !== undefined) editor.set("machineType", first.name);
                }}
                options={allSeries.map((x) => ({ value: x, label: x }))}
              />
            )}
          </Field>
          <Field label="マシンタイプ">
            {(id) => (
              <Select<MachineTypeName>
                id={id}
                value={form.machineType}
                onChange={(v) => editor.set("machineType", v)}
                options={MachineType.all()
                  .filter((m) => seriesOf(m.name) === series)
                  .map((m) => ({ value: m.name, label: `${m.name}（${m.description}）` }))}
              />
            )}
          </Field>
        </div>
        <fieldset className="mt-5">
          <legend className="mb-2 font-bold text-sm">ファイアウォール</legend>
          <div className="grid gap-2 text-sm">
            <Checkbox checked={form.http} onChange={(v) => editor.set("http", v)}>
              インターネットからの TCP ポート 80 のトラフィックを許可する
            </Checkbox>
            <Checkbox checked={form.https} onChange={(v) => editor.set("https", v)}>
              インターネットからの TCP ポート 443 のトラフィックを許可する
            </Checkbox>
          </div>
        </fieldset>
      </FormWithCommand>
    </div>
  );
};

/** VM のリソースから、外部 IP とゾーン・マシンタイプを引く。 */
const vmOf = (world: World, d: InfraDeployment) =>
  Option.fromNullable(
    d.resources
      .filter((r) => r.type === "google_compute_instance")
      .flatMap((r) =>
        world.instances.filter(
          (i) =>
            i.projectId === d.projectId &&
            i.name === r.name &&
            Option.isSome(r.zone) &&
            i.zone === r.zone.value,
        ),
      )[0],
  );

/** Marketplace › ソリューションのデプロイ。デプロイの結果と、できた VM・サイトのアドレス。 */
export const SolutionDeploymentsScreen = ({
  world,
  project,
  handlers,
}: ScreenProps): ReactElement => {
  const projectId = project.projectId;
  const deployments = World.namedOf(world, "infraDeployments", projectId);
  const remove = (d: InfraDeployment): void => {
    if (
      !handlers.confirm(
        `デプロイ ${d.name} を削除しますか？（作った VM とファイアウォール ルールも消えます）`,
      )
    )
      return;
    handlers.submit({
      line: DeleteCommand.infraDeployment(d, projectId),
      note: `デプロイを削除 (${d.name})`,
      next: Option.none,
    });
  };
  return (
    <div>
      <ScreenTitle
        eyebrow="Marketplace"
        title="ソリューションのデプロイ"
        trailing={
          <PrimaryButton onClick={() => handlers.changeScreen("marketplace")}>
            Marketplace を開く
          </PrimaryButton>
        }
      />
      {deployments.length === 0 ? (
        <p className="text-muted text-sm">
          デプロイしたソリューションはまだありません。Marketplace
          でプロダクトを探してデプロイしてください。
        </p>
      ) : (
        <ul className="grid gap-4">
          {deployments.map((d) => {
            const vm = vmOf(world, d);
            const ip = Option.flatMap(vm, (i) => {
              const nic = i.networkInterfaces[0];
              return nic === undefined ? Option.none : ExternalIp.address(nic.externalIP);
            });
            const solution = MarketplaceSolution.find(d.solution);
            return (
              <li key={`${d.location}/${d.name}`}>
                <section
                  aria-label={`デプロイ ${d.name}`}
                  className="rounded-lg border border-line bg-surface p-5"
                >
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p role="status" className="font-medium text-ok-ink">
                        ✓ {d.name} をデプロイしました
                      </p>
                      <p className="text-muted text-sm">
                        {Option.isSome(solution) ? solution.value.title : d.solution}・{d.location}
                      </p>
                    </div>
                    <SecondaryButton ariaLabel={`${d.name} を削除`} onClick={() => remove(d)}>
                      削除
                    </SecondaryButton>
                  </div>
                  <dl className="grid grid-cols-[10rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                    <dt className="text-muted">サイトのアドレス</dt>
                    <dd className="font-mono">
                      {Option.isSome(ip) ? `http://${ip.value}/` : "（外部 IP なし）"}
                    </dd>
                    <dt className="text-muted">インスタンス</dt>
                    <dd>
                      {Option.isSome(vm) ? (
                        <TextButton onClick={() => handlers.changeScreen("vm-list")}>
                          {vm.value.name}
                        </TextButton>
                      ) : (
                        "（削除済み）"
                      )}
                    </dd>
                    <dt className="text-muted">外部 IP</dt>
                    <dd className="font-mono">{Option.unwrapOr(ip, "-")}</dd>
                    <dt className="text-muted">ゾーン</dt>
                    <dd>{Option.isSome(vm) ? vm.value.zone : "-"}</dd>
                    <dt className="text-muted">マシンタイプ</dt>
                    <dd>{Option.isSome(vm) ? vm.value.machineType : "-"}</dd>
                    <dt className="text-muted">作成したリソース</dt>
                    <dd className="whitespace-pre-line font-mono text-xs">
                      {d.resources.map((r) => `${r.type} ${r.name}`).join("\n")}
                    </dd>
                  </dl>
                </section>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
