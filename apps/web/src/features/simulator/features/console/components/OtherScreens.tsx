import { type ReactElement, useState } from "react";

import { StorageClasses } from "@/engine/domains/catalog";
import { ProtocolRule } from "@/engine/domains/compute";
import { CloudRunService } from "@/engine/domains/managed-services";
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
import {
  BucketCreateForm,
  BudgetCreateForm,
  FirewallCreateForm,
} from "@/features/simulator/features/console/domains/equivalent-command";
import type { ScreenProps } from "@/features/simulator/features/console/types/screen-props";
import { Option } from "@/utils/Option";

/** お支払い › 予算とアラート: 請求アカウントごとの予算の一覧と作成。 */
export const BudgetsScreen = (props: ScreenProps): ReactElement => {
  const { world, projectId, actions } = props;
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<BudgetCreateForm>(BudgetCreateForm.initial);
  const [submitted, setSubmitted] = useState(false);
  const account = world.billingAccounts[0];
  const errors = submitted ? BudgetCreateForm.validate(form) : {};
  const command = account === undefined ? "" : BudgetCreateForm.toCommand(form, account.id);
  const create = (): void => {
    setSubmitted(true);
    if (!BudgetCreateForm.isValid(form) || account === undefined) return;
    actions.submit({ line: command, note: `予算を作成 (${form.displayName})`, next: Option.none });
    setCreating(false);
    setSubmitted(false);
    setForm(BudgetCreateForm.initial());
  };
  const toggleThreshold = (t: number): void =>
    setForm((f) => ({
      ...f,
      thresholds: f.thresholds.includes(t)
        ? f.thresholds.filter((x) => x !== t)
        : [...f.thresholds, t].toSorted((a, b) => a - b),
    }));
  return (
    <div>
      <ScreenTitle
        eyebrow={`お支払い › ${account?.displayName ?? "請求アカウント"}`}
        title="予算とアラート"
        actions={
          <PrimaryButton onClick={() => setCreating(true)} disabled={account === undefined}>
            予算を作成
          </PrimaryButton>
        }
      />
      <OutcomeBanner
        outcome={props.outcome}
        onEnableApi={() => {}}
        onDismiss={props.onOutcomeDismiss}
      />
      {creating && account !== undefined && (
        <section
          className="mb-4 rounded-lg border border-line bg-surface p-4"
          aria-label="予算を作成"
        >
          <div className="grid grid-cols-2 gap-4">
            <Field label="名前" error={errors.displayName}>
              {(id) => (
                <input
                  id={id}
                  className={inputClass}
                  value={form.displayName}
                  onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                />
              )}
            </Field>
            <Field label="予算額（JPY）" error={errors.amount}>
              {(id) => (
                <input
                  id={id}
                  className={inputClass}
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                />
              )}
            </Field>
            <fieldset>
              <legend className="mb-1 block font-medium text-sm">しきい値</legend>
              <div className="flex gap-4 text-sm">
                {[0.5, 0.9, 1].map((t) => (
                  <label key={t} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={form.thresholds.includes(t)}
                      onChange={() => toggleThreshold(t)}
                    />
                    {Math.round(t * 100)}%
                  </label>
                ))}
              </div>
            </fieldset>
            <Field label="対象プロジェクト" hint="選ばなければアカウント全体">
              {(id) => (
                <select
                  id={id}
                  className={inputClass}
                  value={form.projectIds[0] ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      projectIds: e.target.value === "" ? [] : [e.target.value],
                    }))
                  }
                >
                  <option value="">すべてのプロジェクト</option>
                  {World.activeProjects(world).map((p) => (
                    <option key={p.projectId} value={p.projectId}>
                      {p.projectId}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <EquivalentCommandPanel
            command={command}
            onCopy={actions.copy}
            onInsert={actions.insert}
          />
          <div className="mt-3 flex gap-2">
            <PrimaryButton onClick={create}>作成</PrimaryButton>
            <SecondaryButton onClick={() => setCreating(false)}>キャンセル</SecondaryButton>
          </div>
        </section>
      )}
      <DataTable
        label="予算"
        rows={account === undefined ? [] : World.budgetsOf(world, account.id)}
        keyOf={(b) => b.name}
        empty="予算はまだありません。"
        columns={[
          { header: "名前", cell: (b) => b.displayName },
          { header: "予算額", cell: (b) => `${b.amount.toLocaleString("ja-JP")} JPY` },
          {
            header: "しきい値",
            cell: (b) => b.thresholds.map((t) => `${Math.round(t * 100)}%`).join(" / "),
          },
          {
            header: "対象",
            cell: (b) => (b.projectIds.length === 0 ? "すべて" : b.projectIds.join(", ")),
          },
        ]}
      />
      <p className="mt-3 text-muted text-xs">対象プロジェクト: {projectId}（core/project）</p>
    </div>
  );
};

/** VPC ネットワーク › ファイアウォール: 一覧と作成。 */
export const FirewallScreen = (props: ScreenProps): ReactElement => {
  const { world, projectId, actions } = props;
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FirewallCreateForm>(FirewallCreateForm.initial);
  const [submitted, setSubmitted] = useState(false);
  const errors = submitted ? FirewallCreateForm.validate(form) : {};
  const command = FirewallCreateForm.toCommand(form, projectId);
  const set = <K extends keyof FirewallCreateForm>(key: K, value: FirewallCreateForm[K]): void =>
    setForm((f) => ({ ...f, [key]: value }));
  const create = (): void => {
    setSubmitted(true);
    if (!FirewallCreateForm.isValid(form)) return;
    actions.submit({
      line: command,
      note: `ファイアウォールルールを作成 (${form.name})`,
      next: Option.none,
    });
    setCreating(false);
    setSubmitted(false);
    setForm(FirewallCreateForm.initial());
  };
  return (
    <div>
      <ScreenTitle
        eyebrow="VPC ネットワーク"
        title="ファイアウォール"
        actions={
          <PrimaryButton onClick={() => setCreating(true)}>
            ファイアウォール ルールを作成
          </PrimaryButton>
        }
      />
      <OutcomeBanner
        outcome={props.outcome}
        onEnableApi={() => {}}
        onDismiss={props.onOutcomeDismiss}
      />
      {creating && (
        <section
          className="mb-4 rounded-lg border border-line bg-surface p-4"
          aria-label="ファイアウォール ルールを作成"
        >
          <div className="grid grid-cols-3 gap-4">
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
            <Field label="ネットワーク">
              {(id) => (
                <select
                  id={id}
                  className={inputClass}
                  value={form.network}
                  onChange={(e) => set("network", e.target.value)}
                >
                  {World.networksOf(world, projectId).map((n) => (
                    <option key={n.name} value={n.name}>
                      {n.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="トラフィックの方向">
              {(id) => (
                <select
                  id={id}
                  className={inputClass}
                  value={form.direction}
                  onChange={(e) =>
                    set("direction", e.target.value === "EGRESS" ? "EGRESS" : "INGRESS")
                  }
                >
                  <option value="INGRESS">上り（内向き）</option>
                  <option value="EGRESS">下り（外向き）</option>
                </select>
              )}
            </Field>
            <Field label="優先度" error={errors.priority}>
              {(id) => (
                <input
                  id={id}
                  className={inputClass}
                  value={form.priority}
                  onChange={(e) => set("priority", e.target.value)}
                />
              )}
            </Field>
            <Field label="ターゲットタグ" hint="空ならすべてのインスタンス">
              {(id) => (
                <input
                  id={id}
                  className={inputClass}
                  value={form.targetTags}
                  onChange={(e) => set("targetTags", e.target.value)}
                />
              )}
            </Field>
            <Field label="送信元 IPv4 範囲">
              {(id) => (
                <input
                  id={id}
                  className={inputClass}
                  value={form.sourceRanges}
                  onChange={(e) => set("sourceRanges", e.target.value)}
                />
              )}
            </Field>
            <Field
              label="プロトコルとポート"
              error={errors.protocolsAndPorts}
              hint="tcp:80,tcp:443,icmp"
            >
              {(id) => (
                <input
                  id={id}
                  className={inputClass}
                  value={form.protocolsAndPorts}
                  onChange={(e) => set("protocolsAndPorts", e.target.value)}
                />
              )}
            </Field>
            <Field label="一致したときのアクション">
              {(id) => (
                <select
                  id={id}
                  className={inputClass}
                  value={form.action}
                  onChange={(e) => set("action", e.target.value === "DENY" ? "DENY" : "ALLOW")}
                >
                  <option value="ALLOW">許可</option>
                  <option value="DENY">拒否</option>
                </select>
              )}
            </Field>
          </div>
          <EquivalentCommandPanel
            command={command}
            onCopy={actions.copy}
            onInsert={actions.insert}
          />
          <div className="mt-3 flex gap-2">
            <PrimaryButton onClick={create}>作成</PrimaryButton>
            <SecondaryButton onClick={() => setCreating(false)}>キャンセル</SecondaryButton>
          </div>
        </section>
      )}
      <DataTable
        label="ファイアウォール ルール"
        rows={World.firewallRulesOf(world, projectId)}
        keyOf={(r) => r.name}
        empty="ルールはありません。"
        columns={[
          { header: "名前", cell: (r) => <span className="font-mono">{r.name}</span> },
          { header: "ネットワーク", cell: (r) => r.network },
          { header: "方向", cell: (r) => r.direction },
          { header: "優先度", cell: (r) => String(r.priority) },
          {
            header: "ターゲット",
            cell: (r) => (r.targetTags.length === 0 ? "すべて" : r.targetTags.join(", ")),
          },
          { header: "送信元", cell: (r) => r.sourceRanges.join(", ") || "-" },
          {
            header: "プロトコル / ポート",
            cell: (r) =>
              r.allowed.length > 0
                ? `許可: ${r.allowed.map(ProtocolRule.toText).join(", ")}`
                : `拒否: ${r.denied.map(ProtocolRule.toText).join(", ")}`,
          },
        ]}
      />
    </div>
  );
};

/** VPC ネットワーク › サブネット: 一覧。 */
export const SubnetsScreen = (props: ScreenProps): ReactElement => (
  <div>
    <ScreenTitle eyebrow="VPC ネットワーク" title="サブネット" />
    <DataTable
      label="サブネット"
      rows={World.subnetsOf(props.world, props.projectId)}
      keyOf={(s) => `${s.region}/${s.name}`}
      empty="サブネットはありません。"
      columns={[
        { header: "名前", cell: (s) => <span className="font-mono">{s.name}</span> },
        { header: "リージョン", cell: (s) => s.region },
        { header: "ネットワーク", cell: (s) => s.network },
        { header: "IP 範囲", cell: (s) => <span className="font-mono">{s.ipCidrRange}</span> },
        {
          header: "限定公開の Google アクセス",
          cell: (s) => (s.privateIpGoogleAccess ? "オン" : "オフ"),
        },
      ]}
    />
  </div>
);

/** Cloud Storage › バケット: 一覧と作成。 */
export const BucketsScreen = (props: ScreenProps): ReactElement => {
  const { world, projectId, actions } = props;
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<BucketCreateForm>(BucketCreateForm.initial);
  const [submitted, setSubmitted] = useState(false);
  const errors = submitted ? BucketCreateForm.validate(form) : {};
  const command = BucketCreateForm.toCommand(form, projectId);
  const set = <K extends keyof BucketCreateForm>(key: K, value: BucketCreateForm[K]): void =>
    setForm((f) => ({ ...f, [key]: value }));
  const create = (): void => {
    setSubmitted(true);
    if (!BucketCreateForm.isValid(form)) return;
    actions.submit({ line: command, note: `バケットを作成 (${form.name})`, next: Option.none });
    setCreating(false);
    setSubmitted(false);
    setForm(BucketCreateForm.initial());
  };
  return (
    <div>
      <ScreenTitle
        eyebrow="Cloud Storage"
        title="バケット"
        actions={<PrimaryButton onClick={() => setCreating(true)}>作成</PrimaryButton>}
      />
      <OutcomeBanner
        outcome={props.outcome}
        onEnableApi={() => {}}
        onDismiss={props.onOutcomeDismiss}
      />
      {creating && (
        <section
          className="mb-4 rounded-lg border border-line bg-surface p-4"
          aria-label="バケットを作成"
        >
          <div className="grid grid-cols-3 gap-4">
            <Field label="名前" error={errors.name} hint="全世界で一意">
              {(id) => (
                <input
                  id={id}
                  className={inputClass}
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                />
              )}
            </Field>
            <Field label="ロケーション" error={errors.location}>
              {(id) => (
                <input
                  id={id}
                  className={inputClass}
                  value={form.location}
                  onChange={(e) => set("location", e.target.value.toUpperCase())}
                />
              )}
            </Field>
            <Field label="ストレージクラス" error={errors.storageClass}>
              {(id) => (
                <select
                  id={id}
                  className={inputClass}
                  value={form.storageClass}
                  onChange={(e) => set("storageClass", e.target.value)}
                >
                  {Object.values(StorageClasses).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="アクセス制御">
              {(id) => (
                <select
                  id={id}
                  className={inputClass}
                  value={form.uniformAccess ? "uniform" : "fine"}
                  onChange={(e) => set("uniformAccess", e.target.value === "uniform")}
                >
                  <option value="uniform">均一</option>
                  <option value="fine">きめ細かい（ACL）</option>
                </select>
              )}
            </Field>
            <Field label="公開アクセスの防止">
              {(id) => (
                <select
                  id={id}
                  className={inputClass}
                  value={form.publicAccessPrevention ? "on" : "off"}
                  onChange={(e) => set("publicAccessPrevention", e.target.value === "on")}
                >
                  <option value="on">適用する</option>
                  <option value="off">適用しない</option>
                </select>
              )}
            </Field>
          </div>
          <EquivalentCommandPanel
            command={command}
            onCopy={actions.copy}
            onInsert={actions.insert}
          />
          <div className="mt-3 flex gap-2">
            <PrimaryButton onClick={create}>作成</PrimaryButton>
            <SecondaryButton onClick={() => setCreating(false)}>キャンセル</SecondaryButton>
          </div>
        </section>
      )}
      <DataTable
        label="バケット"
        rows={World.bucketsOf(world, projectId)}
        keyOf={(b) => b.name}
        empty="バケットはまだありません。"
        columns={[
          { header: "名前", cell: (b) => <span className="font-mono">{b.name}</span> },
          { header: "ロケーション", cell: (b) => b.location },
          { header: "デフォルトのストレージクラス", cell: (b) => b.storageClass },
          {
            header: "アクセス制御",
            cell: (b) => (b.uniformBucketLevelAccess ? "均一" : "きめ細かい"),
          },
          { header: "オブジェクト", cell: (b) => String(b.objects.length) },
        ]}
      />
    </div>
  );
};

/** Kubernetes Engine › クラスタ: 一覧。 */
export const ClustersScreen = (props: ScreenProps): ReactElement => (
  <div>
    <ScreenTitle eyebrow="Kubernetes Engine" title="クラスタ" />
    <DataTable
      label="クラスタ"
      rows={World.clustersOf(props.world, props.projectId)}
      keyOf={(c) => c.name}
      empty="クラスタはまだありません。gcloud container clusters create で作れます。"
      columns={[
        { header: "名前", cell: (c) => <span className="font-mono">{c.name}</span> },
        { header: "ロケーション", cell: (c) => c.location },
        { header: "モード", cell: (c) => (c.autopilot ? "Autopilot" : "Standard") },
        { header: "ノード数", cell: (c) => (c.autopilot ? "自動" : String(c.nodeCount)) },
        {
          header: "バージョン",
          cell: (c) => <span className="font-mono text-xs">{c.currentMasterVersion}</span>,
        },
        { header: "状態", cell: (c) => c.status },
      ]}
    />
  </div>
);

/** Cloud Run › サービス: 一覧。 */
export const RunServicesScreen = (props: ScreenProps): ReactElement => (
  <div>
    <ScreenTitle eyebrow="Cloud Run" title="サービス" />
    <DataTable
      label="Cloud Run サービス"
      rows={World.runServicesOf(props.world, props.projectId)}
      keyOf={(s) => s.name}
      empty="サービスはまだありません。gcloud run deploy で作れます。"
      columns={[
        { header: "名前", cell: (s) => <span className="font-mono">{s.name}</span> },
        { header: "リージョン", cell: (s) => s.region },
        {
          header: "URL",
          cell: (s) => <span className="font-mono text-xs">{CloudRunService.url(s)}</span>,
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
