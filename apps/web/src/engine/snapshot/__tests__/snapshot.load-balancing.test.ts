// @vitest-environment node
import { expect, test } from "vitest";
import { applicationLb, executeLb } from "@/engine/__tests__/lb.setup";
import { initialWorld, Now, session } from "@/engine/__tests__/setup";
import {
  BackendService,
  ForwardingRule,
  HealthCheck,
  LbScope,
} from "@/engine/domains/load-balancing";
import { lbProbe } from "@/engine/domains/load-balancing/graph";
import type { World } from "@/engine/domains/world";
import {
  bucketLesson,
  cleanupLesson,
  internalLesson,
  negLesson,
  passthroughLesson,
  tlsLesson,
} from "@/engine/missions/load-balancing";
import { SchemaVersion, Snapshot } from "@/engine/snapshot";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

test.each([passthroughLesson, internalLesson, negLesson, tlsLesson, bucketLesson, cleanupLesson])(
  "current Snapshot roundtrip preserves a complete LB lesson graph",
  (commands) => {
    const built = executeLb(session(), ...commands);
    const snapshot = Snapshot.create(built.world, Now);
    expect(snapshot.schemaVersion).toBe(37);
    const imported = Result.unwrap(Snapshot.fromUnknown(JSON.parse(JSON.stringify(snapshot))));
    expect(imported).toEqual(built.world);
  },
);
const legacy = (): World => {
  const check = Result.unwrap(
    HealthCheck.create({
      projectId: "ace-dev-01",
      name: "legacy-hc",
      protocol: "HTTP",
      port: Option.some(80),
    }),
  );
  const backend = Result.unwrap(
    BackendService.create({
      projectId: "ace-dev-01",
      name: "legacy-backend",
      scope: LbScope.Global,
      protocol: "HTTP",
      loadBalancingScheme: "EXTERNAL",
      healthChecks: ["legacy-hc"],
    }),
  );
  const rule = Result.unwrap(
    ForwardingRule.create({
      projectId: "ace-dev-01",
      name: "legacy-front",
      scope: LbScope.Global,
      ipAddress: "34.110.1.1",
      ipProtocol: "TCP",
      portRange: "80",
      loadBalancingScheme: "EXTERNAL",
      backendService: "legacy-backend",
      creationTimestamp: Now,
    }),
  );
  return {
    ...initialWorld(),
    healthChecks: [check],
    backendServices: [backend],
    forwardingRules: [rule],
  };
};
test.each(Array.from({ length: 30 }, (_, i) => i + 1))(
  "v%s migration retains standalone LB resources without inventing proxies/application health",
  (version) => {
    const old = legacy();
    const { lbResources: _new, ...oldWorld } = old;
    const imported = Result.unwrap(
      Snapshot.fromUnknown({ schemaVersion: version, exportedAt: Now, world: oldWorld }),
    );
    expect(imported.lbResources).toEqual([]);
    expect(imported.healthChecks[0]?.name).toBe("legacy-hc");
    expect(imported.backendServices[0]?.healthChecks).toEqual(["legacy-hc"]);
    const rule = imported.forwardingRules[0];
    if (rule === undefined) {
      throw new Error("Legacy forwarding rule was lost");
    }
    expect(
      lbProbe(imported, rule, {
        host: "example.test",
        path: "/",
        port: 80,
        sourceIp: "198.51.100.10",
        network: "",
        region: "",
        minHealthy: 1,
      }),
    ).toMatchObject({ success: false, reason: "LEGACY_UNCONNECTED_FORWARDING_RULE" });
  },
);
const rejects = (world: World) => {
  const result = Snapshot.fromUnknown({ schemaVersion: SchemaVersion, exportedAt: Now, world });
  expect(Result.isOk(result)).toBe(false);
  if (!Result.isOk(result)) {
    expect(result.error.kind).toBe("invariant");
  }
};
test.each([
  "health-as-url-backend",
  "proxy-as-url-map",
  "http-proxy-with-cert",
  "wrong-front-target",
  "bad-global-tier",
  "bad-named-port",
  "health-wrong-scope",
  "backend-wrong-kind",
])("v31 rejects semantic graph corruption: %s", (corruption) => {
  const source = applicationLb().world;
  let broken = source;
  if (corruption === "health-as-url-backend") {
    broken = {
      ...source,
      lbResources: source.lbResources.map((r) =>
        r.kind === "urlMaps"
          ? {
              ...r,
              defaultService: HealthCheck.selfLink(
                source.healthChecks[0] ?? (legacy().healthChecks[0] as HealthCheck),
              ),
            }
          : r,
      ),
    };
  }
  if (corruption === "proxy-as-url-map") {
    broken = {
      ...source,
      lbResources: source.lbResources.map((r) =>
        r.kind === "targetHttpProxies"
          ? { ...r, urlMap: source.forwardingRules[0]?.target ?? "" }
          : r,
      ),
    };
  }
  if (corruption === "http-proxy-with-cert") {
    broken = {
      ...source,
      lbResources: source.lbResources.map((r) =>
        r.kind === "targetHttpProxies" ? { ...r, sslCertificates: ["missing"] } : r,
      ),
    };
  }
  if (corruption === "wrong-front-target") {
    broken = {
      ...source,
      forwardingRules: source.forwardingRules.map((r) => ({
        ...r,
        target: HealthCheck.selfLink(source.healthChecks[0] as HealthCheck),
      })),
    };
  }
  if (corruption === "bad-global-tier") {
    broken = {
      ...source,
      forwardingRules: source.forwardingRules.map((r) => ({ ...r, networkTier: "STANDARD" })),
    };
  }
  if (corruption === "bad-named-port") {
    broken = {
      ...source,
      instanceGroups: source.instanceGroups.map((g) => ({
        ...g,
        namedPorts: [{ name: "http", port: 0 }],
      })),
    };
  }
  if (corruption === "health-wrong-scope") {
    broken = {
      ...source,
      healthChecks: source.healthChecks.map((h) => ({
        ...h,
        scope: LbScope.region("us-central1"),
      })),
    };
  }
  if (corruption === "backend-wrong-kind") {
    broken = {
      ...source,
      backendServices: source.backendServices.map((b) => ({
        ...b,
        backends: [source.forwardingRules[0]?.target ?? ""],
      })),
    };
  }
  rejects(broken);
  expect(Result.isOk(Snapshot.fromUnknown(Snapshot.create(source, Now)))).toBe(true);
});
test("v31 rejects stale/mislocated NEG VM references and proxy-only VM placement", () => {
  const neg = executeLb(session(), ...negLesson).world;
  rejects({
    ...neg,
    lbResources: neg.lbResources.map((r) =>
      r.kind === "networkEndpointGroups"
        ? { ...r, endpoints: r.endpoints.map((e) => ({ ...e, ipAddress: "203.0.113.10" })) }
        : r,
    ),
  });
  rejects({
    ...neg,
    lbResources: neg.lbResources.map((r) =>
      r.kind === "networkEndpointGroups" ? { ...r, location: "zones/us-east1-b" } : r,
    ),
  });
  const internal = executeLb(session(), ...internalLesson).world;
  rejects({ ...internal, subnets: internal.subnets.filter((s) => s.name !== "internal-proxy") });
  rejects({
    ...internal,
    instances: internal.instances.map((v) =>
      v.name.startsWith("internal-group")
        ? {
            ...v,
            networkInterfaces: v.networkInterfaces.map((n) => ({
              ...n,
              subnetwork: "internal-proxy",
            })),
          }
        : v,
    ),
  });
});
test("v31 needs typed resource collection, while v30 migrates its absence", () => {
  const { lbResources: _new, ...old } = initialWorld();
  expect(Snapshot.fromUnknown({ schemaVersion: 31, world: old })).toMatchObject({
    ok: false,
    error: { kind: "malformed" },
  });
  expect(Result.isOk(Snapshot.fromUnknown({ schemaVersion: 30, world: old }))).toBe(true);
  expect(
    Snapshot.fromUnknown({
      schemaVersion: 31,
      world: {
        ...initialWorld(),
        lbResources: [
          { projectId: "ace-dev-01", name: "bad", location: "global", kind: "targetTcpProxies" },
        ],
      },
    }),
  ).toMatchObject({ ok: false, error: { kind: "malformed" } });
});
