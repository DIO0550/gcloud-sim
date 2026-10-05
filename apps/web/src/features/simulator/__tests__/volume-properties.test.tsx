import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { run, session } from "@/engine/__tests__/setup";
import { KubeDeploymentProperties } from "@/features/simulator/components/ServiceProperties";

test("volume properties show mount sources and decoded file sizes without revealing Secret/binary content", () => {
  const s = run(
    session(),
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create-auto volume-gke --region=us-central1",
    "sim files load kubernetes-volumes",
    "kubectl apply -f volume-settings.yaml",
    "kubectl apply -f volume-credentials.yaml",
    "sim files replace volume-web.yaml --search='key: missing.conf' --replacement='key: app.conf'",
    "kubectl apply -f volume-web.yaml",
  );
  render(
    <KubeDeploymentProperties
      world={s.world}
      selection={{
        kind: "kube-deployment",
        projectId: "ace-dev-01",
        cluster: "volume-gke",
        namespace: "default",
        name: "volume-web",
      }}
    />,
  );
  expect(screen.getByText("設定ファイルのマウント")).toBeInTheDocument();
  expect(screen.getByText("/etc/credentials")).toBeInTheDocument();
  expect(screen.getByText("secret/volume-credentials（設定更新を反映）")).toBeInTheDocument();
  expect(screen.getAllByText("4 bytes")).toHaveLength(2);
  expect(screen.queryByText("demo-volume-token")).not.toBeInTheDocument();
  expect(screen.queryByText("AP+AAQ==")).not.toBeInTheDocument();
});
test("subPath properties explain Pod creation content and show normal update behavior", () => {
  const s = run(
    session(),
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create-auto reload-gke --region=us-central1",
    "sim files load kubernetes-volume-refresh",
    "kubectl apply -f reload-settings.yaml",
    "kubectl apply -f reload-web.yaml",
  );
  render(
    <KubeDeploymentProperties
      world={s.world}
      selection={{
        kind: "kube-deployment",
        projectId: "ace-dev-01",
        cluster: "reload-gke",
        namespace: "default",
        name: "reload-web",
      }}
    />,
  );
  expect(
    screen.getByText("configmap/reload-settings subPath:MODE（Pod作成時の内容）"),
  ).toBeInTheDocument();
  expect(screen.getByText("configmap/reload-settings（設定更新を反映）")).toBeInTheDocument();
  expect(screen.getAllByText("7 bytes")).toHaveLength(4);
});
