// @vitest-environment node
import { expect, test } from "vitest";
import {
  auto,
  deployment,
  execute,
  json,
  ready,
  rejected,
  restore,
  snapshot,
} from "@/engine/__tests__/gke-final.setup";
import { session } from "@/engine/__tests__/setup";
import { AutopilotAdmission } from "@/engine/domains/gke-completion";
import { KubeResources } from "@/engine/domains/kube-resources";
import { Snapshot } from "@/engine/snapshot";
import { Result } from "@/utils/Result";

test("Autopilot explicit admission applies defaults and minima without editing saved input files and is idempotent", () => {
  const s = execute(
    auto(),
    "kubectl apply -f autopilot-default.json",
    "kubectl apply -f autopilot-small.json",
  );
  expect(deployment(s, "default-app").resources.requests).toEqual({});
  const admitted = execute(
    s,
    "sim kubernetes admit-autopilot default-app",
    "sim kubernetes admit-autopilot small-app",
  );
  expect(deployment(admitted, "default-app").resources.requests).toEqual({
    cpu: "500m",
    memory: "2Gi",
  });
  expect(deployment(admitted, "small-app").resources).toEqual({
    requests: { cpu: "50m", memory: "52Mi" },
    limits: { cpu: "50m", memory: "52Mi" },
  });
  expect(admitted.world.kubeFiles).toEqual(s.world.kubeFiles);
  expect(execute(admitted, "sim kubernetes admit-autopilot small-app").world).toEqual(
    admitted.world,
  );
  expect(restore(admitted).world).toEqual(admitted.world);
  const multi = execute(auto(), "kubectl apply -f multi-app.json");
  rejected(multi, "sim kubernetes admit-autopilot multi-app", "one ordinary container");
  const standard = execute(ready(), "kubectl apply -f autopilot-small.json");
  rejected(standard, "sim kubernetes admit-autopilot small-app", "Autopilot cluster");
});
test.each([
  [{ cpu: "1" }, { cpu: "1", memory: "1Gi" }],
  [{ memory: "1Gi" }, { cpu: "154m", memory: "1Gi" }],
  [
    { cpu: "100m", memory: "1Gi" },
    { cpu: "154m", memory: "1Gi" },
  ],
  [
    { cpu: "1", memory: "32Mi" },
    { cpu: "1", memory: "1Gi" },
  ],
  [
    { cpu: "30", memory: "110Gi" },
    { cpu: "30", memory: "110Gi" },
  ],
])("Autopilot resource ratio correction %j", (requests, expected) => {
  const input = Result.unwrap(KubeResources.parse({ requests }));
  const result = Result.unwrap(AutopilotAdmission.evaluate(input));
  expect(result.requests).toEqual(expected);
});
test.each([
  { cpu: "31", memory: "1Gi" },
  { cpu: "1", memory: "111Gi" },
])("Autopilot maximum is rejected %j", (requests) => {
  expect(
    Result.isOk(AutopilotAdmission.evaluate(Result.unwrap(KubeResources.parse({ requests })))),
  ).toBe(false);
});
test("regional worker counts use per-zone pool sizes; node labels/version describe each pool", () => {
  const s = ready("regional", "--region=us-central1 --num-nodes=1");
  const c = json(
    s,
    "gcloud container clusters describe regional --region=us-central1 --format=json",
  );
  expect(c.currentNodeCount).toBe(3);
  expect(c.locations).toEqual(["us-central1-a", "us-central1-b", "us-central1-c"]);
  expect(c.controlPlaneReplicas).toBe(3);
  const nodes = json(s, "kubectl get nodes -o json").items;
  expect(nodes).toHaveLength(3);
  expect(
    nodes.map(
      (n: { metadata: { labels: Record<string, string> } }) =>
        n.metadata.labels["topology.kubernetes.io/zone"],
    ),
  ).toEqual(c.locations);
  const extra = execute(
    s,
    "gcloud container node-pools create extra --cluster=regional --region=us-central1 --num-nodes=2",
  );
  expect(json(extra, "kubectl get nodes -o json").items).toHaveLength(9);
  expect(
    json(extra, "gcloud container clusters describe regional --region=us-central1 --format=json")
      .currentNodeCount,
  ).toBe(9);
  expect(restore(extra).world).toEqual(extra.world);
  const resized = execute(
    extra,
    "gcloud container clusters resize regional --node-pool=extra --region=us-central1 --num-nodes=1 --quiet",
  );
  expect(json(resized, "kubectl get nodes -o json").items).toHaveLength(6);
});
test.each([
  "--region=us-central1 --node-locations=asia-northeast1-a",
  "--region=us-central1 --node-locations=us-central1-a,us-central1-a",
  "--zone=us-central1-a --node-locations=us-east1-b",
  "--region=us-central1 --node-locations=unknown",
  "--zone=us-central1-a --workload-pool=other.svc.id.goog",
])("invalid placement/pool is rejected before cluster creation: %s", (flags) => {
  const s = execute(session(), "gcloud services enable container.googleapis.com");
  rejected(s, `gcloud container clusters create invalid ${flags}`);
});
test("Autopilot is regional and managed; migrations derive historical zonal/regional placement", () => {
  const s = execute(session(), "gcloud services enable container.googleapis.com");
  rejected(s, "gcloud container clusters create-auto invalid --zone=us-central1-a", "regional");
  const c = ready("regional", "--region=us-central1 --num-nodes=1");
  const old = snapshot(c);
  old.schemaVersion = 29;
  delete old.world.kubeVpas;
  delete old.world.kubeServiceAccounts;
  delete old.world.clusters[0].nodeLocations;
  delete old.world.clusters[0].workloadPool;
  delete old.world.clusters[0].gkeMetadataServer;
  delete old.world.clusters[0].verticalPodAutoscaling;
  delete old.world.nodePools[0].workloadMetadata;
  const restored = session(Result.unwrap(Snapshot.fromUnknown(old)));
  expect(restored.world.kubeVpas).toEqual([]);
  expect(restored.world.kubeServiceAccounts).toEqual([]);
  expect(restored.world.kubeFiles).toEqual(c.world.kubeFiles);
  expect(json(restored, "kubectl get nodes -o json").items).toHaveLength(3);
  const invalid = snapshot(c);
  invalid.world.clusters[0].nodeLocations = ["asia-northeast1-a"];
  expect(Result.isOk(Snapshot.fromUnknown(invalid))).toBe(false);
});
