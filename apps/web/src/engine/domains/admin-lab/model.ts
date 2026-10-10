import type { IamMember } from "@/engine/domains/iam-policy";
import type { World } from "@/engine/domains/world";
import { Decoder as D } from "@/utils/Decoder";
import { Result } from "@/utils/Result";

export const Constraints = [
  "storage.publicAccessPrevention",
  "iam.disableServiceAccountKeyCreation",
  "gcp.resourceLocations",
] as const;
export type OrgPolicy = Readonly<{
  scope: string;
  constraint: string;
  reset: boolean;
  enforce: boolean;
  inherit: boolean;
  allowed: readonly string[];
  denied: readonly string[];
}>;
export type IdentityUser = Readonly<{
  customer: string;
  email: string;
  givenName: string;
  familyName: string;
  active: boolean;
}>;
export type IdentityGroup = Readonly<{
  customer: string;
  email: string;
  displayName: string;
  members: readonly string[];
}>;
export type IdentityPool = Readonly<{
  kind: "workload" | "workforce";
  owner: string;
  name: string;
  disabled: boolean;
}>;
export type IdentityProvider = Readonly<{
  kind: "workload" | "workforce";
  owner: string;
  pool: string;
  name: string;
  issuer: string;
  audiences: readonly string[];
  clientId: string;
  disabled: boolean;
}>;
export type ShortCredential = Readonly<{
  id: string;
  projectId: string;
  subject: string;
  caller: string;
  method: "impersonation" | "workload" | "workforce";
  created: string;
  expires: string;
}>;
export type QuotaPreference = Readonly<{
  scope: string;
  name: string;
  service: string;
  quotaId: string;
  region: string;
  preferred: number;
  granted: number;
  reconciling: boolean;
  email: string;
}>;
export type BillingExport = Readonly<{
  billingAccountId: string;
  projectId: string;
  dataset: string;
  location: string;
  enabled: boolean;
}>;
export type AdminObservation = Readonly<{
  projectId: string;
  kind: string;
  resource: string;
  result: string;
  value: number;
}>;
export type AdminLab = Readonly<{
  policies: readonly OrgPolicy[];
  users: readonly IdentityUser[];
  groups: readonly IdentityGroup[];
  pools: readonly IdentityPool[];
  providers: readonly IdentityProvider[];
  credentials: readonly ShortCredential[];
  quotas: readonly QuotaPreference[];
  exports: readonly BillingExport[];
  observations: readonly AdminObservation[];
}>;
export const emptyAdminLab = (): AdminLab => ({
  policies: [],
  users: [],
  groups: [],
  pools: [],
  providers: [],
  credentials: [],
  quotas: [],
  exports: [],
  observations: [],
});
export const patchAdmin = (world: World, change: Partial<AdminLab>): World => ({
  ...world,
  adminLab: { ...world.adminLab, ...change },
});
export const observeAdmin = (world: World, item: AdminObservation): World =>
  patchAdmin(world, {
    observations: [
      ...world.adminLab.observations.filter(
        (o) =>
          !(o.projectId === item.projectId && o.kind === item.kind && o.resource === item.resource),
      ),
      item,
    ],
  });
export const identitySubjects = (world: World, subject: IamMember): readonly IamMember[] => {
  if (!subject.startsWith("user:")) {
    return [subject];
  }
  const email = subject.slice(5);
  if (world.adminLab.users.some((u) => u.email === email && !u.active)) {
    return [];
  }
  return [
    subject,
    ...world.adminLab.groups
      .filter((g) => g.members.includes(email))
      .map((g): IamMember => `group:${g.email}`),
  ];
};
export const validPoolId = (kind: IdentityPool["kind"], id: string): boolean => {
  if (id.startsWith("gcp-")) {
    return false;
  }
  if (kind === "workforce") {
    return /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(id);
  }
  return /^[a-z0-9-]{4,32}$/.test(id);
};
export const validProviderId = (id: string): boolean =>
  !id.startsWith("gcp-") && /^[a-z0-9-]{4,32}$/.test(id);
export const validScope = (world: World, scope: string): boolean => {
  const [kind, id, extra] = scope.split("/");
  if (extra || !id) {
    return false;
  }
  if (kind === "organizations") {
    return id === world.organization.id;
  }
  if (kind === "folders") {
    return world.folders.some((f) => f.id === id);
  }
  return (
    kind === "projects" &&
    world.projects.some((p) => p.projectId === id && p.lifecycleState === "ACTIVE")
  );
};
export const validateAdminLab = (world: World): Result<World, string> => {
  const l = world.adminLab;
  const error = (s: string) => Result.err(`Administration: ${s}`);
  const unique = (ids: readonly string[]) => new Set(ids).size === ids.length;
  if (
    !unique(l.policies.map((p) => `${p.scope}/${p.constraint}`)) ||
    !unique(l.users.map((u) => u.email)) ||
    !unique(l.groups.map((g) => g.email)) ||
    !unique(l.pools.map((p) => `${p.kind}/${p.owner}/${p.name}`)) ||
    !unique(l.providers.map((p) => `${p.kind}/${p.owner}/${p.pool}/${p.name}`)) ||
    !unique(l.credentials.map((c) => c.id)) ||
    !unique(l.quotas.map((q) => `${q.scope}/${q.name}`)) ||
    !unique(l.quotas.map((q) => `${q.scope}/${q.service}/${q.quotaId}/${q.region}`)) ||
    !unique(l.exports.map((e) => e.billingAccountId))
  ) {
    return error("duplicate resource.");
  }
  const locationValue = (s: string) => /^is:[a-z][a-z0-9-]*$/.test(s);
  for (const p of l.policies) {
    if (
      !validScope(world, p.scope) ||
      !Constraints.some((c) => c === p.constraint) ||
      (p.reset && (p.enforce || p.inherit || p.allowed.length > 0 || p.denied.length > 0)) ||
      (p.constraint !== "gcp.resourceLocations" &&
        (p.inherit || p.allowed.length > 0 || p.denied.length > 0)) ||
      (p.constraint === "gcp.resourceLocations" &&
        (p.enforce ||
          (!p.reset && p.allowed.length + p.denied.length === 0) ||
          ![...p.allowed, ...p.denied].every(locationValue)))
    ) {
      return error("invalid organization policy.");
    }
  }
  const email = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  if (
    l.users.some(
      (u) => !email(u.email) || u.customer !== "C01simulator" || !u.givenName || !u.familyName,
    ) ||
    l.groups.some(
      (g) =>
        !email(g.email) ||
        g.customer !== "C01simulator" ||
        !unique(g.members) ||
        g.members.some((m) => !l.users.some((u) => u.email === m && u.customer === g.customer)),
    )
  ) {
    return error("invalid identity user/group membership.");
  }
  for (const p of l.pools) {
    const scope = p.kind === "workload" ? `projects/${p.owner}` : `organizations/${p.owner}`;
    if (!validScope(world, scope) || !validPoolId(p.kind, p.name)) {
      return error("invalid federation pool.");
    }
  }
  for (const p of l.providers) {
    let issuer: URL;
    try {
      issuer = new URL(p.issuer);
    } catch {
      return error("invalid OIDC issuer.");
    }
    if (
      issuer.protocol !== "https:" ||
      issuer.username ||
      issuer.password ||
      issuer.search ||
      issuer.hash ||
      !validProviderId(p.name) ||
      !l.pools.some(
        (pool) => pool.kind === p.kind && pool.owner === p.owner && pool.name === p.pool,
      ) ||
      (p.kind === "workforce" && (!p.clientId || p.audiences.length > 0)) ||
      (p.kind === "workload" && p.clientId !== "") ||
      !unique(p.audiences)
    ) {
      return error("invalid OIDC provider.");
    }
  }
  for (const c of l.credentials) {
    if (
      !world.projects.some((p) => p.projectId === c.projectId) ||
      !c.id.startsWith("SIMULATED-") ||
      !c.subject ||
      !c.caller ||
      !Number.isFinite(Date.parse(c.created)) ||
      !Number.isFinite(Date.parse(c.expires)) ||
      Date.parse(c.expires) <= Date.parse(c.created) ||
      Date.parse(c.expires) > Date.parse(c.created) + 3600000
    ) {
      return error("invalid short credential metadata.");
    }
  }
  for (const q of l.quotas) {
    if (
      !validScope(world, q.scope) ||
      !/^[a-z][a-z0-9-]{0,62}$/.test(q.name) ||
      q.service !== "compute.googleapis.com" ||
      q.quotaId !== "CpusPerProjectPerRegion" ||
      !["us-central1", "us-east1", "asia-northeast1"].includes(q.region) ||
      !Number.isSafeInteger(q.preferred) ||
      q.preferred < -1 ||
      q.preferred > 100000 ||
      !Number.isSafeInteger(q.granted) ||
      q.granted < 0 ||
      q.granted > 100000 ||
      !email(q.email)
    ) {
      return error("invalid quota preference.");
    }
  }
  for (const e of l.exports) {
    if (
      !world.billingAccounts.some((a) => a.id === e.billingAccountId) ||
      !world.dataProcessing.datasets.some(
        (d) => d.projectId === e.projectId && d.name === e.dataset && d.location === e.location,
      )
    ) {
      return error("invalid billing export dataset.");
    }
  }
  if (
    l.observations.some(
      (o) =>
        !world.projects.some((p) => p.projectId === o.projectId) ||
        !o.kind ||
        !o.resource ||
        !Number.isFinite(o.value),
    )
  ) {
    return error("invalid administration observation.");
  }
  return Result.ok(world);
};
const str = D.string;
const kind = D.literal(["workload", "workforce"]);
export const adminLabDecoder = D.object<AdminLab>({
  policies: D.array(
    D.object<OrgPolicy>({
      scope: str,
      constraint: str,
      reset: D.boolean,
      enforce: D.boolean,
      inherit: D.boolean,
      allowed: D.array(str),
      denied: D.array(str),
    }),
  ),
  users: D.array(
    D.object<IdentityUser>({
      customer: str,
      email: str,
      givenName: str,
      familyName: str,
      active: D.boolean,
    }),
  ),
  groups: D.array(
    D.object<IdentityGroup>({ customer: str, email: str, displayName: str, members: D.array(str) }),
  ),
  pools: D.array(D.object<IdentityPool>({ kind, owner: str, name: str, disabled: D.boolean })),
  providers: D.array(
    D.object<IdentityProvider>({
      kind,
      owner: str,
      pool: str,
      name: str,
      issuer: str,
      audiences: D.array(str),
      clientId: str,
      disabled: D.boolean,
    }),
  ),
  credentials: D.array(
    D.object<ShortCredential>({
      id: str,
      projectId: str,
      subject: str,
      caller: str,
      method: D.literal(["impersonation", "workload", "workforce"]),
      created: str,
      expires: str,
    }),
  ),
  quotas: D.array(
    D.object<QuotaPreference>({
      scope: str,
      name: str,
      service: str,
      quotaId: str,
      region: str,
      preferred: D.number,
      granted: D.number,
      reconciling: D.boolean,
      email: str,
    }),
  ),
  exports: D.array(
    D.object<BillingExport>({
      billingAccountId: str,
      projectId: str,
      dataset: str,
      location: str,
      enabled: D.boolean,
    }),
  ),
  observations: D.array(
    D.object<AdminObservation>({
      projectId: str,
      kind: str,
      resource: str,
      result: str,
      value: D.number,
    }),
  ),
});
