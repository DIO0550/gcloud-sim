import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { run, session } from "@/engine/__tests__/setup";
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
