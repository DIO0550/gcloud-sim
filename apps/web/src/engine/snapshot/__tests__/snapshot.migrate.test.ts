// @vitest-environment node
import { expect, test } from "vitest";

import { Now, run, session } from "@/engine/__tests__/setup";
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

test("現行の Snapshot は v12 で、export → import が同一になる", () => {
  const s = run(
    session(),
    "gcloud compute disks create d --zone=asia-northeast1-a",
    "gcloud iam roles create r1 --project=ace-dev-01 --permissions=compute.instances.list",
    "gcloud services enable pubsub.googleapis.com",
    "gcloud pubsub topics create t",
  );
  const snapshot = Snapshot.create(s.world, Now);
  expect(snapshot.schemaVersion).toBe(SchemaVersion);
  expect(SchemaVersion).toBe(12);
  const imported = Result.unwrap(Snapshot.fromUnknown(JSON.parse(JSON.stringify(snapshot))));
  expect(imported).toEqual(s.world);
});

test("v13 以降や v0 は unsupportedVersion", () => {
  const result = Snapshot.fromUnknown({ schemaVersion: 13, world: {} });
  expect(result).toEqual(Result.err({ kind: "unsupportedVersion", version: "13" }));
});

test("v1 でも形が壊れていれば malformed になる（マイグレーションは埋めるだけで検証はしない）", () => {
  const broken = { ...v1(), world: { ...v1().world, projects: "nope" } };
  const result = Snapshot.fromUnknown(JSON.parse(JSON.stringify(broken)));
  expect(Result.isOk(result)).toBe(false);
  if (!Result.isOk(result)) expect(result.error.kind).toBe("malformed");
});
