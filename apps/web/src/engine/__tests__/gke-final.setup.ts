import { expect } from "vitest";
import { Now, run, type Session, session } from "@/engine/__tests__/setup";
import { KubePod } from "@/engine/domains/kubernetes";
import { World } from "@/engine/domains/world";
import { Snapshot } from "@/engine/snapshot";
import { Result } from "@/utils/Result";

export const execute = (s: Session, ...commands: string[]): Session =>
  commands.reduce((s, command) => {
    const next = run(s, command);
    expect(next.text, command).not.toMatch(/^(ERROR:|error:|Error from server)/m);
    expect(World.validate(next.world), command).toEqual(Result.ok(next.world));
    return next;
  }, s);
export const ready = (
  name = "final-gke",
  flags = "--zone=us-central1-a --enable-vertical-pod-autoscaling",
  s = session(),
) =>
  execute(
    s,
    "gcloud services enable container.googleapis.com",
    `gcloud container clusters create ${name} ${flags}`,
    "sim files load kubernetes-gke-final",
  );
export const auto = (name = "final-auto", s = session()) =>
  execute(
    s,
    "gcloud services enable container.googleapis.com",
    `gcloud container clusters create-auto ${name} --region=us-central1`,
    "sim files load kubernetes-gke-final",
  );
export const deployment = (s: Session, name = "multi-app") => {
  const d = s.world.kubeDeployments.find((d) => d.name === name);
  if (!d) {
    throw new Error(`Missing Deployment ${name}`);
  }
  return d;
};
export const pods = (s: Session, name = "multi-app") => KubePod.fromDeployment(deployment(s, name));
export const json = (s: Session, command: string) => JSON.parse(execute(s, command).text);
export const write = (s: Session, value: unknown, name = "test.json") =>
  execute(s, `sim files write ${name} --content='${JSON.stringify(value)}'`);
export const file = (s: Session, name: string) => JSON.parse(s.world.kubeFiles[name] ?? "");
export const rejected = (s: Session, command: string, message?: string) => {
  const next = run(s, command);
  expect(next.text, command).toMatch(/^(ERROR:|error:|Error from server)/m);
  if (message) {
    expect(next.text).toContain(message);
  }
  expect(next.world).toEqual(s.world);
};
export const snapshot = (s: Session) => JSON.parse(JSON.stringify(Snapshot.create(s.world, Now)));
export const restore = (s: Session) => session(Result.unwrap(Snapshot.fromUnknown(snapshot(s))));
export const multi = (s = ready()) =>
  execute(s, "kubectl apply -f multi-app.json", "kubectl apply -f multi-service.json");
export const multiReady = (s = multi()) =>
  execute(
    s,
    "sim kubernetes probe multi-app -c app --status-code=200",
    "sim kubernetes probe multi-app -c agent --status-code=200",
  );
export const vpa = (mode: "Off" | "Initial" | "Recreate" = "Off", s = ready()) =>
  execute(
    s,
    "kubectl apply -f rightsize-app.json",
    `kubectl apply -f ${mode === "Off" ? "rightsize-vpa.json" : `rightsize-${mode.toLowerCase()}.json`}`,
  );
export const recommendation = (s: Session) =>
  execute(s, "sim kubernetes recommend-vpa rightsize --cpu=250m --memory=100Mi");
export const identity = (s = auto()) =>
  execute(
    s,
    "gcloud services enable iamcredentials.googleapis.com",
    "gcloud iam service-accounts create lesson-reader",
    "gcloud storage buckets create gs://ace-workload-data --location=us-central1",
    "kubectl apply -f identity-account.json",
    "kubectl apply -f identity-app.json",
  );
export const linked = (s = identity()) =>
  execute(
    s,
    "gcloud iam service-accounts add-iam-policy-binding lesson-reader@ace-dev-01.iam.gserviceaccount.com --role=roles/iam.workloadIdentityUser --member='serviceAccount:ace-dev-01.svc.id.goog[default/bucket-reader]'",
    "kubectl annotate sa bucket-reader iam.gke.io/gcp-service-account=lesson-reader@ace-dev-01.iam.gserviceaccount.com",
    "gcloud storage buckets add-iam-policy-binding gs://ace-workload-data --member=serviceAccount:lesson-reader@ace-dev-01.iam.gserviceaccount.com --role=roles/storage.objectViewer",
  );
export const access = (s: Session, permission = "storage.objects.list", extra = "") =>
  execute(
    s,
    `sim kubernetes check-access identity-app --bucket=ace-workload-data --permission=${permission} ${extra}`,
  );
