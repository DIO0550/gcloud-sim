import type { ReactElement } from "react";

import { Budget } from "@/engine/domains/billing-budget";
import { CustomRole } from "@/engine/domains/role-catalog";
import { World } from "@/engine/domains/world";
import {
  Absent,
  Empty,
  IamSection,
  joined,
  NotFound,
  PolicyTable,
  Section,
  type SelectionProps,
} from "@/features/simulator/components/PropertyParts";
import { Option } from "@/utils/Option";

/** 組織・フォルダ・プロジェクト・請求・IAM まわりのプロパティ（UC-007）。 */

export const OrganizationProperties = ({ world }: SelectionProps<"organization">): ReactElement => (
  <>
    <Section
      title="基本"
      rows={[
        { label: "id", value: world.organization.id },
        { label: "displayName", value: world.organization.displayName },
      ]}
    />
    <IamSection world={world} target={{ type: "organization", id: world.organization.id }} />
  </>
);

export const FolderProperties = ({ world, selection }: SelectionProps<"folder">): ReactElement => {
  const folder = World.findFolder(world, selection.id);
  if (!Option.isSome(folder)) return <NotFound what="フォルダ" />;
  return (
    <>
      <Section
        title="基本"
        rows={[
          { label: "id", value: folder.value.id },
          { label: "displayName", value: folder.value.displayName },
          { label: "parent", value: `${folder.value.parent.type}/${folder.value.parent.id}` },
        ]}
      />
      <IamSection world={world} target={{ type: "folder", id: folder.value.id }} />
    </>
  );
};

export const ProjectProperties = ({
  world,
  selection,
}: SelectionProps<"project">): ReactElement => {
  const project = World.findProject(world, selection.projectId);
  if (!Option.isSome(project)) return <NotFound what="プロジェクト" />;
  const p = project.value;
  return (
    <>
      <Section
        title="基本"
        rows={[
          { label: "projectId", value: p.projectId },
          { label: "name", value: p.name },
          { label: "projectNumber", value: p.projectNumber },
          { label: "lifecycleState", value: p.lifecycleState },
          { label: "parent", value: `${p.parent.type}/${p.parent.id}` },
          { label: "createTime", value: p.createTime },
        ]}
      />
      <Section
        title="請求"
        rows={[{ label: "billingAccount", value: Option.unwrapOr(p.billingAccountId, "未リンク") }]}
      />
      <Section
        title="有効な API"
        rows={
          p.enabledApis.length === 0
            ? [{ label: Empty, value: "gcloud services enable で有効化" }]
            : p.enabledApis.map((api) => ({ label: api.split(".")[0] ?? api, value: api }))
        }
      />
    </>
  );
};

export const BillingProperties = ({
  world,
  selection,
}: SelectionProps<"billing">): ReactElement => {
  const account = World.findBillingAccount(world, selection.id);
  if (!Option.isSome(account)) return <NotFound what="請求アカウント" />;
  const linked = world.projects
    .filter((p) => Option.isSome(p.billingAccountId) && p.billingAccountId.value === selection.id)
    .map((p) => p.projectId);
  return (
    <Section
      title="基本"
      rows={[
        { label: "id", value: account.value.id },
        { label: "displayName", value: account.value.displayName },
        { label: "open", value: String(account.value.open) },
        { label: "linked projects", value: joined(linked) },
        { label: "budgets", value: String(World.budgetsOf(world, selection.id).length) },
      ]}
    />
  );
};

export const BudgetProperties = ({ world, selection }: SelectionProps<"budget">): ReactElement => {
  const budget = World.budgetsOf(world, selection.billingAccountId).find(
    (b) => Budget.id(b) === selection.id,
  );
  if (budget === undefined) return <NotFound what="予算" />;
  return (
    <Section
      title="基本"
      rows={[
        { label: "name", value: budget.name },
        { label: "displayName", value: budget.displayName },
        { label: "amount", value: `${budget.amount} JPY` },
        { label: "thresholds", value: budget.thresholds.map((t) => `${t * 100}%`).join(", ") },
        {
          label: "projects",
          value: budget.projectIds.length === 0 ? "(アカウント全体)" : budget.projectIds.join(", "),
        },
        { label: "createTime", value: budget.createTime },
      ]}
    />
  );
};

export const ServiceAccountProperties = ({
  world,
  selection,
}: SelectionProps<"service-account">): ReactElement => {
  const account = World.findServiceAccount(world, selection.email);
  if (!Option.isSome(account)) return <NotFound what="サービスアカウント" />;
  const keys = World.keysOf(world, selection.email);
  return (
    <>
      <Section
        title="基本"
        rows={[
          { label: "email", value: account.value.email },
          { label: "displayName", value: account.value.displayName },
          { label: "uniqueId", value: account.value.uniqueId },
        ]}
      />
      <Section
        title="鍵"
        rows={
          keys.length === 0
            ? [{ label: Empty, value: "iam service-accounts keys create で作成" }]
            : keys.map((k) => ({ label: k.keyId.slice(0, 8), value: `${k.file} · ${k.keyType}` }))
        }
      />
      <IamSection world={world} target={{ type: "service-account", id: account.value.email }} />
    </>
  );
};

export const CustomRoleProperties = ({
  world,
  selection,
}: SelectionProps<"custom-role">): ReactElement => {
  const role = World.findCustomRoleById(world, selection.projectId, selection.roleId);
  if (!Option.isSome(role)) return <NotFound what="ロール" />;
  const r = role.value;
  return (
    <>
      <Section
        title="基本"
        rows={[
          { label: "name", value: CustomRole.name(r) },
          { label: "title", value: r.title },
          { label: "description", value: r.description || Absent },
          { label: "stage", value: r.stage },
        ]}
      />
      <Section
        title="権限"
        rows={r.includedPermissions.map((p) => ({ label: p.split(".")[0] ?? p, value: p }))}
      />
    </>
  );
};

export const IamProperties = ({ world, selection }: SelectionProps<"iam">): ReactElement => (
  <PolicyTable world={world} target={selection.target} />
);
