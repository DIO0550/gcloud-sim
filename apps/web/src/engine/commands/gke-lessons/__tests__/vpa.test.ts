// @vitest-environment node
import { expect, test } from "vitest";
import {
  deployment,
  execute,
  file,
  json,
  pods,
  ready,
  recommendation,
  rejected,
  restore,
  snapshot,
  vpa,
  write,
} from "@/engine/__tests__/gke-final.setup";
import { Snapshot } from "@/engine/snapshot";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const names = (s: ReturnType<typeof vpa>) => pods(s, "rightsize-app").map((p) => p.name);
const resources = (s: ReturnType<typeof vpa>) =>
  pods(s, "rightsize-app").map((p) => p.resources.requests);

test("Off stores a recommendation without changing Pods, replicas or templates; manual application creates a rollout", () => {
  const s = vpa();
  const r = recommendation(s);
  expect(r.world.kubeDeployments).toEqual(s.world.kubeDeployments);
  expect(Option.unwrap(r.world.kubeVpas[0]?.recommendation ?? Option.none)).toMatchObject({
    cpuMilli: 300,
    memoryBytes: 125829120,
  });
  expect(json(r, "kubectl get vpa rightsize -o json").spec.updatePolicy.updateMode).toBe("Off");
  const manual = execute(
    restore(r),
    "kubectl set resources deployment/rightsize-app --containers=tuner --requests=cpu=300m,memory=120Mi",
  );
  expect(names(manual)).not.toEqual(names(s));
  expect(deployment(manual, "rightsize-app")).toMatchObject({ replicas: 2, revision: 2 });
  expect(resources(manual)).toEqual([
    { cpu: "300m", memory: "120Mi" },
    { cpu: "300m", memory: "120Mi" },
  ]);
});
test("Initial applies only on creation, preserving existing Pod resources and the Deployment template", () => {
  const s = vpa("Initial");
  const r = recommendation(s);
  expect(r.world.kubeDeployments).toEqual(s.world.kubeDeployments);
  const scaled = execute(r, "kubectl scale deployment/rightsize-app --replicas=3");
  expect(names(scaled).slice(0, 2)).toEqual(names(s));
  expect(resources(scaled)).toEqual([
    { cpu: "1", memory: "512Mi" },
    { cpu: "1", memory: "512Mi" },
    { cpu: "300m", memory: "120Mi" },
  ]);
  expect(deployment(scaled, "rightsize-app")).toMatchObject({
    revision: 1,
    resources: { requests: { cpu: "1", memory: "512Mi" } },
  });
  const replaced = execute(restore(scaled), `kubectl delete pod ${names(scaled)[0]}`);
  expect(resources(replaced)[0]).toEqual({ cpu: "300m", memory: "120Mi" });
  expect(restore(replaced).world).toEqual(replaced.world);
});
test("Recreate vertically scales all selected Pods once without changing replicas, revisions or templates", () => {
  const s = vpa("Recreate");
  const r = recommendation(s);
  expect(names(r)).not.toEqual(names(s));
  const before = deployment(s, "rightsize-app");
  const after = deployment(r, "rightsize-app");
  expect(after).toMatchObject({
    replicas: before.replicas,
    revision: before.revision,
    generation: before.generation,
    revisions: before.revisions,
    resources: before.resources,
    podIncarnations: [1, 2],
  });
  expect(resources(r)).toEqual([
    { cpu: "300m", memory: "120Mi" },
    { cpu: "300m", memory: "120Mi" },
  ]);
  expect(recommendation(r).world).toEqual(r.world);
  const again = execute(
    restore(r),
    "sim kubernetes recommend-vpa rightsize --cpu=500m --memory=200Mi",
  );
  expect(resources(again)).toEqual([
    { cpu: "600m", memory: "240Mi" },
    { cpu: "600m", memory: "240Mi" },
  ]);
  expect(deployment(again, "rightsize-app").podIncarnations).toEqual([3, 4]);
});
test("automatic VPA and CPU HPA conflict in both creation orders; Off coexists and HPA uses actual admitted requests", () => {
  for (const mode of ["Initial", "Recreate"] as const) {
    rejected(
      vpa(mode),
      "kubectl autoscale deployment/rightsize-app --max=5 --cpu-percent=50",
      "VPA",
    );
    const h = execute(
      ready(),
      "kubectl apply -f rightsize-app.json",
      "kubectl autoscale deployment/rightsize-app --max=5 --cpu-percent=50",
    );
    rejected(h, `kubectl apply -f rightsize-${mode.toLowerCase()}.json`, "HPA");
  }
  const initial = execute(
    recommendation(vpa("Initial")),
    "kubectl scale deployment/rightsize-app --replicas=3",
    "kubectl apply -f rightsize-vpa.json",
    "kubectl autoscale deployment/rightsize-app --min=1 --max=10 --cpu-percent=50",
    "sim kubernetes reconcile rightsize-app --cpu=500m",
  );
  const e = Option.unwrap(initial.world.kubeHpas[0]?.lastEvaluation ?? Option.none);
  expect(e).toMatchObject({ totalRequestMilli: 2300, currentReplicas: 3, desiredReplicas: 4 });
  expect(deployment(initial, "rightsize-app").replicas).toBe(4);
});
test("limits reject incompatible recommendations atomically; template edits report blocked admission and recover", () => {
  const s = execute(
    vpa("Initial"),
    "kubectl set resources deployment/rightsize-app --limits=cpu=1,memory=512Mi",
  );
  rejected(s, "sim kubernetes recommend-vpa rightsize --cpu=1 --memory=100Mi", "limit");
  const r = recommendation(s);
  const blocked = execute(
    r,
    "kubectl set resources deployment/rightsize-app --requests=cpu=100m,memory=64Mi --limits=cpu=200m,memory=100Mi",
  );
  expect(json(blocked, "kubectl get pods -o json").items[0]).toMatchObject({
    ready: "0/1",
    displayStatus: "VpaAdmissionError",
  });
  const fixed = execute(
    restore(blocked),
    "kubectl set resources deployment/rightsize-app --limits=cpu=500m,memory=256Mi",
  );
  expect(json(fixed, "kubectl get pods -o json").items[0].ready).toBe("1/1");
  expect(resources(fixed)[0]).toEqual({ cpu: "300m", memory: "120Mi" });
});
test("VPA requires enablement, namespaced target, valid positive sample, RequestsOnly and one policy", () => {
  const disabled = ready("disabled", "--zone=us-central1-a");
  rejected(disabled, "kubectl apply -f rightsize-vpa.json", "Enable VPA");
  const s = vpa();
  for (const sample of [
    "--cpu=0 --memory=100Mi",
    "--cpu=1m --memory=0",
    "--cpu=bad --memory=1Mi",
    "--cpu=1000000 --memory=1Mi",
  ]) {
    rejected(s, `sim kubernetes recommend-vpa rightsize ${sample}`);
  }
  rejected(
    s,
    "sim kubernetes recommend-vpa rightsize --cpu=1m --memory=1Mi -n kube-system",
    "not found",
  );
  const missing = file(s, "rightsize-vpa.json");
  missing.spec.targetRef.name = "missing";
  const applied = execute(write(s, missing), "kubectl apply -f test.json");
  rejected(applied, "sim kubernetes recommend-vpa rightsize --cpu=1m --memory=1Mi", "missing");
  const invalid = file(s, "rightsize-initial.json");
  delete invalid.spec.resourcePolicy.containerPolicies[0].controlledValues;
  rejected(write(s, invalid), "kubectl apply -f test.json", "RequestsOnly");
});
test("VPA get/delete/namespace cleanup and strict snapshot decoding retain every mode and admission", () => {
  const s = recommendation(vpa("Recreate"));
  expect(execute(s, "kubectl describe verticalpodautoscaler rightsize").text).toContain("300m");
  expect(execute(s, "kubectl get vpa -A").text).toContain("default");
  const removed = execute(s, "kubectl delete vpa rightsize");
  expect(removed.world.kubeVpas).toHaveLength(0);
  expect(resources(removed)).toEqual(resources(s));
  for (const mode of ["Initial", "Recreate", "Off"] as const) {
    const s = recommendation(vpa(mode));
    expect(restore(s).world).toEqual(s.world);
    const value = snapshot(s);
    value.world.kubeVpas[0].mode = "unknown";
    expect(Result.isOk(Snapshot.fromUnknown(value))).toBe(false);
  }
  const conflict = snapshot(
    execute(
      s,
      "kubectl apply -f rightsize-vpa.json",
      "kubectl autoscale deployment/rightsize-app --max=5",
    ),
  );
  conflict.world.kubeVpas[0].mode = "Initial";
  expect(Result.isOk(Snapshot.fromUnknown(conflict))).toBe(false);
});
