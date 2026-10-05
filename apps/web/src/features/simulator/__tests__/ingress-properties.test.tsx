import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { run, session } from "@/engine/__tests__/setup";
import { IngressProperties } from "@/features/simulator/components/IngressProperties";

const base = () =>
  run(
    session(),
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create-auto ingress-gke --region=us-central1",
    "sim files load kubernetes-ingress",
    "kubectl apply -f ingress-workloads.yaml",
    "kubectl apply -f ingress-routes.json",
  );
const selection = {
  kind: "kube-ingress",
  projectId: "ace-dev-01",
  cluster: "ingress-gke",
  name: "app-entry",
} as const;
test("missing Service is diagnosed next to host/path rules and simulated address", () => {
  render(<IngressProperties world={base().world} selection={selection} />);
  expect(screen.getByText("確認が必要")).toBeInTheDocument();
  expect(screen.getByText(/Service wrong-api not found/)).toBeInTheDocument();
  expect(screen.getByText("app.example.test /api/health")).toBeInTheDocument();
  expect(screen.getByText("Exact")).toBeInTheDocument();
  expect(screen.getByText(/未割り当て/)).toBeInTheDocument();
});
test("repaired backend removes diagnosis while retaining limits and no-fallback message", () => {
  const s = run(
    base(),
    "sim files replace ingress-routes.json --search=wrong-api --replacement=api",
    "kubectl apply -f ingress-routes.json",
  );
  render(<IngressProperties world={s.world} selection={selection} />);
  expect(screen.getByText("全ServiceにReadyな接続先あり")).toBeInTheDocument();
  expect(screen.queryByText("接続先の診断")).not.toBeInTheDocument();
  expect(screen.getByText("なし（未一致はNO_ROUTE）")).toBeInTheDocument();
  expect(screen.getByText(/実LB・DNS・TLS・HTTPヘルスチェック/)).toBeInTheDocument();
});
test("same name in a missing namespace does not show the default namespace resource", () => {
  render(
    <IngressProperties world={base().world} selection={{ ...selection, namespace: "staging" }} />,
  );
  expect(screen.queryByText("app.example.test /api")).not.toBeInTheDocument();
  expect(screen.getByText(/Ingress/)).toBeInTheDocument();
});
