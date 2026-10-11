// @vitest-environment node
import { expect, test } from "vitest";

import { Now, run, session } from "@/engine/__tests__/setup";
import { MigLocation } from "@/engine/domains/resource-location";
import { SchemaVersion, Snapshot } from "@/engine/snapshot";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

/** v1（Phase 1）の Snapshot: 新しい集合と `session.adc` / `components`・SA のポリシー・バケットの新フィールドが無い。 */
const v1 = () => {
  const s = run(
    session(),
    "gcloud storage buckets create gs://b-1",
    "gcloud storage cp ./a.log gs://b-1/",
  );
  const {
    disks: _d,
    projectMetadata: _pm,
    addresses: _a,
    routers: _r,
    peerings: _p,
    healthChecks: _h,
    backendServices: _bs,
    forwardingRules: _f,
    instanceTemplates: _it,
    instanceGroups: _ig,
    nodePools: _np,
    kubeDeployments: _kd,
    kubeServices: _ks,
    functions: _fn,
    appEngineApps: _ae,
    appVersions: _av,
    sqlInstances: _si,
    sqlBackups: _sb,
    pubsubTopics: _pt,
    pubsubSubscriptions: _ps,
    logSinks: _ls,
    serviceAccountKeys: _sk,
    osLoginKeys: _ok,
    kmsKeyRings: _kr,
    dnsZones: _dz,
    dmDeployments: _dm,
    budgets: _b,
    customRoles: _cr,
    ...rest
  } = s.world;
  const serviceAccounts = rest.serviceAccounts.map(({ iamPolicy: _ip, ...sa }) => sa);
  const buckets = rest.buckets.map(({ versioning: _v, lifecycleRules: _l, acl: _acl, ...b }) => ({
    ...b,
    objects: b.objects.map(({ storageClass: _sc, ...o }) => o),
  }));
  return {
    schemaVersion: 1,
    exportedAt: Now,
    world: { ...rest, serviceAccounts, buckets, session: { accounts: rest.session.accounts } },
  };
};

test("v1 の Snapshot を import すると、足した集合が空で復元される", () => {
  const imported = Result.unwrap(Snapshot.fromUnknown(JSON.parse(JSON.stringify(v1()))));
  expect(imported.disks).toEqual([]);
  expect(imported.customRoles).toEqual([]);
  expect(imported.session.adc).toEqual(Option.none);
  expect(imported.session.components).toEqual([]);
  expect(imported.serviceAccounts[0]?.iamPolicy).toEqual({ bindings: [] });
  expect(imported.buckets[0]?.versioning).toBe(false);
  expect(imported.buckets[0]?.objects[0]?.storageClass).toEqual(Option.none);
  expect(imported.buckets[0]?.objects[0]?.name).toBe("a.log");
});

test("現行の Snapshot は v44 で、export → import が同一になる", () => {
  const s = run(
    session(),
    "gcloud compute disks create d --zone=asia-northeast1-a",
    "gcloud iam roles create r1 --project=ace-dev-01 --permissions=compute.instances.list",
    "gcloud services enable pubsub.googleapis.com",
    "gcloud pubsub topics create t",
  );
  const snapshot = Snapshot.create(s.world, Now);
  expect(snapshot.schemaVersion).toBe(SchemaVersion);
  expect(SchemaVersion).toBe(44);
  const imported = Result.unwrap(Snapshot.fromUnknown(JSON.parse(JSON.stringify(snapshot))));
  expect(imported).toEqual(s.world);
});

test("次の版以降は unsupportedVersion", () => {
  const result = Snapshot.fromUnknown({ schemaVersion: SchemaVersion + 1, world: {} });
  expect(result).toEqual(
    Result.err({ kind: "unsupportedVersion", version: String(SchemaVersion + 1) }),
  );
});

test("v1 でも形が壊れていれば malformed になる（マイグレーションは埋めるだけで検証はしない）", () => {
  const broken = { ...v1(), world: { ...v1().world, projects: "nope" } };
  const result = Snapshot.fromUnknown(JSON.parse(JSON.stringify(broken)));
  expect(Result.isOk(result)).toBe(false);
  if (!Result.isOk(result)) expect(result.error.kind).toBe("malformed");
});

const v43Locations = () => {
  const s = run(
    session(),
    "gcloud compute instance-templates create web-tpl",
    "gcloud compute instance-groups managed create web-mig --zone=asia-northeast1-a --template=web-tpl --size=1",
    "gcloud compute instance-groups managed create web-mig --region=asia-northeast1 --template=web-tpl --size=2",
    "gcloud compute addresses create endpoint --global",
    "gcloud compute addresses create endpoint --region=asia-northeast1",
  );
  const legacy = {
    schemaVersion: 43,
    exportedAt: Now,
    world: {
      ...s.world,
      instanceGroups: s.world.instanceGroups.map(({ location, ...group }) => ({
        ...group,
        location: MigLocation.name(location),
      })),
      addresses: s.world.addresses.map(({ scope, ...address }) => ({
        ...address,
        region: scope.kind === "global" ? Option.none : Option.some(scope.region),
      })),
    },
  };
  return { s, legacy };
};

test("v43 の MIG と Address はロケーションの形を移行し、同名の別スコープを保持する", () => {
  const { s, legacy } = v43Locations();
  expect(s.world.instanceGroups).toHaveLength(2);
  expect(s.world.addresses).toHaveLength(2);
  const imported = Result.unwrap(Snapshot.fromUnknown(JSON.parse(JSON.stringify(legacy))));
  expect(imported).toEqual(s.world);
  for (const line of [
    "gcloud compute instance-groups managed list",
    "gcloud compute instance-groups managed describe web-mig --region=asia-northeast1",
    "gcloud compute instance-groups managed describe web-mig --zone=asia-northeast1-a",
    "gcloud compute addresses list",
    "gcloud compute addresses describe endpoint --global",
    "gcloud compute addresses describe endpoint --region=asia-northeast1",
  ]) {
    expect(run(session(imported), line).text).toBe(run(s, line).text);
  }
  const duplicate = run(session(imported), "gcloud compute addresses create endpoint --global");
  expect(duplicate.text).toContain("already exists");
  expect(duplicate.world).toBe(imported);
});

test("v43 の不正な Address.region.some は移行で正常値に変換されない", () => {
  const { legacy } = v43Locations();
  const broken = {
    ...legacy,
    world: {
      ...legacy.world,
      addresses: legacy.world.addresses.map((address) => ({
        ...address,
        region: { some: "true", value: "asia-northeast1" },
      })),
    },
  };
  const result = Snapshot.fromUnknown(broken);
  expect(Result.isOk(result)).toBe(false);
  if (Result.isOk(result)) {
    return;
  }
  expect(result.error.kind).toBe("malformed");
});
