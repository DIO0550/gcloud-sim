import type { Bucket } from "@/engine/domains/storage";
import type { World } from "@/engine/domains/world";
import type { OrgPolicy } from "./model";

export const scopeChain = (world: World, scope: string): readonly string[] => {
  const [kind, id] = scope.split("/");
  if (kind === "organizations") {
    return [scope];
  }
  const resource =
    kind === "projects"
      ? world.projects.find((p) => p.projectId === id)
      : world.folders.find((f) => f.id === id);
  if (!resource) {
    return [];
  }
  const parentKind = resource.parent.type === "organization" ? "organizations" : "folders";
  const result = [scope];
  let current = `${parentKind}/${resource.parent.id}`;
  for (let depth = 0; depth < 16; depth += 1) {
    if (result.includes(current)) {
      return [];
    }
    result.push(current);
    if (current.startsWith("organizations/")) {
      return result;
    }
    const folder = world.folders.find((f) => `folders/${f.id}` === current);
    if (!folder) {
      return [];
    }
    current = `${folder.parent.type === "organization" ? "organizations" : "folders"}/${folder.parent.id}`;
  }
  return [];
};
export const effectiveOrgPolicy = (world: World, scope: string, constraint: string): OrgPolicy => {
  const empty: OrgPolicy = {
    scope,
    constraint,
    reset: false,
    enforce: false,
    inherit: false,
    allowed: [],
    denied: [],
  };
  const direct = scopeChain(world, scope)
    .map((s) => world.adminLab.policies.find((p) => p.scope === s && p.constraint === constraint))
    .filter((p): p is OrgPolicy => p !== undefined);
  if (constraint !== "gcp.resourceLocations") {
    const nearest = direct[0];
    if (!nearest || nearest.reset) {
      return empty;
    }
    return { ...nearest, scope };
  }
  let allowed: readonly string[] = [];
  let denied: readonly string[] = [];
  for (const p of direct) {
    if (p.reset) {
      break;
    }
    allowed = [...new Set([...allowed, ...p.allowed])];
    denied = [...new Set([...denied, ...p.denied])];
    if (!p.inherit) {
      break;
    }
  }
  return { ...empty, allowed, denied };
};
export const papEnforced = (world: World, bucket: Bucket): boolean =>
  bucket.publicAccessPrevention ||
  effectiveOrgPolicy(world, `projects/${bucket.projectId}`, "storage.publicAccessPrevention")
    .enforce;

type Located = Readonly<{ id: string; projectId: string; location: string }>;
const located = (world: World): readonly Located[] => [
  ...world.aceSupport.resources.map((r) => ({
    id: `ai/${r.projectId}/${r.region}/${r.name}`,
    projectId: r.projectId,
    location: r.region,
  })),
  ...world.buckets.map((b) => ({
    id: `bucket/${b.name}`,
    projectId: b.projectId,
    location: b.location.toLowerCase(),
  })),
  ...world.instances.map((r) => ({
    id: `instance/${r.projectId}/${r.zone}/${r.name}`,
    projectId: r.projectId,
    location: r.zone,
  })),
  ...world.sqlInstances.map((r) => ({
    id: `sql/${r.projectId}/${r.name}`,
    projectId: r.projectId,
    location: r.region,
  })),
  ...world.clusters.map((r) => ({
    id: `gke/${r.projectId}/${r.location}/${r.name}`,
    projectId: r.projectId,
    location: r.location,
  })),
  ...world.serverlessLab.deployments.map((r) => ({
    id: `deployment/${r.kind}/${r.projectId}/${r.name}`,
    projectId: r.projectId,
    location: r.region,
  })),
  ...world.storageLab.files.map((r) => ({
    id: `files/${r.kind}/${r.projectId}/${r.name}`,
    projectId: r.projectId,
    location: r.location,
  })),
];
export const organizationViolation = (before: World, after: World): string => {
  for (const key of after.serviceAccountKeys) {
    if (before.serviceAccountKeys.some((k) => k.keyId === key.keyId)) {
      continue;
    }
    const projectId = after.serviceAccounts.find(
      (s) => s.email === key.serviceAccountEmail,
    )?.projectId;
    if (
      projectId &&
      effectiveOrgPolicy(after, `projects/${projectId}`, "iam.disableServiceAccountKeyCreation")
        .enforce
    ) {
      return "Organization policy iam.disableServiceAccountKeyCreation prevents external service-account key creation.";
    }
  }
  const previous = located(before);
  for (const resource of located(after)) {
    if (previous.some((r) => r.id === resource.id && r.location === resource.location)) {
      continue;
    }
    const policy = effectiveOrgPolicy(
      after,
      `projects/${resource.projectId}`,
      "gcp.resourceLocations",
    );
    const value = `is:${resource.location}`;
    if (
      policy.denied.includes(value) ||
      (policy.allowed.length > 0 && !policy.allowed.includes(value))
    ) {
      return `Organization policy gcp.resourceLocations rejects ${resource.location} for ${resource.id}. This lesson compares explicit is: locations.`;
    }
  }
  return "";
};
