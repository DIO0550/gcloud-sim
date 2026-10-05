import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { run, session } from "@/engine/__tests__/setup";
import { ClusterProperties } from "@/features/simulator/components/ServiceProperties";

const ready = () =>
  run(
    session(),
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create private-gke --region=us-central1 --enable-private-nodes --enable-ip-alias --master-ipv4-cidr=172.16.0.0/28",
  );
const selection = { kind: "cluster", projectId: "ace-dev-01", name: "private-gke" } as const;

test("private cluster properties distinguish endpoint availability, local credentials and denied source", () => {
  const s = run(
    ready(),
    "gcloud container clusters update private-gke --region=us-central1 --enable-private-endpoint --enable-master-authorized-networks --master-authorized-networks=10.128.0.5/32 --enable-authorized-networks-on-private-endpoint",
    "sim gke check-control-plane private-gke --region=us-central1 --endpoint=private --source-ip=10.128.0.6 --source-network=default",
  );
  render(<ClusterProperties world={s.world} selection={selection} />);
  expect(screen.getByText("172.16.0.2")).toBeInTheDocument();
  expect(screen.getByText("172.16.0.0/28")).toBeInTheDocument();
  expect(screen.getByText("10.128.0.5/32")).toBeInTheDocument();
  expect(screen.getByText("public")).toBeInTheDocument();
  expect(screen.getByText("DENY / source-not-authorized")).toBeInTheDocument();
  expect(screen.getByText("10.128.0.6 / default → private")).toBeInTheDocument();
  expect(screen.getByText(/実通信\/認証\/RBAC/)).toBeInTheDocument();
});

test("credential target and ALLOW show exact evaluated source without a real connectivity claim", () => {
  const s = run(
    ready(),
    "gcloud container clusters get-credentials private-gke --region=us-central1 --internal-ip",
    "sim gke check-control-plane private-gke --region=us-central1 --endpoint=private --source-ip=10.128.0.5 --source-network=default",
  );
  render(<ClusterProperties world={s.world} selection={selection} />);
  expect(screen.getByText("private")).toBeInTheDocument();
  expect(screen.getByText("34.85.0.1")).toBeInTheDocument();
  expect(screen.getByText("ALLOW / same-region-vpc")).toBeInTheDocument();
  expect(screen.getByText("10.128.0.5 / default → private")).toBeInTheDocument();
  expect(screen.getByText("制限なし")).toBeInTheDocument();
});
