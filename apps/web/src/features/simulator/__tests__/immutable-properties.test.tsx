import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { run, session } from "@/engine/__tests__/setup";
import { KubeConfigProperties } from "@/features/simulator/components/ServiceProperties";

test.each(["configmap", "secret"] as const)(
  "%s properties show immutable protection and keep Secret values hidden",
  (kind) => {
    const s = run(
      session(),
      "gcloud services enable container.googleapis.com",
      "gcloud container clusters create-auto immutable-gke --region=us-central1",
      "sim files load kubernetes-immutable",
      "kubectl apply -f frozen-settings.yaml",
      "kubectl apply -f frozen-credentials.yaml",
    );
    expect(s.text).not.toContain("error:");
    render(
      <KubeConfigProperties
        world={s.world}
        selection={{
          kind: "kube-config",
          resourceKind: kind,
          projectId: "ace-dev-01",
          cluster: "immutable-gke",
          namespace: "default",
          name: kind === "secret" ? "frozen-credentials" : "frozen-settings",
        }}
      />,
    );
    expect(screen.getByText("immutable")).toBeInTheDocument();
    expect(screen.getByText("true")).toBeInTheDocument();
    if (kind === "secret") {
      expect(screen.getByText("13 bytes")).toBeInTheDocument();
      expect(screen.queryByText("demo-token-v1")).not.toBeInTheDocument();
      expect(screen.queryByText("ZGVtby10b2tlbi12MQ==")).not.toBeInTheDocument();
    }
  },
);
