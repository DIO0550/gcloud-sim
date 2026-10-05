import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { run, session } from "@/engine/__tests__/setup";
import { NetworkPolicyProperties } from "@/features/simulator/components/NetworkPolicyProperties";

const selection = {
  kind: "kube-network-policy",
  projectId: "ace-dev-01",
  cluster: "policy-gke",
  name: "deny-backend",
} as const;
const base = (standard = false) =>
  run(
    session(),
    "gcloud services enable container.googleapis.com",
    `gcloud container clusters ${standard ? "create" : "create-auto"} policy-gke --region=us-central1`,
    "sim files load kubernetes-network-policy",
    "kubectl apply -f network-workloads.yaml",
    "kubectl apply -f deny-ingress.json",
  );
test("default deny properties show selected Pods, active direction and additive semantics", () => {
  render(<NetworkPolicyProperties world={base().world} selection={selection} />);
  expect(screen.getByText("app=backend")).toBeInTheDocument();
  expect(screen.getByText("1 Pod")).toBeInTheDocument();
  expect(screen.getByText(/Ingress（受信）: 許可ルールなし/)).toBeInTheDocument();
  expect(screen.getByText(/Egress（送信）はこのポリシーの対象外/)).toBeInTheDocument();
  expect(screen.getByText(/許可はポリシー間で合算/)).toBeInTheDocument();
});
test("namespace and Pod peers appear together with the numeric TCP port", () => {
  const s = run(
    base(),
    "kubectl apply -f network-namespaces.yaml",
    "kubectl apply -f cross-workloads.yaml",
    "sim files replace cross-ingress.json --search=wrong-client --replacement=client",
    "kubectl apply -f cross-ingress.json",
  );
  render(
    <NetworkPolicyProperties
      world={s.world}
      selection={{ ...selection, namespace: "data-ns", name: "allow-client" }}
    />,
  );
  expect(
    screen.getByText("kubernetes.io/metadata.name=client-ns / app=client"),
  ).toBeInTheDocument();
  expect(screen.getByText("8080/TCP")).toBeInTheDocument();
  expect(screen.getByText(/AND条件になります/)).toBeInTheDocument();
});
test("a saved policy on Standard without enforcement is clearly disabled", () => {
  render(<NetworkPolicyProperties world={base(true).world} selection={selection} />);
  expect(screen.getByText("無効（保存したルールは強制されません）")).toBeInTheDocument();
});
