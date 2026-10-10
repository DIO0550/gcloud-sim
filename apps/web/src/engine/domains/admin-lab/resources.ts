import type { World } from "@/engine/domains/world";
import type { AdminLab } from "./model";
export type AdminResource = Readonly<{
  collection: keyof AdminLab;
  name: string;
  label: string;
  resource: Readonly<Record<string, unknown>>;
}>;
export const adminResources = (world: World, scope: string): readonly AdminResource[] => {
  const l = world.adminLab;
  const projectId = scope.startsWith("projects/") ? scope.slice(9) : "";
  const org = scope === `organizations/${world.organization.id}`;
  const items: AdminResource[] = [
    ...l.policies
      .filter((r) => r.scope === scope)
      .map((resource) => ({
        collection: "policies" as const,
        name: resource.constraint,
        label: `組織ポリシー: ${resource.constraint}`,
        resource,
      })),
    ...l.quotas
      .filter((r) => r.scope === scope)
      .map((resource) => ({
        collection: "quotas" as const,
        name: resource.name,
        label: `CPUクォータ: ${resource.region}`,
        resource,
      })),
    ...l.pools
      .filter(
        (r) => (r.kind === "workforce" && org) || (r.kind === "workload" && r.owner === projectId),
      )
      .map((resource) => ({
        collection: "pools" as const,
        name: `${resource.kind}/${resource.name}`,
        label: `${resource.kind} pool: ${resource.name}`,
        resource,
      })),
    ...l.providers
      .filter(
        (r) => (r.kind === "workforce" && org) || (r.kind === "workload" && r.owner === projectId),
      )
      .map((resource) => ({
        collection: "providers" as const,
        name: `${resource.kind}/${resource.pool}/${resource.name}`,
        label: `OIDC provider: ${resource.pool}/${resource.name}`,
        resource,
      })),
  ];
  if (org) {
    items.push(
      ...l.users.map((resource) => ({
        collection: "users" as const,
        name: resource.email,
        label: `ユーザー: ${resource.email}`,
        resource,
      })),
      ...l.groups.map((resource) => ({
        collection: "groups" as const,
        name: resource.email,
        label: `グループ: ${resource.email}`,
        resource,
      })),
    );
  }
  if (projectId) {
    items.push(
      ...l.credentials
        .filter((r) => r.projectId === projectId)
        .map((resource) => ({
          collection: "credentials" as const,
          name: resource.id,
          label: `短期認証: ${resource.id}`,
          resource,
        })),
      ...l.exports
        .filter((r) => r.projectId === projectId)
        .map((resource) => ({
          collection: "exports" as const,
          name: resource.billingAccountId,
          label: `課金エクスポート: ${resource.dataset}`,
          resource,
        })),
      ...l.observations
        .filter((r) => r.projectId === projectId)
        .map((resource) => ({
          collection: "observations" as const,
          name: `${resource.kind}/${resource.resource}`,
          label: `評価: ${resource.kind} (${resource.result})`,
          resource,
        })),
    );
  }
  return items.toSorted((a, b) => a.label.localeCompare(b.label));
};
