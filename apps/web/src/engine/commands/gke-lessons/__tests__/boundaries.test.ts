// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import {
  auto,
  execute,
  json,
  multiReady,
  ready,
  recommendation,
  rejected,
  restore,
  snapshot,
  vpa,
} from "@/engine/__tests__/gke-final.setup";
import { session } from "@/engine/__tests__/setup";
import { Snapshot } from "@/engine/snapshot";
import { Result } from "@/utils/Result";

test("viewer can inspect ServiceAccounts and VPAs but cannot mutate them or run recommendations", () => {
  const s = execute(
    recommendation(vpa()),
    "kubectl create serviceaccount viewer-example",
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:dev@example.com --role=roles/container.viewer",
    "gcloud config set account dev@example.com",
  );
  expect(execute(s, "kubectl get sa", "kubectl describe vpa rightsize").text).toContain("300m");
  rejected(
    s,
    "kubectl annotate sa viewer-example iam.gke.io/gcp-service-account=reader@ace-dev-01.iam.gserviceaccount.com",
    "container.serviceAccounts.update",
  );
  rejected(s, "kubectl delete vpa rightsize", "container.thirdPartyObjects.delete");
  rejected(
    s,
    "sim kubernetes recommend-vpa rightsize --cpu=1m --memory=1Mi",
    "container.thirdPartyObjects.update",
  );
});
test("container API must be enabled before Kubernetes account/VPA operations", () => {
  const s = execute(auto(), "gcloud services disable container.googleapis.com");
  rejected(s, "kubectl create serviceaccount denied", "container.googleapis.com");
  rejected(s, "kubectl get vpa", "container.googleapis.com");
});
test("partial manifest write permission does not commit an earlier Deployment when KSA creation is denied", () => {
  const s = execute(
    ready(),
    "gcloud iam roles create DeployOnly --permissions=container.deployments.get,container.deployments.create",
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:dev@example.com --role=projects/ace-dev-01/roles/DeployOnly",
  );
  const content = `${s.world.kubeFiles["autopilot-default.json"]}\n---\n${s.world.kubeFiles["identity-account.json"]}`;
  const written = execute(
    s,
    `sim files write mixed.yaml --content='${content}'`,
    "gcloud config set account dev@example.com",
  );
  rejected(written, "kubectl apply -f mixed.yaml", "container.serviceAccounts.get");
  expect(written.world.kubeDeployments).toHaveLength(0);
});
test("namespace and cluster deletion remove only their own accounts and VPAs", () => {
  const s = execute(
    vpa(),
    "kubectl apply -f identity-account.json",
    "kubectl create namespace staging",
    "kubectl create serviceaccount keep -n staging",
    "kubectl apply -f rightsize-vpa.json -n staging",
  );
  const deleted = execute(s, "kubectl delete namespace staging");
  expect(deleted.world.kubeVpas).toHaveLength(1);
  expect(deleted.world.kubeServiceAccounts).toHaveLength(1);
  const cluster = execute(
    deleted,
    "gcloud container clusters delete final-gke --zone=us-central1-a --quiet",
  );
  expect(cluster.world.kubeVpas).toHaveLength(0);
  expect(cluster.world.kubeServiceAccounts).toHaveLength(0);
  expect(restore(cluster).world).toEqual(cluster.world);
});
test("Workload Identity/VPA updates preserve previous control plane evaluation and existing Pod identity", () => {
  const s = execute(
    ready(),
    "kubectl apply -f rightsize-app.json",
    "sim gke check-control-plane final-gke --zone=us-central1-a --endpoint=public --source-ip=203.0.113.1",
  );
  const updated = execute(
    s,
    "gcloud container clusters update final-gke --zone=us-central1-a --workload-pool=ace-dev-01.svc.id.goog --no-enable-vertical-pod-autoscaling",
  );
  expect(updated.world.clusters[0]?.controlPlane).toEqual(s.world.clusters[0]?.controlPlane);
  expect(updated.world.kubeDeployments).toEqual(s.world.kubeDeployments);
});
test("all custom resource paths and explicit lesson names are present in help/completion", () => {
  const s = execute(vpa(), "kubectl create serviceaccount complete-me");
  expect(Engine.completionCandidates(s.world, "sim kubernetes recommend-vpa ")).toContain(
    "rightsize",
  );
  expect(Engine.completionCandidates(s.world, "kubectl annotate sa ")).toContain("complete-me");
  expect(Engine.completionCandidates(s.world, "kubectl get vpa ")).toContain("rightsize");
  expect(execute(s, "sim kubernetes recommend-vpa --help").text).toContain("Recreate");
  expect(execute(s, "kubectl exec --help").text).toContain("--container");
  expect(execute(s, "gcloud container clusters create --help").text).toContain("--node-locations");
});
test("malformed aggregate HPA and past container revision fail current snapshot validation", () => {
  const s = execute(
    multiReady(),
    "kubectl set image deployment/multi-app agent=busybox:2",
    "kubectl autoscale deployment/multi-app --max=5",
    "sim kubernetes probe multi-app -c app --status-code=200",
    "sim kubernetes probe multi-app -c agent --status-code=200",
    "sim kubernetes reconcile multi-app --cpu=300m",
  );
  const h = snapshot(s);
  h.world.kubeHpas[0].lastEvaluation.value.totalRequestMilli = 0;
  expect(Result.isOk(Snapshot.fromUnknown(h))).toBe(false);
  const history = snapshot(s);
  history.world.kubeDeployments[0].revisions[0].extraContainers[0].name = "app";
  expect(Result.isOk(Snapshot.fromUnknown(history))).toBe(false);
});
test("unsupported Autopilot management overrides are rejected, preserving automatic WI/VPA", () => {
  const s = auto();
  rejected(
    s,
    "gcloud container clusters update final-auto --region=us-central1 --no-enable-vertical-pod-autoscaling",
    "Autopilot manages",
  );
  const clean = execute(session(), "gcloud services enable container.googleapis.com");
  rejected(
    clean,
    "gcloud container clusters create-auto wrong --region=us-central1 --node-locations=us-central1-a",
    "unrecognized",
  );
  expect(
    json(s, "gcloud container clusters describe final-auto --region=us-central1 --format=json"),
  ).toMatchObject({
    workloadIdentityConfig: { workloadPool: "ace-dev-01.svc.id.goog" },
    verticalPodAutoscaling: { enabled: true },
  });
});
