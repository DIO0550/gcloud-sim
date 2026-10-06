import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { run, session } from "@/engine/__tests__/setup";
import { KubeStorageProperties } from "@/features/simulator/components/ServiceProperties";
import { StatefulSetProperties } from "@/features/simulator/components/StatefulSetProperties";

const selection = {
  kind: "kube-statefulset",
  projectId: "ace-dev-01",
  cluster: "stateful-gke",
  name: "notes",
} as const;
const base = () =>
  run(
    session(),
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create-auto stateful-gke --region=us-central1",
    "sim files load kubernetes-statefulset",
    "kubectl apply -f stateful-service.yaml",
    "kubectl apply -f stateful-notes.yaml",
    "sim kubernetes write-file pod/notes-0 --path=/data/note.txt --content=first-note",
    "sim kubernetes write-file pod/notes-1 --path=/data/note.txt --content=second-note",
  );

test("StatefulSet properties show independent ordinal claims and file sizes while hiding content", () => {
  render(<StatefulSetProperties world={base().world} selection={selection} />);
  expect(screen.getByText("Pod: notes-0")).toBeInTheDocument();
  expect(screen.getByText("Pod: notes-1")).toBeInTheDocument();
  expect(screen.getByText("data-notes-0")).toBeInTheDocument();
  expect(screen.getByText("data-notes-1")).toBeInTheDocument();
  expect(screen.getByText("note.txt (10 bytes)")).toBeInTheDocument();
  expect(screen.getByText("note.txt (11 bytes)")).toBeInTheDocument();
  expect(screen.queryByText("first-note")).not.toBeInTheDocument();
  expect(screen.queryByText("second-note")).not.toBeInTheDocument();
  expect(screen.getByText("2 / 2")).toBeInTheDocument();
});
test("properties expose actual scale reuse separately from StatefulSet PVC retention", () => {
  const s = run(
    base(),
    "kubectl scale sts/notes --replicas=1",
    "kubectl scale sts/notes --replicas=2",
  );
  render(<StatefulSetProperties world={s.world} selection={selection} />);
  expect(screen.getByText("1 → 2")).toBeInTheDocument();
  expect(screen.getByText(/data-notes-1 \(pvc-sim-/)).toBeInTheDocument();
  expect(screen.getByText("スケールダウン・StatefulSet削除後もRetain")).toBeInTheDocument();
});
test("governing Service diagnostic is independent of successful storage and Pod readiness", () => {
  const s = run(base(), "kubectl delete svc notes-peers");
  render(<StatefulSetProperties world={s.world} selection={selection} />);
  expect(screen.getByText("Governing Service not found")).toBeInTheDocument();
  expect(screen.getByText("2 / 2")).toBeInTheDocument();
  expect(screen.getByText("note.txt (11 bytes)")).toBeInTheDocument();
});

test("PVC properties distinguish same-name Deployment and StatefulSet consumers", () => {
  const manifest = {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: "notes" },
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: "notes" } },
      template: {
        metadata: { labels: { app: "notes" } },
        spec: {
          volumes: [{ name: "data", persistentVolumeClaim: { claimName: "data-notes-0" } }],
          containers: [
            {
              name: "notes",
              image: "nginx:1",
              volumeMounts: [{ name: "data", mountPath: "/data" }],
            },
          ],
        },
      },
    },
  };
  const s = run(
    base(),
    `sim files write shared.json --content='${JSON.stringify(manifest)}'`,
    "kubectl apply -f shared.json",
  );
  expect(s.world.kubeDeployments).toHaveLength(1);
  render(
    <KubeStorageProperties
      world={s.world}
      selection={{ ...selection, kind: "kube-storage", resourceKind: "pvc", name: "data-notes-0" }}
    />,
  );
  expect(screen.getByText("Deployment notes, StatefulSet notes")).toBeInTheDocument();
  expect(screen.queryByText("first-note")).not.toBeInTheDocument();
});
