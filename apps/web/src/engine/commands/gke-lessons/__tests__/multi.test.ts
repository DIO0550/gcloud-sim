// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import {
  deployment,
  execute,
  file,
  json,
  multi,
  multiReady,
  pods,
  ready,
  rejected,
  restore,
  snapshot,
  write,
} from "@/engine/__tests__/gke-final.setup";
import { KubeMulti } from "@/engine/domains/kube-multi";
import { KubeServiceRouting } from "@/engine/domains/kube-service-routing";
import { Snapshot } from "@/engine/snapshot";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const endpoints = (s: ReturnType<typeof multi>) =>
  KubeServiceRouting.backends(
    s.world,
    s.world.kubeServices[0] ??
      (() => {
        throw new Error("Missing Service");
      })(),
  );
test("all containers must be ready; exec and logs select independent containers even when sibling is unready", () => {
  const start = multi();
  expect(json(start, "kubectl get pods -o json").items[0].ready).toBe("0/2");
  const half = execute(start, "sim kubernetes probe multi-app -c app --status-code=200");
  expect(json(half, "kubectl get pods -o json").items[0].ready).toBe("1/2");
  expect(endpoints(half)).toHaveLength(0);
  expect(execute(half, "kubectl exec deployment/multi-app -c app -- printenv ROLE").text).toBe(
    "frontend",
  );
  expect(execute(half, "kubectl exec deployment/multi-app -c agent -- printenv ROLE").text).toBe(
    "metrics",
  );
  expect(execute(half, `kubectl logs ${pods(half)[0]?.name} -c agent`).text).toContain("busybox:1");
  const full = multiReady(start);
  expect(endpoints(full)).toHaveLength(2);
  expect(
    json(full, "kubectl get pods -o json").items[0].status.containerStatuses.map(
      (c: { name: string; ready: boolean }) => [c.name, c.ready],
    ),
  ).toEqual([
    ["app", true],
    ["agent", true],
  ]);
  expect(restore(full).world).toEqual(full.world);
});
test("liveness restarts only the selected container and Pod, preserving sibling environment and readiness", () => {
  const s = multiReady();
  const first = pods(s)[0]?.name;
  const next = execute(
    s,
    `sim kubernetes probe multi-app -c agent --kind=liveness --pod=${first} --status-code=500`,
  );
  expect(deployment(next).revision).toBe(1);
  expect(pods(next).map((p) => p.name)).toEqual(pods(s).map((p) => p.name));
  expect(json(next, "kubectl get pods -o json").items[0].ready).toBe("1/2");
  expect(endpoints(next)).toHaveLength(1);
  const record = json(next, `kubectl get pod ${first} -o json`);
  expect(
    record.status.containerStatuses.map((c: { restartCount: number }) => c.restartCount),
  ).toEqual([0, 1]);
  const fixed = execute(restore(next), "sim kubernetes probe multi-app -c agent --status-code=200");
  expect(endpoints(fixed)).toHaveLength(2);
  expect(deployment(fixed).podEnvironments).toEqual(deployment(s).podEnvironments);
});
test("per-container image/env/resources changes are retained in history and undo; wildcard updates remain atomic", () => {
  const s = execute(
    multi(),
    "kubectl set image deployment/multi-app agent=busybox:2",
    "kubectl set env deployment/multi-app --containers=agent ROLE=updated",
    "kubectl set resources deployment/multi-app --containers=agent --requests=cpu=100m",
  );
  expect(KubeMulti.spec(deployment(s)).map((c) => c.image)).toEqual(["nginx:1", "busybox:2"]);
  expect(json(s, "kubectl get rs -o json").items.at(-1).spec.template.spec.containers).toHaveLength(
    2,
  );
  expect(execute(s, "kubectl rollout history deployment/multi-app --revision=2").text).toContain(
    "busybox:2",
  );
  expect(execute(s, "kubectl rollout history deployment/multi-app --revision=1").text).toContain(
    "busybox:1",
  );
  const undo = execute(restore(s), "kubectl rollout undo deployment/multi-app --to-revision=1");
  expect(
    KubeMulti.spec(deployment(undo)).map((c) => [
      c.image,
      c.env[0]?.value,
      c.resources.requests.cpu,
    ]),
  ).toEqual([
    ["nginx:1", "frontend", "250m"],
    ["busybox:1", "metrics", "50m"],
  ]);
  rejected(undo, "kubectl set image deployment/multi-app missing=nginx:2", "not found");
  rejected(undo, "kubectl set resources deployment/multi-app --containers=agent --limits=cpu=10m");
  const all = execute(
    undo,
    "kubectl set image deployment/multi-app '*=nginx:2'",
    "kubectl set env deployment/multi-app ROLE=both",
  );
  expect(
    KubeMulti.spec(deployment(all)).every(
      (c) => c.image === "nginx:2" && c.env[0]?.value === "both",
    ),
  ).toBe(true);
});
test("all images and all CPU requests participate in Pod readiness and HPA", () => {
  const bad = execute(
    multiReady(),
    "kubectl set image deployment/multi-app agent=invalid.example/missing:1",
  );
  expect(endpoints(bad)).toHaveLength(0);
  expect(execute(bad, "kubectl exec deployment/multi-app -c app -- printenv ROLE").text).toBe(
    "frontend",
  );
  const s = execute(
    multiReady(),
    "kubectl autoscale deployment/multi-app --min=1 --max=10 --cpu-percent=50",
    "sim kubernetes reconcile multi-app --cpu=300m",
  );
  expect(deployment(s).replicas).toBe(4);
  expect(Option.unwrap(s.world.kubeHpas[0]?.lastEvaluation ?? Option.none).requestMilli).toBe(300);
  const missing = file(ready(), "multi-app.json");
  delete missing.spec.template.spec.containers[1].resources.requests.cpu;
  const noCpu = execute(
    write(ready(), missing),
    "kubectl apply -f test.json",
    "sim kubernetes probe multi-app -c app --status-code=200",
    "sim kubernetes probe multi-app -c agent --status-code=200",
    "kubectl autoscale deployment/multi-app --max=5 --cpu-percent=50",
    "sim kubernetes reconcile multi-app --cpu=300m",
  );
  expect(Option.unwrap(noCpu.world.kubeHpas[0]?.lastEvaluation ?? Option.none).reason).toBe(
    "MissingCpuRequest",
  );
});
test("ConfigMap environments and mounts are independent per container and persist through snapshot/scale/delete", () => {
  const s = execute(ready(), "kubectl create configmap cfg --from-literal=MODE=old");
  const m = file(s, "multi-app.json");
  m.spec.template.spec.volumes = [{ name: "settings", configMap: { name: "cfg" } }];
  for (const c of m.spec.template.spec.containers) {
    c.env = [{ name: "MODE", valueFrom: { configMapKeyRef: { name: "cfg", key: "MODE" } } }];
    c.volumeMounts = [{ name: "settings", mountPath: "/cfg" }];
  }
  const applied = execute(
    write(s, m),
    "kubectl apply -f test.json",
    "kubectl delete configmap cfg",
    "kubectl create configmap cfg --from-literal=MODE=new",
    "kubectl scale deployment/multi-app --replicas=3",
  );
  expect(
    execute(applied, `kubectl exec ${pods(applied)[0]?.name} -c agent -- printenv MODE`).text,
  ).toBe("old");
  expect(
    execute(applied, `kubectl exec ${pods(applied)[2]?.name} -c agent -- printenv MODE`).text,
  ).toBe("new");
  expect(
    execute(applied, `kubectl exec ${pods(applied)[0]?.name} -c agent -- cat /cfg/MODE`).text,
  ).toBe("new");
  const deleted = execute(restore(applied), `kubectl delete pod ${pods(applied)[0]?.name}`);
  expect(
    execute(deleted, `kubectl exec ${pods(deleted)[0]?.name} -c agent -- printenv MODE`).text,
  ).toBe("new");
  expect(restore(deleted).world).toEqual(deleted.world);
});
test.each(["duplicate", "too-many", "bad-name", "bad-env", "bad-mount"])(
  "invalid multi-container manifest is rejected atomically: %s",
  (kind) => {
    const s = ready();
    const m = file(s, "multi-app.json");
    const cs = m.spec.template.spec.containers;
    if (kind === "duplicate") {
      cs[1].name = cs[0].name;
    }
    if (kind === "too-many") {
      m.spec.template.spec.containers = Array.from({ length: 11 }, (_, i) => ({
        name: `c${i}`,
        image: "nginx:1",
      }));
    }
    if (kind === "bad-name") {
      cs[1].name = "UPPER";
    }
    if (kind === "bad-env") {
      cs[1].env = [{ name: "BAD-NAME", value: "x" }];
    }
    if (kind === "bad-mount") {
      cs[1].volumeMounts = [{ name: "missing", mountPath: "/cfg" }];
    }
    rejected(write(s, m), "kubectl apply -f test.json");
  },
);
test("saved extra container runtime and retained revisions are strictly validated", () => {
  const s = multiReady();
  const invalids = [
    (d: ReturnType<typeof snapshot>["world"]["kubeDeployments"][number]) => {
      d.extraContainers[0].name = "app";
    },
    (d: ReturnType<typeof snapshot>["world"]["kubeDeployments"][number]) => {
      d.extraContainers[0].podReadiness[0].podName = "missing";
    },
    (d: ReturnType<typeof snapshot>["world"]["kubeDeployments"][number]) => {
      d.extraContainers[0].podEnvironments[0].values[0].name = "OTHER";
    },
    (d: ReturnType<typeof snapshot>["world"]["kubeDeployments"][number]) => {
      d.revisions[0].extraContainers[0].image = "different:1";
    },
    (d: ReturnType<typeof snapshot>["world"]["kubeDeployments"][number]) => {
      d.podResources[0].podName = "missing";
    },
  ];
  for (const mutate of invalids) {
    const value = snapshot(s);
    mutate(value.world.kubeDeployments[0]);
    expect(Result.isOk(Snapshot.fromUnknown(value))).toBe(false);
  }
  expect(Engine.completionCandidates(s.world, "sim files load kubernetes-gke-f")).toContain(
    "kubernetes-gke-final",
  );
});

test("startup gates only its own container; sibling probes and execution remain available", () => {
  const s = ready();
  const m = file(s, "multi-app.json");
  m.spec.template.spec.containers[1].startupProbe = {
    httpGet: { path: "/start", port: 8080 },
    failureThreshold: 2,
  };
  const applied = execute(
    write(s, m),
    "kubectl apply -f test.json",
    "sim kubernetes probe multi-app -c app --status-code=200",
  );
  rejected(
    applied,
    "sim kubernetes probe multi-app -c agent --status-code=200",
    "StartupProbePending",
  );
  const started = execute(
    applied,
    "sim kubernetes probe multi-app -c agent --kind=startup --status-code=200",
    "sim kubernetes probe multi-app -c agent --status-code=200",
  );
  expect(json(started, "kubectl get pods -o json").items[0].ready).toBe("2/2");
  const restarted = execute(
    started,
    "sim kubernetes probe multi-app -c agent --kind=liveness --status-code=500",
  );
  expect(json(restarted, "kubectl get pods -o json").items[0].ready).toBe("1/2");
  expect(restore(restarted).world).toEqual(restarted.world);
});
test("env wildcard validates the final size in every container before mutation", () => {
  const s = ready();
  const m = file(s, "multi-app.json");
  m.spec.template.spec.containers[1].env = Array.from({ length: 100 }, (_, i) => ({
    name: `V${i}`,
    value: "x",
  }));
  const applied = execute(write(s, m), "kubectl apply -f test.json");
  rejected(applied, "kubectl set env deployment/multi-app NEW=bad", "maximum 100");
  const primaryOnly = execute(
    applied,
    "kubectl set env deployment/multi-app --containers=app NEW=ok",
  );
  expect(KubeMulti.spec(deployment(primaryOnly))[1]?.env).toHaveLength(100);
});
test("mixed manifests fail atomically when a later container or ServiceAccount reference is unsupported", () => {
  const s = ready();
  const value = `${s.world.kubeFiles["identity-account.json"]}\n---\n${s.world.kubeFiles["multi-app.json"]?.replace('"name": "agent"', '"name": "app"')}`;
  const written = execute(s, `sim files write atomic.yaml --content='${value}'`);
  rejected(written, "kubectl apply -f atomic.yaml");
  expect(written.world.kubeServiceAccounts).toEqual([]);
});
test("Pod QoS accounts for all regular containers rather than only the primary", () => {
  const s = execute(
    multi(),
    "kubectl set resources deployment/multi-app --requests=cpu=250m,memory=64Mi --limits=cpu=250m,memory=64Mi",
  );
  expect(json(s, "kubectl get pods -o json").items[0].status.qosClass).toBe("Guaranteed");
  const mixed = execute(
    s,
    "kubectl set resources deployment/multi-app --containers=agent --requests=cpu=0,memory=0 --limits=cpu=0,memory=0",
  );
  expect(json(mixed, "kubectl get pods -o json").items[0].status.qosClass).toBe("Burstable");
});
