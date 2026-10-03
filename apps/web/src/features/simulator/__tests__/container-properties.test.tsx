import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { run, session } from "@/engine/__tests__/setup";
import { ContainerLab } from "@/engine/domains/container-lab";
import { ContainerLabProperties } from "@/features/simulator/components/ContainerLabProperties";

test("repository properties show remote image versions and inherited/direct IAM", () => {
  const s = run(
    session(),
    "gcloud services enable artifactregistry.googleapis.com",
    "gcloud artifacts repositories create ace-images --location=us-central1 --repository-format=docker",
    "docker build -t us-central1-docker.pkg.dev/ace-dev-01/ace-images/hello:v1 ./hello-web",
    "gcloud auth configure-docker us-central1-docker.pkg.dev",
    "docker push us-central1-docker.pkg.dev/ace-dev-01/ace-images/hello:v1",
    "gcloud artifacts repositories add-iam-policy-binding ace-images --location=us-central1 --member=user:developer@example.com --role=roles/artifactregistry.reader",
  );
  expect(s.text).not.toContain("ERROR:");
  render(
    <ContainerLabProperties
      world={s.world}
      selection={{
        kind: "container-lab",
        collection: "repositories",
        id: "projects/ace-dev-01/locations/us-central1/repositories/ace-images",
      }}
    />,
  );
  expect(screen.getByText("hello: v1")).toBeInTheDocument();
  expect(screen.getByText(ContainerLab.digest("hello-web"))).toBeInTheDocument();
  expect(screen.getByRole("table", { name: "IAM ポリシー" })).toHaveTextContent(
    "roles/artifactregistry.reader",
  );
  expect(screen.getByText("このリポジトリ")).toBeInTheDocument();
});
