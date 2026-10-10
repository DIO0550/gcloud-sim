// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import {
  access,
  auto,
  execute,
  file,
  identity,
  json,
  linked,
  ready,
  rejected,
  restore,
  snapshot,
  write,
} from "@/engine/__tests__/gke-final.setup";
import { Snapshot } from "@/engine/snapshot";
import { Result } from "@/utils/Result";

test("Autopilot requires both annotation and exact workloadIdentityUser binding, API and resource permissions", () => {
  const base = identity();
  expect(access(base).text).toContain("IamServiceAccountMissing");
  const annotated = execute(
    base,
    "kubectl annotate sa bucket-reader iam.gke.io/gcp-service-account=lesson-reader@ace-dev-01.iam.gserviceaccount.com",
  );
  expect(access(annotated).text).toContain("WorkloadIdentityBindingMissing");
  const wrong = execute(
    annotated,
    "gcloud iam service-accounts add-iam-policy-binding lesson-reader@ace-dev-01.iam.gserviceaccount.com --role=roles/iam.workloadIdentityUser --member='serviceAccount:ace-dev-01.svc.id.goog[other/bucket-reader]'",
  );
  expect(access(wrong).text).toContain("WorkloadIdentityBindingMissing");
  const bound = execute(
    annotated,
    "gcloud iam service-accounts add-iam-policy-binding lesson-reader@ace-dev-01.iam.gserviceaccount.com --role=roles/iam.workloadIdentityUser --member='serviceAccount:ace-dev-01.svc.id.goog[default/bucket-reader]'",
  );
  expect(access(bound).text).toContain("ResourcePermissionDenied");
  const permitted = linked(base);
  expect(access(permitted).text).toContain("ALLOW: Allowed");
  expect(access(permitted, "storage.objects.get").text).toContain("ALLOW: Allowed");
  expect(access(permitted, "storage.objects.create").text).toContain(
    "DENY: ResourcePermissionDenied",
  );
  expect(access(permitted, "storage.objects.delete").text).toContain(
    "DENY: ResourcePermissionDenied",
  );
  expect(permitted.world.serviceAccountKeys).toHaveLength(0);
  const checked = access(permitted).world;
  expect({ ...checked, adminLab: permitted.world.adminLab }).toEqual(permitted.world);
  expect(checked.adminLab.observations).toContainEqual({
    projectId: "ace-dev-01",
    kind: "gke-identity",
    resource: "identity-app/storage.objects.list",
    result: "allowed",
    value: 1,
  });
  expect(restore(permitted).world).toEqual(permitted.world);
  const disabled = execute(permitted, "gcloud services disable iamcredentials.googleapis.com");
  expect(access(disabled).text).toContain("IamCredentialsApiDisabled");
});
test("Standard pool enablement and node metadata are separate; selected pool must exist and have nodes", () => {
  const s = linked(identity(ready("standard", "--zone=us-central1-a")));
  expect(access(s).text).toContain("WorkloadIdentityDisabled");
  const enabled = execute(
    s,
    "gcloud container clusters update standard --zone=us-central1-a --workload-pool=ace-dev-01.svc.id.goog",
  );
  expect(enabled.world.nodePools).toEqual(s.world.nodePools);
  expect(access(enabled).text).toContain("GkeMetadataServerDisabled");
  const fixed = execute(
    enabled,
    "gcloud container node-pools update default-pool --cluster=standard --zone=us-central1-a --workload-metadata=GKE_METADATA",
  );
  expect(access(fixed).text).toContain("ALLOW: Allowed");
  expect(access(fixed, "storage.objects.list", "--node-pool=missing").text).toContain(
    "GkeMetadataServerDisabled",
  );
  const noNodes = execute(
    fixed,
    "gcloud container clusters resize standard --zone=us-central1-a --num-nodes=0 --quiet",
  );
  expect(access(noNodes).text).toContain("GkeMetadataServerDisabled");
  rejected(
    s,
    "gcloud container node-pools update default-pool --cluster=standard --zone=us-central1-a --workload-metadata=GKE_METADATA",
    "workload pool",
  );
});
test("node SA access does not grant workload access; unlinked or missing Kubernetes accounts remain denied", () => {
  const s = identity(
    ready("standard", "--zone=us-central1-a --workload-pool=ace-dev-01.svc.id.goog"),
  );
  expect(access(s).text).toContain("IamServiceAccountMissing");
  const permitted = linked(s);
  const deleted = execute(permitted, "kubectl delete sa bucket-reader");
  expect(access(deleted).text).toContain("KubernetesServiceAccountMissing");
  const removed = execute(
    permitted,
    "kubectl annotate sa bucket-reader iam.gke.io/gcp-service-account-",
  );
  expect(access(removed).text).toContain("IamServiceAccountMissing");
  const viewer = execute(
    removed,
    "gcloud storage buckets add-iam-policy-binding gs://ace-workload-data --member=serviceAccount:ace-dev-01-compute@developer.gserviceaccount.com --role=roles/storage.objectViewer",
  );
  expect(access(viewer).text).toContain("IamServiceAccountMissing");
});
test("ServiceAccount namespace, aliases, JSON/YAML, overwrite and cleanup are supported; default is read-only", () => {
  const s = execute(
    auto(),
    "kubectl create namespace staging",
    "kubectl create serviceaccount bucket-reader -n staging",
    "kubectl apply -f identity-account.json",
  );
  expect(
    json(s, "kubectl get sa -n staging -o json").items.map((s: { name: string }) => s.name),
  ).toEqual(["default", "bucket-reader"]);
  expect(execute(s, "kubectl get serviceaccounts -A").text).toContain("staging");
  const linked = execute(
    s,
    "kubectl annotate sa bucket-reader iam.gke.io/gcp-service-account=reader@ace-dev-01.iam.gserviceaccount.com -n staging",
  );
  expect(execute(linked, "kubectl describe sa bucket-reader -n staging").text).toContain(
    "reader@ace-dev-01",
  );
  rejected(
    linked,
    "kubectl annotate sa bucket-reader iam.gke.io/gcp-service-account=other@ace-dev-01.iam.gserviceaccount.com -n staging",
    "overwrite",
  );
  const overwritten = execute(
    linked,
    "kubectl annotate sa bucket-reader iam.gke.io/gcp-service-account=other@ace-dev-01.iam.gserviceaccount.com -n staging --overwrite",
  );
  expect(restore(overwritten).world).toEqual(overwritten.world);
  rejected(s, "kubectl create serviceaccount default", "read-only");
  rejected(s, "kubectl annotate sa bucket-reader unsupported=x", "Unsupported");
  const cleaned = execute(overwritten, "kubectl delete namespace staging");
  expect(cleaned.world.kubeServiceAccounts.map((s) => s.namespace)).toEqual(["default"]);
  expect(Engine.completionCandidates(s.world, "kubectl get sa ")).toContain("bucket-reader");
});
test("ServiceAccount manifest is validated and multi-document permission failures are atomic", () => {
  const s = auto();
  const m = file(s, "identity-account.json");
  m.metadata.annotations = { unsupported: "x" };
  rejected(write(s, m), "kubectl apply -f test.json");
  rejected(s, "kubectl apply -f identity-app.json", "ServiceAccount");
  const dev = execute(s, "gcloud config set account dev@example.com");
  rejected(dev, "kubectl create serviceaccount denied", "container.serviceAccounts.create");
  rejected(dev, "sim kubernetes admit-autopilot missing", "container.deployments.update");
  const permitted = linked();
  const value = snapshot(permitted);
  value.world.kubeServiceAccounts[0].gcpServiceAccount = "not-an-email";
  expect(Result.isOk(Snapshot.fromUnknown(value))).toBe(false);
});
