import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { run, session } from "@/engine/__tests__/setup";
import { KubeConfigProperties } from "@/features/simulator/components/ServiceProperties";

const ready = () =>
  run(
    session(),
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create-auto labels-gke --region=us-central1",
    "sim files load kubernetes-config-labels",
    "kubectl apply -f labeled-configs.yaml",
    "kubectl label cm settings-prod environment=production app=web --overwrite",
    "kubectl label secret credentials environment=production app=web",
  );

test.each(["configmap", "secret"] as const)(
  "%s properties show metadata labels while Secret data stays hidden",
  (kind) => {
    const s = ready();
    expect(s.text).not.toContain("error:");
    const name = kind === "secret" ? "credentials" : "settings-prod";
    render(
      <KubeConfigProperties
        world={s.world}
        selection={{
          kind: "kube-config",
          projectId: "ace-dev-01",
          cluster: "labels-gke",
          namespace: "default",
          resourceKind: kind,
          name,
        }}
      />,
    );
    expect(screen.getByText("labels")).toBeInTheDocument();
    expect(
      screen.getByText(
        kind === "secret"
          ? "app=web, environment=production"
          : "app=web, environment=production, temporary=cleanup",
      ),
    ).toBeInTheDocument();
    if (kind === "secret") {
      expect(screen.getByText("10 bytes")).toBeInTheDocument();
      expect(screen.queryByText("demo-token")).not.toBeInTheDocument();
      expect(screen.queryByText("ZGVtby10b2tlbg==")).not.toBeInTheDocument();
    }
  },
);
