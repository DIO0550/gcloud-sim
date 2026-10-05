import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { run, session } from "@/engine/__tests__/setup";
import { KubeConfigProperties } from "@/features/simulator/components/ServiceProperties";

test.each([
  { binaryData: { "asset.bin": "AP+AAQ==" }, size: "4 bytes" },
  { binaryData: { "asset.bin": "" }, size: "0 bytes" },
])(
  "binaryData properties show the decoded size without rendering raw bytes or base64: %j",
  ({ binaryData, size }) => {
    const manifest = JSON.stringify({
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: { name: "asset-settings" },
      data: { MODE: "production" },
      binaryData,
    });
    const s = run(
      session(),
      "gcloud services enable container.googleapis.com",
      "gcloud container clusters create-auto binary-gke --region=us-central1",
      `sim files write config.json --content='${manifest}'`,
      "kubectl apply -f config.json",
    );
    expect(s.text).not.toContain("error:");
    render(
      <KubeConfigProperties
        world={s.world}
        selection={{
          kind: "kube-config",
          resourceKind: "configmap",
          projectId: "ace-dev-01",
          cluster: "binary-gke",
          namespace: "default",
          name: "asset-settings",
        }}
      />,
    );
    expect(screen.getByText("binaryData（サイズ）")).toBeInTheDocument();
    expect(screen.getByText("asset.bin")).toBeInTheDocument();
    expect(screen.getByText(size)).toBeInTheDocument();
    expect(screen.getByText("production")).toBeInTheDocument();
    expect(screen.queryByText("AP+AAQ==")).not.toBeInTheDocument();
  },
);
