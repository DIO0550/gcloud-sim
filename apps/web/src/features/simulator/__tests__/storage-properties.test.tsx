import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { run, session } from "@/engine/__tests__/setup";
import { KubeStorageProperties } from "@/features/simulator/components/ServiceProperties";

const required = <T,>(value: T | undefined): T => {
  if (value === undefined) throw new Error("Missing test fixture");
  return value;
};
const base = () =>
  run(
    session(),
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create-auto storage-gke --region=us-central1",
    "sim files load kubernetes-storage",
    "kubectl apply -f archive-class.yaml",
    "kubectl apply -f storage-claim.yaml",
  );
const selection = {
  kind: "kube-storage",
  projectId: "ace-dev-01",
  cluster: "storage-gke",
  name: "app-data",
  resourceKind: "pvc",
} as const;
test("PVC properties show Pending/Bound, requested capacity and single-node access semantics", () => {
  const s = base();
  const { rerender } = render(<KubeStorageProperties world={s.world} selection={selection} />);
  expect(screen.getByText("Pending")).toBeInTheDocument();
  expect(screen.getByText(/WaitForFirstConsumer:/)).toBeInTheDocument();
  const next = run(s, "kubectl apply -f storage-web.yaml");
  rerender(<KubeStorageProperties world={next.world} selection={selection} />);
  expect(screen.getAllByText("Bound")).toHaveLength(2);
  expect(screen.getByText("1Gi")).toBeInTheDocument();
  expect(
    screen.getByText("ReadWriteOnce（1ノード。Pod数の制限ではありません）"),
  ).toBeInTheDocument();
});
test("retained PV shows Released and UTF-8 byte sizes while hiding application content", () => {
  const s = run(
    base(),
    "kubectl apply -f storage-web.yaml",
    "sim kubernetes write-file storage-web --path=/data/message.txt --content=keep-me",
    "kubectl delete pvc app-data",
    "kubectl scale deployment/storage-web --replicas=0",
  );
  render(
    <KubeStorageProperties
      world={s.world}
      selection={{ ...selection, resourceKind: "pv", name: required(s.world.kubePvs[0]).name }}
    />,
  );
  expect(screen.getByText("Released")).toBeInTheDocument();
  expect(screen.getByText("Retain")).toBeInTheDocument();
  expect(screen.getByText("message.txt")).toBeInTheDocument();
  expect(screen.getByText("7 bytes")).toBeInTheDocument();
  expect(screen.queryByText("keep-me")).not.toBeInTheDocument();
});
test("StorageClass properties expose driver, binding, reclaim and expansion settings", () => {
  const s = base();
  render(
    <KubeStorageProperties
      world={s.world}
      selection={{ ...selection, resourceKind: "storageclass", name: "archive" }}
    />,
  );
  expect(screen.getByText("pd.csi.storage.gke.io")).toBeInTheDocument();
  expect(screen.getByText("WaitForFirstConsumer")).toBeInTheDocument();
  expect(screen.getByText("Retain")).toBeInTheDocument();
  expect(screen.getByText("true")).toBeInTheDocument();
});
