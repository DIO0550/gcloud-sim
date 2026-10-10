import { identitySubjects } from "@/engine/domains/admin-lab/model";
import type { ApiName } from "@/engine/domains/catalog";
import { EffectivePermissions } from "@/engine/domains/effective-permissions";
import { type IamMember, IamPolicy } from "@/engine/domains/iam-policy";
import { RoleCatalog } from "@/engine/domains/role-catalog";
import { ServiceAccount } from "@/engine/domains/service-account";
import type { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";
import {
  type Delivery,
  type Deployment,
  defaultConfig,
  type Event,
  type EventFilter,
  emptyLab,
  type Invocation,
  latestRevision,
  putDeployment,
  type RuntimeConfig,
  sameId,
  targetId,
} from "./model";

export const apiEnabled = (world: World, projectId: string, api: ApiName): boolean =>
  world.projects.some((p) => p.projectId === projectId && p.enabledApis.includes(api));
export const principalMember = (principal: string): IamMember => {
  if (principal.startsWith("principal://iam.googleapis.com/")) {
    return principal as IamMember;
  }
  if (principal === "anonymous") {
    return "allUsers";
  }
  if (principal.endsWith("gserviceaccount.com")) {
    return `serviceAccount:${principal}`;
  }
  return `user:${principal}`;
};
export const allows = (
  world: World,
  projectId: string,
  principal: string,
  permission: string,
  policy: IamPolicy = IamPolicy.Empty,
): boolean => {
  if (principal === "anonymous") {
    return policy.bindings
      .filter((b) => b.members.includes("allUsers"))
      .some((b) =>
        Option.unwrapOr(
          Option.map(RoleCatalog.find(b.role), (role) =>
            role.includedPermissions.includes(permission),
          ),
          false,
        ),
      );
  }
  const member = principalMember(principal);
  const effective = EffectivePermissions.resolve(world, member, { type: "project", id: projectId });
  const direct = identitySubjects(world, member).flatMap((subject) =>
    IamPolicy.rolesOf(policy, subject),
  );
  return (
    effective.permissions.has(permission) ||
    direct.some((r) => {
      const predefined = RoleCatalog.find(r);
      if (predefined.some) {
        return predefined.value.includedPermissions.includes(permission);
      }
      return world.customRoles.some(
        (role) =>
          `projects/${role.projectId}/roles/${role.roleId}` === r &&
          role.stage !== "DISABLED" &&
          role.includedPermissions.includes(permission),
      );
    })
  );
};
export const accountExists = (world: World, projectId: string, email: string): boolean => {
  const project = world.projects.find((p) => p.projectId === projectId);
  if (!project) {
    return false;
  }
  return (
    email === ServiceAccount.defaultComputeEmail(project.projectNumber) ||
    world.serviceAccounts.some((s) => s.email === email && s.projectId === projectId)
  );
};
export const attachAccount = (
  world: World,
  projectId: string,
  principal: string,
  email: string,
): Result<string, string> => {
  if (!accountExists(world, projectId, email)) {
    return Result.err(`Runtime service account ${email} does not exist in this project.`);
  }
  const target = world.serviceAccounts.some((s) => s.email === email)
    ? { type: "service-account" as const, id: email }
    : { type: "project" as const, id: projectId };
  const effective = EffectivePermissions.resolve(world, principalMember(principal), target);
  if (!effective.permissions.has("iam.serviceAccounts.actAs")) {
    return Result.err(
      "Permission iam.serviceAccounts.actAs is required on the runtime service account.",
    );
  }
  return Result.ok(email);
};
export const dependencies = (world: World, d: Deployment, c: RuntimeConfig): string => {
  if (!accountExists(world, d.projectId, c.serviceAccount)) {
    return "Runtime service account is missing.";
  }
  if (c.connector) {
    if (!apiEnabled(world, d.projectId, "vpcaccess.googleapis.com")) {
      return "VPC Access API is disabled.";
    }
    if (
      !world.serverlessLab.connectors.some(
        (r) => r.projectId === d.projectId && r.region === d.region && r.name === c.connector,
      )
    ) {
      return "VPC connector is missing or in a different region.";
    }
  }
  for (const ref of Object.values(c.secrets)) {
    if (!apiEnabled(world, d.projectId, "secretmanager.googleapis.com")) {
      return "Secret Manager API is disabled.";
    }
    const [name, version] = ref.split(":");
    const secret = world.serverlessLab.secrets.find(
      (s) => s.projectId === d.projectId && s.name === name,
    );
    if (!secret) {
      return "Secret is missing.";
    }
    const selected =
      version === "latest"
        ? secret.versions.at(-1)
        : secret.versions.find((v) => String(v.id) === version);
    if (selected?.state !== "ENABLED") {
      return "Secret version is missing, disabled or destroyed.";
    }
    if (
      !allows(world, d.projectId, c.serviceAccount, "secretmanager.versions.access", secret.policy)
    ) {
      return "Runtime SA lacks secretmanager.versions.access.";
    }
  }
  if (c.cmek) {
    if (!apiEnabled(world, d.projectId, "cloudkms.googleapis.com")) {
      return "Cloud KMS API is disabled.";
    }
    const key = world.serverlessLab.keys.find(
      (k) =>
        `projects/${k.projectId}/locations/${k.region}/keyRings/${k.ring}/cryptoKeys/${k.name}` ===
        c.cmek,
    );
    if (!key || key.projectId !== d.projectId || key.region !== d.region || !key.enabled) {
      return "CMEK is missing, disabled or in a different region.";
    }
    const project = world.projects.find((p) => p.projectId === d.projectId);
    if (!project) {
      return "Project is missing.";
    }
    const agent = `service-${project.projectNumber}@serverless-robot-prod.iam.gserviceaccount.com`;
    if (!allows(world, d.projectId, agent, "cloudkms.cryptoKeyVersions.useToDecrypt", key.policy)) {
      return "Cloud Run service agent lacks CMEK decrypt permission.";
    }
  }
  if (c.env.REDIS_INSTANCE) {
    if (!apiEnabled(world, d.projectId, "redis.googleapis.com")) {
      return "Redis API is disabled.";
    }
    const redis = world.serverlessLab.redis.find(
      (r) =>
        r.projectId === d.projectId && r.region === d.region && r.name === c.env.REDIS_INSTANCE,
    );
    const connector = world.serverlessLab.connectors.find(
      (r) => r.projectId === d.projectId && r.region === d.region && r.name === c.connector,
    );
    if (!redis || !connector || redis.network !== connector.network) {
      return "Redis requires a connector in the same region and authorized VPC network.";
    }
    if (c.env.REDIS_HOST && c.env.REDIS_HOST !== redis.host) {
      return "REDIS_HOST does not match the selected Redis instance.";
    }
  }
  if (c.env.FIRESTORE_DATABASE) {
    if (!apiEnabled(world, d.projectId, "firestore.googleapis.com")) {
      return "Firestore API is disabled.";
    }
    if (
      !world.serverlessLab.databases.some(
        (r) =>
          r.projectId === d.projectId &&
          r.name === c.env.FIRESTORE_DATABASE &&
          r.mode === "firestore-native",
      )
    ) {
      return "Firestore Native database is missing.";
    }
    if (!allows(world, d.projectId, c.serviceAccount, "datastore.entities.get")) {
      return "Runtime SA lacks datastore.entities.get.";
    }
  }
  return "";
};
export const invoke = (
  world: World,
  d: Deployment,
  principal: string,
  source: string,
  revision = "",
  eventId = "",
): { world: World; invocation: Invocation } => {
  const selected = revision
    ? d.revisions.find((r) => r.name === revision && (d.traffic[r.name] ?? 0) > 0)
    : d.revisions.find((r) => (d.traffic[r.name] ?? 0) > 0);
  let reason = "";
  if (!selected) {
    reason = "No serving revision (the requested revision must receive traffic).";
  }
  if (selected && selected.config.ingress !== "all" && source === "external") {
    reason = "Ingress blocks external callers.";
  }
  if (selected && selected.config.ingress === "internal" && source === "load-balancer") {
    reason = "Ingress requires an internal source.";
  }
  if (!allows(world, d.projectId, principal, "run.routes.invoke", d.policy)) {
    reason = "Permission run.routes.invoke is required (Gen2 uses Cloud Run Invoker).";
  }
  const api = d.kind === "function" ? "cloudfunctions.googleapis.com" : "run.googleapis.com";
  if (!apiEnabled(world, d.projectId, api)) {
    reason = `${api} is disabled.`;
  }
  if (!reason && selected) {
    reason = dependencies(world, d, selected.config);
  }
  if (!reason && selected?.config.env.SIM_FAIL === "true") {
    reason = "The lesson handler is configured to fail (SIM_FAIL=true).";
  }
  const invocation: Invocation = {
    principal,
    source,
    status: reason ? "FAILED" : "SUCCEEDED",
    reason: reason || "Lesson handler completed.",
    revision: selected?.name ?? "",
    eventId,
  };
  return {
    world: putDeployment(world, { ...d, invocations: [...d.invocations.slice(-99), invocation] }),
    invocation,
  };
};
export const filterMatches = (filter: EventFilter, event: Event): boolean => {
  if (filter.kind !== event.kind || filter.source !== event.source) {
    return false;
  }
  if (filter.eventType && filter.eventType !== event.eventType) {
    return false;
  }
  if (!filter.document) {
    return true;
  }
  const expected = filter.document.split("/");
  const actual = event.document.split("/");
  return (
    expected.length === actual.length &&
    expected.every((part, i) => /^\{[A-Za-z][A-Za-z0-9_]*\}$/.test(part) || part === actual[i])
  );
};
export const eventSourceError = (
  world: World,
  event: Pick<Event, "projectId" | "kind" | "source">,
): string => {
  const apis = {
    topic: "pubsub.googleapis.com",
    storage: "storage.googleapis.com",
    firestore: "firestore.googleapis.com",
  } as const;
  if (!apiEnabled(world, event.projectId, apis[event.kind])) {
    return `${apis[event.kind]} is disabled.`;
  }
  if (event.kind === "topic") {
    return world.pubsubTopics.some(
      (t) => t.projectId === event.projectId && t.name === event.source,
    )
      ? ""
      : "Event source topic is missing.";
  }
  if (event.kind === "storage") {
    return world.buckets.some((b) => b.projectId === event.projectId && b.name === event.source)
      ? ""
      : "Event source bucket is missing.";
  }
  return world.serverlessLab.databases.some(
    (d) =>
      d.projectId === event.projectId && d.name === event.source && d.mode === "firestore-native",
  )
    ? ""
    : "Event source Native database is missing.";
};
export const deliverEvent = (
  world: World,
  event: Event,
  mode: "new" | "retry" | "replay" = "new",
): World => {
  let next = world;
  const targets = world.serverlessLab.deployments
    .filter((d) => d.projectId === event.projectId && filterMatches(d.trigger, event))
    .map((d) => ({ d, principal: latestRevision(d).config.serviceAccount, trigger: false }));
  for (const t of world.serverlessLab.triggers.filter(
    (t) => t.projectId === event.projectId && filterMatches(t.filter, event),
  )) {
    const d = next.serverlessLab.deployments.find(
      (d) => d.name === t.target && d.kind === t.targetKind && sameId({ ...d, name: t.name }, t),
    );
    if (d) {
      targets.push({ d, principal: t.serviceAccount, trigger: true });
    }
  }
  for (const target of targets) {
    const d = next.serverlessLab.deployments.find((v) => targetId(v) === targetId(target.d));
    if (!d) {
      continue;
    }
    const id = targetId(d);
    const previous = next.serverlessLab.deliveries.find(
      (r) => r.eventId === event.id && r.target === id,
    );
    if (previous && mode === "new") {
      continue;
    }
    if (mode === "retry" && previous?.status !== "PENDING") {
      continue;
    }
    let result = invoke(next, d, target.principal, "internal", "", event.id);
    let deliveryReason = eventSourceError(next, event);
    if (target.trigger && !apiEnabled(next, d.projectId, "eventarc.googleapis.com")) {
      deliveryReason = "Eventarc API is disabled.";
    }
    if (
      target.trigger &&
      !allows(next, d.projectId, target.principal, "eventarc.events.receiveEvent")
    ) {
      deliveryReason = "Trigger SA lacks eventarc.events.receiveEvent.";
    }
    if (deliveryReason) {
      result = {
        world: next,
        invocation: {
          principal: target.principal,
          source: "internal",
          status: "FAILED",
          reason: deliveryReason,
          revision: latestRevision(d).name,
          eventId: event.id,
        },
      };
    }
    if (deliveryReason) {
      result = {
        ...result,
        world: putDeployment(next, {
          ...d,
          invocations: [...d.invocations.slice(-99), result.invocation],
        }),
      };
    }
    const config =
      d.revisions.find((r) => r.name === result.invocation.revision)?.config ??
      latestRevision(d).config;
    const duplicate = previous?.status === "SUCCEEDED";
    const deduplicated = duplicate && config.idempotent;
    const succeeded = result.invocation.status === "SUCCEEDED";
    let status: Delivery["status"] = "FAILED";
    if (d.retry || target.trigger) {
      status = "PENDING";
    }
    if (succeeded) {
      status = "SUCCEEDED";
    }
    const delivery = {
      eventId: event.id,
      target: id,
      attempts: (previous?.attempts ?? 0) + 1,
      status,
      reason: deduplicated
        ? "Duplicate event was ignored by the idempotent lesson handler."
        : result.invocation.reason,
      effects: (previous?.effects ?? 0) + (succeeded && !deduplicated ? 1 : 0),
      duplicates: (previous?.duplicates ?? 0) + (duplicate ? 1 : 0),
    };
    next = {
      ...result.world,
      serverlessLab: {
        ...result.world.serverlessLab,
        deliveries: [
          ...result.world.serverlessLab.deliveries.filter(
            (r) => !(r.eventId === event.id && r.target === id),
          ),
          delivery,
        ].slice(-2000),
      },
    };
  }
  return next;
};
export const publishEvent = (world: World, event: Omit<Event, "id">): World => {
  const id = `event-${world.sequence + 1}`;
  const nextEvent = { ...event, id };
  const next = {
    ...world,
    sequence: world.sequence + 1,
    serverlessLab: {
      ...world.serverlessLab,
      events: [...world.serverlessLab.events.slice(-199), nextEvent],
      deliveries: world.serverlessLab.deliveries.filter((d) =>
        world.serverlessLab.events.slice(-199).some((e) => e.id === d.eventId),
      ),
    },
  };
  return deliverEvent(next, nextEvent);
};

export const migrateServerless = (world: Readonly<Record<string, unknown>>): unknown => {
  const lab = emptyLab();
  const projects: Record<string, unknown>[] = Array.isArray(world.projects)
    ? world.projects.filter(
        (p): p is Record<string, unknown> => typeof p === "object" && p !== null,
      )
    : [];
  const services = Array.isArray(world.runServices) ? world.runServices : [];
  const functions = Array.isArray(world.functions) ? world.functions : [];
  const deployments = [
    ...services.map((s) => ({ s, kind: "run" as const })),
    ...functions.map((s) => ({ s, kind: "function" as const })),
  ].flatMap(({ s, kind }) => {
    if (typeof s !== "object" || s === null) {
      return [];
    }
    const r = s as Record<string, unknown>;
    const project = projects.find((p) => p.projectId === r.projectId);
    const config = defaultConfig(
      ServiceAccount.defaultComputeEmail(
        typeof project?.projectNumber === "string" ? project.projectNumber : "",
      ),
    );
    const rev = `${r.name}-00001-abc`;
    return [
      {
        projectId: r.projectId,
        name: r.name,
        region: r.region,
        kind,
        revisions: [
          {
            name: rev,
            image: r.image ?? r.runtime,
            config: { ...config, memoryMb: r.memoryMb ?? 256 },
          },
        ],
        traffic: { [rev]: 100 },
        policy: r.allowUnauthenticated
          ? IamPolicy.addBinding(IamPolicy.Empty, "roles/run.invoker", "allUsers")
          : IamPolicy.Empty,
        trigger:
          kind === "function" && r.trigger && (r.trigger as { kind: string }).kind === "topic"
            ? {
                kind: "topic",
                source: (r.trigger as { topic: string }).topic,
                eventType: "google.cloud.pubsub.topic.v1.messagePublished",
                document: "",
              }
            : { kind: "http", source: "", eventType: "", document: "" },
        retry: false,
        tasks: 1,
        invocations: [],
      },
    ];
  });
  return { ...world, serverlessLab: { ...lab, deployments } };
};

export const storageEvents = (before: World, after: World, line: string): World => {
  if (
    !/^gcloud\s+storage\s+(cp|rsync)\s/.test(line.trim()) ||
    before.buckets === after.buckets ||
    after.serverlessLab.deployments.length + after.serverlessLab.triggers.length === 0
  ) {
    return after;
  }
  let world = after;
  for (const bucket of after.buckets) {
    const previous = before.buckets.find((b) => b.name === bucket.name);
    for (const object of bucket.objects) {
      if (!previous?.objects.some((o) => o === object)) {
        world = publishEvent(world, {
          projectId: bucket.projectId,
          kind: "storage",
          source: bucket.name,
          document: object.name,
          eventType: "google.cloud.storage.object.v1.finalized",
        });
      }
    }
  }
  return world;
};
