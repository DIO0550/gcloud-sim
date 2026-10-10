// @vitest-environment node
import { expect, test } from "vitest";
import { Now, run, session } from "@/engine/__tests__/setup";
import { emptyObservabilityLab } from "@/engine/domains/observability-lab/model";
import { ObservePrelude, ObserveSolutions } from "@/engine/missions/observability-lab";
import { Snapshot } from "@/engine/snapshot";

test("v40 migrates to an empty observability model without losing admin/container/storage/config data", () => {
  const original = run(
    session(),
    "gcloud compute instances create preserved --zone=us-central1-a",
    "sim files write saved.json --content='{}'",
  ).world;
  const { observabilityLab: _lab, ...oldWorld } = original;
  const restored = Snapshot.fromUnknown({ schemaVersion: 40, exportedAt: Now, world: oldWorld });
  expect(restored.ok).toBe(true);
  if (restored.ok) {
    expect(restored.value).toEqual({ ...original, observabilityLab: emptyObservabilityLab() });
  }
});
test("current snapshots reject malformed cross-references, times, bounds and duplicate identities", () => {
  const world = run(
    session(),
    ...ObservePrelude,
    ...ObserveSolutions.routing,
    ...ObserveSolutions.notification,
  ).world;
  for (const patch of [
    { clock: -1 },
    { channels: [{ ...world.observabilityLab.channels[0], email: "invalid" }] },
    { points: world.observabilityLab.points.map((p) => ({ ...p, time: 999999 })) },
    { points: [...world.observabilityLab.points, ...world.observabilityLab.points] },
    { buckets: world.observabilityLab.buckets.map((b) => ({ ...b, retentionDays: 0 })) },
    { views: world.observabilityLab.views.map((v) => ({ ...v, bucket: "missing" })) },
    { views: world.observabilityLab.views.map((v) => ({ ...v, filter: "severity=ERROR" })) },
    { links: world.observabilityLab.links.map((l) => ({ ...l, dataset: "missing" })) },
    { deliveries: world.observabilityLab.deliveries.map((d) => ({ ...d, log: "missing" })) },
    { evaluations: world.observabilityLab.evaluations.map((e) => ({ ...e, name: "missing" })) },
    {
      audit: [
        {
          projectId: "ace-dev-01",
          scope: "organization",
          name: "missing",
          service: "allServices",
          adminRead: false,
          dataRead: true,
          dataWrite: false,
        },
      ],
    },
    {
      collectors: [
        {
          projectId: "ace-dev-01",
          name: "bad",
          kind: "ops-agent",
          resource: "vm",
          location: "us-central1-a",
          serviceAccount: "bad",
          enabled: true,
          namespace: "default",
          selector: {},
          port: -1,
        },
      ],
    },
  ]) {
    const snapshot = Snapshot.create(
      { ...world, observabilityLab: { ...world.observabilityLab, ...patch } } as typeof world,
      Now,
    );
    expect(Snapshot.fromUnknown(snapshot).ok, JSON.stringify(patch)).toBe(false);
  }
});
