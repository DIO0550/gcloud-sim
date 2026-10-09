import { Region } from "@/engine/domains/catalog";
import { ResourceName } from "@/engine/domains/compute";
import { Ipv4 } from "@/engine/domains/gke-control-plane";
import { IamMember, type IamPolicy, RoleName } from "@/engine/domains/iam-policy";
import { documentValue, firestoreLocations } from "@/engine/domains/managed-databases/model";
import type { World } from "@/engine/domains/world";
import { Decoder as D } from "@/utils/Decoder";
import { Result } from "@/utils/Result";

export type RuntimeConfig = Readonly<{
  env: Readonly<Record<string, string>>;
  minInstances: number;
  maxInstances: number;
  concurrency: number;
  cpu: number;
  memoryMb: number;
  timeoutSeconds: number;
  serviceAccount: string;
  ingress: "all" | "internal" | "internal-and-cloud-load-balancing";
  egress: "private-ranges-only" | "all-traffic";
  connector: string;
  secrets: Readonly<Record<string, string>>;
  cmek: string;
  idempotent: boolean;
}>;
export type ResourceId = Readonly<{ projectId: string; region: string; name: string }>;
export type TargetKind = "run" | "function" | "job";
export type Revision = Readonly<{ name: string; image: string; config: RuntimeConfig }>;
export type EventSource = "topic" | "storage" | "firestore";
export type EventFilter = Readonly<{
  kind: "http" | EventSource;
  source: string;
  eventType: string;
  document: string;
}>;
export type Invocation = Readonly<{
  principal: string;
  source: string;
  status: "SUCCEEDED" | "FAILED";
  reason: string;
  revision: string;
  eventId: string;
}>;
export type Deployment = ResourceId &
  Readonly<{
    kind: TargetKind;
    revisions: readonly Revision[];
    traffic: Readonly<Record<string, number>>;
    policy: IamPolicy;
    trigger: EventFilter;
    retry: boolean;
    tasks: number;
    invocations: readonly Invocation[];
  }>;
export type Connector = ResourceId & Readonly<{ network: string; range: string }>;
export type Redis = ResourceId & Readonly<{ network: string; sizeGb: number; host: string }>;
export type Database = ResourceId & Readonly<{ mode: "firestore-native" | "datastore-mode" }>;
export type Document = Readonly<{
  projectId: string;
  database: string;
  path: string;
  data: string;
  version: number;
}>;
export type SecretVersion = Readonly<{
  id: number;
  state: "ENABLED" | "DISABLED" | "DESTROYED";
  data: string;
}>;
export type Secret = ResourceId &
  Readonly<{ policy: IamPolicy; versions: readonly SecretVersion[] }>;
export type CryptoKey = ResourceId &
  Readonly<{ ring: string; enabled: boolean; policy: IamPolicy }>;
export type Trigger = ResourceId &
  Readonly<{
    target: string;
    targetKind: "run" | "function";
    serviceAccount: string;
    filter: EventFilter;
  }>;
export type Event = Readonly<{
  id: string;
  projectId: string;
  kind: EventSource;
  source: string;
  eventType: string;
  document: string;
}>;
export type Delivery = Readonly<{
  eventId: string;
  target: string;
  attempts: number;
  status: "SUCCEEDED" | "FAILED" | "PENDING";
  reason: string;
  effects: number;
  duplicates: number;
}>;
export type Workflow = ResourceId &
  Readonly<{ serviceAccount: string; steps: readonly string[]; executions: readonly Invocation[] }>;
export type ServerlessLab = Readonly<{
  deployments: readonly Deployment[];
  connectors: readonly Connector[];
  redis: readonly Redis[];
  databases: readonly Database[];
  documents: readonly Document[];
  secrets: readonly Secret[];
  keys: readonly CryptoKey[];
  triggers: readonly Trigger[];
  events: readonly Event[];
  deliveries: readonly Delivery[];
  workflows: readonly Workflow[];
}>;

export const emptyLab = (): ServerlessLab => ({
  deployments: [],
  connectors: [],
  redis: [],
  databases: [],
  documents: [],
  secrets: [],
  keys: [],
  triggers: [],
  events: [],
  deliveries: [],
  workflows: [],
});
export const defaultConfig = (serviceAccount: string): RuntimeConfig => ({
  env: {},
  minInstances: 0,
  maxInstances: 100,
  concurrency: 80,
  cpu: 1,
  memoryMb: 256,
  timeoutSeconds: 300,
  serviceAccount,
  ingress: "all",
  egress: "private-ranges-only",
  connector: "",
  secrets: {},
  cmek: "",
  idempotent: false,
});
export const sameId = (a: ResourceId, b: ResourceId): boolean =>
  a.projectId === b.projectId && a.region === b.region && a.name === b.name;
export const targetId = (d: ResourceId & { kind: TargetKind }): string =>
  `${d.projectId}/${d.region}/${d.kind}/${d.name}`;
export const findDeployment = (
  world: World,
  id: ResourceId,
  kind: TargetKind,
): Deployment | undefined =>
  world.serverlessLab.deployments.find((d) => d.kind === kind && sameId(d, id));
export const latestRevision = (d: Deployment): Revision => {
  const revision = d.revisions.at(-1);
  if (!revision) {
    throw new Error("Deployment must have at least one revision.");
  }
  return revision;
};
export const putDeployment = (world: World, d: Deployment): World => ({
  ...world,
  serverlessLab: {
    ...world.serverlessLab,
    deployments: [
      ...world.serverlessLab.deployments.filter((old) => targetId(old) !== targetId(d)),
      d,
    ],
  },
});
export const validConfig = (c: RuntimeConfig): boolean => {
  const integers = [c.minInstances, c.maxInstances, c.concurrency, c.memoryMb, c.timeoutSeconds];
  if (!integers.every(Number.isSafeInteger)) {
    return false;
  }
  if (
    c.minInstances < 0 ||
    c.minInstances > c.maxInstances ||
    c.maxInstances < 1 ||
    c.maxInstances > 1000
  ) {
    return false;
  }
  if (c.concurrency < 1 || c.concurrency > 1000 || ![1, 2, 4, 6, 8].includes(c.cpu)) {
    return false;
  }
  if (c.memoryMb < 128 || c.memoryMb > 32768 || c.timeoutSeconds < 1 || c.timeoutSeconds > 3600) {
    return false;
  }
  if (c.memoryMb > c.cpu * 8192) {
    return false;
  }
  const entries = [...Object.entries(c.env), ...Object.entries(c.secrets)];
  return (
    entries.length <= 100 &&
    entries.every(
      ([key, value]) =>
        /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) &&
        !["__proto__", "constructor", "prototype", "PORT"].includes(key) &&
        value.length <= 4096,
    ) &&
    !Object.keys(c.env).some((key) => Object.hasOwn(c.secrets, key))
  );
};
const id = { projectId: D.string, region: D.string, name: D.validated(ResourceName.parse) };
export const policyDecoder = D.object<IamPolicy>({
  bindings: D.array(
    D.object({
      role: D.parsed(RoleName.parse, "role"),
      members: D.array(D.validated(IamMember.parse)),
    }),
  ),
});
export const configDecoder = D.object<RuntimeConfig>({
  env: D.record(D.string),
  minInstances: D.number,
  maxInstances: D.number,
  concurrency: D.number,
  cpu: D.number,
  memoryMb: D.number,
  timeoutSeconds: D.number,
  serviceAccount: D.string,
  ingress: D.literal(["all", "internal", "internal-and-cloud-load-balancing"]),
  egress: D.literal(["private-ranges-only", "all-traffic"]),
  connector: D.string,
  secrets: D.record(D.string),
  cmek: D.string,
  idempotent: D.boolean,
});
const filterDecoder = D.object<EventFilter>({
  kind: D.literal(["http", "topic", "storage", "firestore"]),
  source: D.string,
  eventType: D.string,
  document: D.string,
});
const invocationDecoder = D.object<Invocation>({
  principal: D.string,
  source: D.string,
  status: D.literal(["SUCCEEDED", "FAILED"]),
  reason: D.string,
  revision: D.string,
  eventId: D.string,
});
export const labDecoder = D.object<ServerlessLab>({
  deployments: D.array(
    D.object<Deployment>({
      ...id,
      kind: D.literal(["run", "function", "job"]),
      revisions: D.array(
        D.object<Revision>({ name: D.string, image: D.string, config: configDecoder }),
      ),
      traffic: D.record(D.number),
      policy: policyDecoder,
      trigger: filterDecoder,
      retry: D.boolean,
      tasks: D.number,
      invocations: D.array(invocationDecoder),
    }),
  ),
  connectors: D.array(D.object<Connector>({ ...id, network: D.string, range: D.string })),
  redis: D.array(D.object<Redis>({ ...id, network: D.string, sizeGb: D.number, host: D.string })),
  databases: D.array(
    D.object<Database>({
      projectId: D.string,
      region: D.string,
      name: D.string,
      mode: D.literal(["firestore-native", "datastore-mode"]),
    }),
  ),
  documents: D.array(
    D.object<Document>({
      projectId: D.string,
      database: D.string,
      path: D.string,
      data: D.string,
      version: D.number,
    }),
  ),
  secrets: D.array(
    D.object<Secret>({
      ...id,
      policy: policyDecoder,
      versions: D.array(
        D.object<SecretVersion>({
          id: D.number,
          state: D.literal(["ENABLED", "DISABLED", "DESTROYED"]),
          data: D.string,
        }),
      ),
    }),
  ),
  keys: D.array(
    D.object<CryptoKey>({ ...id, ring: D.string, enabled: D.boolean, policy: policyDecoder }),
  ),
  triggers: D.array(
    D.object<Trigger>({
      ...id,
      target: D.string,
      targetKind: D.literal(["run", "function"]),
      serviceAccount: D.string,
      filter: filterDecoder,
    }),
  ),
  events: D.array(
    D.object<Event>({
      id: D.string,
      projectId: D.string,
      kind: D.literal(["topic", "storage", "firestore"]),
      source: D.string,
      eventType: D.string,
      document: D.string,
    }),
  ),
  deliveries: D.array(
    D.object<Delivery>({
      eventId: D.string,
      target: D.string,
      attempts: D.number,
      status: D.literal(["SUCCEEDED", "FAILED", "PENDING"]),
      reason: D.string,
      effects: D.number,
      duplicates: D.number,
    }),
  ),
  workflows: D.array(
    D.object<Workflow>({
      ...id,
      serviceAccount: D.string,
      steps: D.array(D.string),
      executions: D.array(invocationDecoder),
    }),
  ),
});

const validDocumentPath = (path: string): boolean => {
  const parts = path.split("/");
  return (
    path.length <= 500 && parts.length % 2 === 0 && parts.every((p) => p && p !== "." && p !== "..")
  );
};
const validFilter = (filter: EventFilter): boolean => {
  if (filter.kind === "http") {
    return !filter.source && !filter.eventType && !filter.document;
  }
  if (!filter.source || filter.source.length > 100) {
    return false;
  }
  if (filter.kind === "topic") {
    return filter.eventType === "google.cloud.pubsub.topic.v1.messagePublished" && !filter.document;
  }
  if (filter.kind === "storage") {
    return filter.eventType === "google.cloud.storage.object.v1.finalized" && !filter.document;
  }
  return (
    /^google\.cloud\.firestore\.document\.v1\.(created|updated|deleted|written)$/.test(
      filter.eventType,
    ) && validDocumentPath(filter.document)
  );
};
const unique = (values: readonly string[]): boolean => new Set(values).size === values.length;
export const validateLab = (world: World): Result<World, string> => {
  const lab = world.serverlessLab;
  const regional = [
    lab.deployments,
    lab.connectors,
    lab.redis,
    lab.databases,
    lab.keys,
    lab.triggers,
    lab.workflows,
  ];
  const resources = [...regional.flat(), ...lab.secrets];
  const projectExists = (projectId: string): boolean =>
    world.projects.some((p) => p.projectId === projectId);
  if (
    resources.length > 2000 ||
    lab.events.length > 200 ||
    lab.deliveries.length > 2000 ||
    lab.documents.length > 2000
  ) {
    return Result.err("Serverless lesson state exceeds its limits.");
  }
  if (
    regional
      .filter((rs) => rs !== lab.databases)
      .flat()
      .some((r) => !projectExists(r.projectId) || !Region.parse(r.region).some) ||
    lab.databases.some(
      (d) => !projectExists(d.projectId) || !firestoreLocations().includes(d.region),
    ) ||
    lab.secrets.some((s) => !projectExists(s.projectId) || s.region !== "global")
  ) {
    return Result.err("Invalid serverless project or region.");
  }
  for (const collection of [...regional, lab.secrets]) {
    const ids = collection.map(
      (r) =>
        `${r.projectId}/${r.region}/${r.name}/${"kind" in r ? r.kind : ""}/${"ring" in r ? r.ring : ""}`,
    );
    if (!unique(ids)) {
      return Result.err("Duplicate serverless resource.");
    }
  }
  if (
    !unique(lab.databases.map((d) => `${d.projectId}/${d.name}`)) ||
    lab.databases.some((d) => !/^(\(default\)|[a-z][a-z0-9-]{2,62})$/.test(d.name))
  ) {
    return Result.err("Invalid or duplicate database ID.");
  }
  for (const d of lab.deployments) {
    if (
      !d.revisions.length ||
      d.revisions.length > 100 ||
      !unique(d.revisions.map((r) => r.name)) ||
      !d.revisions.every(
        (r) =>
          r.name.startsWith(`${d.name}-`) &&
          r.image.length > 0 &&
          r.image.length <= 512 &&
          validConfig(r.config) &&
          r.config.serviceAccount.endsWith("gserviceaccount.com"),
      )
    ) {
      return Result.err("Invalid serverless revisions or runtime configuration.");
    }
    const traffic = Object.entries(d.traffic);
    if (
      d.kind !== "job" &&
      (traffic.length === 0 || traffic.reduce((n, [, p]) => n + p, 0) !== 100)
    ) {
      return Result.err("Traffic must sum to 100.");
    }
    if (
      !traffic.every(
        ([name, p]) =>
          d.revisions.some((r) => r.name === name) && Number.isSafeInteger(p) && p >= 0 && p <= 100,
      )
    ) {
      return Result.err("Invalid traffic revision or percentage.");
    }
    if (
      !Number.isSafeInteger(d.tasks) ||
      d.tasks < 1 ||
      d.tasks > 100 ||
      !validFilter(d.trigger) ||
      (d.kind !== "function" && d.trigger.kind !== "http")
    ) {
      return Result.err("Invalid task count or event filter.");
    }
    if (
      d.invocations.length > 100 ||
      d.invocations.some(
        (v) =>
          !v.principal ||
          !v.source ||
          (v.revision && !d.revisions.some((r) => r.name === v.revision)),
      )
    ) {
      return Result.err("Invalid invocation history.");
    }
    const core = d.kind === "run" ? world.runServices : world.functions;
    if (d.kind !== "job" && !core.some((r) => sameId(r, d))) {
      return Result.err("Serverless deployment has no service or function.");
    }
  }
  for (const c of lab.connectors) {
    const range = Ipv4.range(c.range);
    if (
      !range.some ||
      !c.range.endsWith("/28") ||
      Ipv4.format(range.value.start) !== c.range.split("/")[0] ||
      !c.network
    ) {
      return Result.err("Invalid connector range or network.");
    }
  }
  if (
    lab.redis.some(
      (r) =>
        !Number.isSafeInteger(r.sizeGb) ||
        r.sizeGb < 1 ||
        r.sizeGb > 100 ||
        !Ipv4.address(r.host).some ||
        !r.network,
    )
  ) {
    return Result.err("Invalid Redis configuration.");
  }
  for (const s of lab.secrets) {
    const ids = s.versions.map((v) => v.id);
    if (
      ids.length > 100 ||
      !unique(ids.map(String)) ||
      !ids.every(
        (n, i) => Number.isSafeInteger(n) && n > 0 && (i === 0 || n > (ids[i - 1] ?? 0)),
      ) ||
      s.versions.some((v) => v.data.length > 4096 || (v.state === "DESTROYED" && v.data))
    ) {
      return Result.err("Invalid secret version.");
    }
  }
  if (lab.keys.some((k) => !Result.isOk(ResourceName.parse(k.ring)))) {
    return Result.err("Invalid crypto key ring.");
  }
  if (
    lab.triggers.some(
      (t) =>
        !validFilter(t.filter) ||
        t.filter.kind === "http" ||
        !t.serviceAccount.endsWith("gserviceaccount.com") ||
        !findDeployment(world, { ...t, name: t.target }, t.targetKind),
    )
  ) {
    return Result.err("Invalid Eventarc filter or target.");
  }
  if (
    lab.workflows.some(
      (w) =>
        !w.serviceAccount.endsWith("gserviceaccount.com") ||
        !w.steps.length ||
        w.steps.length > 20 ||
        w.steps.some((s) => !/^(run|function):[a-z][a-z0-9-]*$/.test(s)) ||
        w.executions.length > 100,
    )
  ) {
    return Result.err("Invalid workflow definition or execution history.");
  }
  if (
    !unique(lab.events.map((e) => e.id)) ||
    lab.events.some(
      (e) =>
        !/^event-[1-9]\d*$/.test(e.id) ||
        !projectExists(e.projectId) ||
        !validFilter({ ...e, document: e.kind === "firestore" ? e.document : "" }),
    )
  ) {
    return Result.err("Invalid event history.");
  }
  if (!unique(lab.deliveries.map((d) => `${d.eventId}/${d.target}`))) {
    return Result.err("Duplicate event delivery.");
  }
  for (const d of lab.deliveries) {
    const event = lab.events.find((e) => e.id === d.eventId);
    if (
      !event ||
      !d.target.startsWith(`${event.projectId}/`) ||
      ![d.attempts, d.effects, d.duplicates].every((n) => Number.isSafeInteger(n) && n >= 0) ||
      d.attempts < 1 ||
      d.effects > d.attempts ||
      d.duplicates >= d.attempts
    ) {
      return Result.err("Invalid event delivery.");
    }
  }
  if (!unique(lab.documents.map((d) => `${d.projectId}/${d.database}/${d.path}`))) {
    return Result.err("Duplicate Firestore document.");
  }
  for (const d of lab.documents) {
    if (
      !lab.databases.some(
        (db) =>
          db.projectId === d.projectId && db.name === d.database && db.mode === "firestore-native",
      ) ||
      !validDocumentPath(d.path) ||
      !Number.isSafeInteger(d.version) ||
      d.version < 1 ||
      !documentValue(d.data).ok
    ) {
      return Result.err("Invalid Firestore document reference or value.");
    }
    try {
      const value: unknown = JSON.parse(d.data);
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return Result.err("Invalid Firestore document JSON.");
      }
    } catch {
      return Result.err("Invalid Firestore document JSON.");
    }
  }
  return Result.ok(world);
};
