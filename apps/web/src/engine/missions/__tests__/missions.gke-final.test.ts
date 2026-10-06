// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import {
  auto,
  deployment,
  execute,
  identity,
  linked,
  multi,
  multiReady,
  pods,
  ready,
  recommendation,
  vpa,
} from "@/engine/__tests__/gke-final.setup";
import { initialWorld, session } from "@/engine/__tests__/setup";
import { World } from "@/engine/domains/world";
import { gkeCompletionSatisfied } from "@/engine/missions/gke-completion";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const started = (id: string) => session(Result.unwrap(Engine.startMission(initialWorld(), id)));
const status = (s: ReturnType<typeof session>, id: string) =>
  World.findMissionProgress(s.world, id);

test.each([
  ["m-gke-034", "multi-gke"],
  ["m-gke-035", "multi-repair"],
])(
  "multi-container mission %s remains incomplete until individual probes/recovery",
  (id, cluster) => {
    const s = multi(ready(cluster, undefined, started(id)));
    expect(status(s, id)).toMatchObject({ value: { status: "in_progress" } });
    const full = multiReady(s);
    if (id === "m-gke-034") {
      expect(status(full, id)).toMatchObject({ value: { status: "completed" } });
      return;
    }
    expect(status(full, id)).toMatchObject({ value: { status: "in_progress" } });
    const failed = execute(
      full,
      `sim kubernetes probe multi-app -c agent --kind=liveness --pod=${pods(full)[0]?.name} --status-code=500`,
    );
    expect(status(failed, id)).toMatchObject({ value: { status: "in_progress" } });
    const fixed = execute(failed, "sim kubernetes probe multi-app -c agent --status-code=200");
    expect(status(fixed, id)).toMatchObject({ value: { status: "completed" } });
  },
);
test.each([
  ["m-gke-036", "identity-gke"],
  ["m-gke-037", "identity-standard"],
])(
  "keyless least-privilege mission %s requires annotation, binding, resource permission and metadata",
  (id, cluster) => {
    const start =
      id === "m-gke-036"
        ? auto(cluster, started(id))
        : ready(cluster, "--zone=us-central1-a", started(id));
    const configured = linked(identity(start));
    if (id === "m-gke-036") {
      expect(status(configured, id)).toMatchObject({ value: { status: "completed" } });
      return;
    }
    expect(status(configured, id)).toMatchObject({ value: { status: "in_progress" } });
    const pool = execute(
      configured,
      `gcloud container clusters update ${cluster} --zone=us-central1-a --workload-pool=ace-dev-01.svc.id.goog`,
    );
    expect(status(pool, id)).toMatchObject({ value: { status: "in_progress" } });
    const metadata = execute(
      pool,
      `gcloud container node-pools update default-pool --cluster=${cluster} --zone=us-central1-a --workload-metadata=GKE_METADATA`,
    );
    expect(status(metadata, id)).toMatchObject({ value: { status: "completed" } });
  },
);
test("Off mission requires manual apply while Initial/Recreate missions verify actual Pod resources separately from templates", () => {
  const off = recommendation(vpa("Off", ready("vpa-gke", undefined, started("m-gke-038"))));
  expect(status(off, "m-gke-038")).toMatchObject({ value: { status: "in_progress" } });
  const manual = execute(
    off,
    "kubectl set resources deployment/rightsize-app --containers=tuner --requests=cpu=300m,memory=120Mi",
  );
  expect(status(manual, "m-gke-038")).toMatchObject({ value: { status: "completed" } });
  const initial = recommendation(
    vpa("Initial", ready("vpa-initial", undefined, started("m-gke-041"))),
  );
  expect(status(initial, "m-gke-041")).toMatchObject({ value: { status: "in_progress" } });
  const scaled = execute(initial, "kubectl scale deployment/rightsize-app --replicas=3");
  expect(status(scaled, "m-gke-041")).toMatchObject({ value: { status: "completed" } });
  const recreated = vpa("Recreate", ready("vpa-recreate", undefined, started("m-gke-042")));
  expect(status(recreated, "m-gke-042")).toMatchObject({ value: { status: "in_progress" } });
  expect(status(recommendation(recreated), "m-gke-042")).toMatchObject({
    value: { status: "completed" },
  });
});
test("Autopilot mission requires evaluating both profiles; regional mission requires both worker zones and application replicas", () => {
  const s = execute(
    auto("admission-gke", started("m-gke-039")),
    "kubectl apply -f autopilot-default.json",
    "kubectl apply -f autopilot-small.json",
  );
  const half = execute(s, "sim kubernetes admit-autopilot default-app");
  expect(status(half, "m-gke-039")).toMatchObject({ value: { status: "in_progress" } });
  expect(
    status(execute(half, "sim kubernetes admit-autopilot small-app"), "m-gke-039"),
  ).toMatchObject({ value: { status: "completed" } });
  const r = ready(
    "regional-gke",
    "--region=us-central1 --num-nodes=1 --node-locations=us-central1-a,us-central1-b,us-central1-c",
    started("m-gke-040"),
  );
  expect(status(r, "m-gke-040")).toMatchObject({ value: { status: "in_progress" } });
  const app = execute(r, "kubectl apply -f regional-app.json");
  expect(status(app, "m-gke-040")).toMatchObject({ value: { status: "in_progress" } });
  expect(status(execute(app, "kubectl apply -f regional-service.json"), "m-gke-040")).toMatchObject(
    { value: { status: "completed" } },
  );
});
test("completion rejects weakened readiness, broad IAM permissions and manual template scaling shortcuts", () => {
  const s = multiReady(multi(ready("multi-gke")));
  const d = deployment(s);
  const weakened = { ...s.world, kubeDeployments: [{ ...d, readinessProbe: Option.none }] };
  expect(gkeCompletionSatisfied(weakened, "multiReady")).toBe(false);
  const iam = linked(identity(auto("identity-gke")));
  const broad = execute(
    iam,
    "gcloud storage buckets add-iam-policy-binding gs://ace-workload-data --member=serviceAccount:lesson-reader@ace-dev-01.iam.gserviceaccount.com --role=roles/storage.objectAdmin",
  );
  expect(gkeCompletionSatisfied(broad.world, "identity")).toBe(false);
  const v = execute(
    recommendation(vpa("Initial", ready("vpa-initial"))),
    "kubectl set resources deployment/rightsize-app --requests=cpu=300m,memory=120Mi",
    "kubectl scale deployment/rightsize-app --replicas=3",
  );
  expect(gkeCompletionSatisfied(v.world, "vpaInitial")).toBe(false);
});
