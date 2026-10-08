import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { run, session } from "@/engine/__tests__/setup";
import { ServerlessPrelude } from "@/engine/missions/serverless";
import {
  FunctionProperties,
  RunServiceProperties,
} from "@/features/simulator/components/ServiceProperties";

test("Run properties show the selected region's settings and retained revisions", () => {
  const s = run(
    session(),
    ...ServerlessPrelude,
    "gcloud run deploy regional-api --region=us-central1 --image=hello --set-env-vars=STAGE=stable",
    "gcloud run deploy regional-api --region=asia-northeast1 --image=hello --set-env-vars=STAGE=tokyo",
    "gcloud run services update regional-api --region=us-central1 --no-traffic --set-env-vars=STAGE=canary",
  );
  render(
    <RunServiceProperties
      world={s.world}
      selection={{
        kind: "run-service",
        projectId: "ace-dev-01",
        region: "us-central1",
        name: "regional-api",
      }}
    />,
  );
  expect(screen.getByText("設定・実行結果")).toBeInTheDocument();
  expect(screen.getByText("STAGE=canary")).toBeInTheDocument();
  expect(screen.getByText("revision regional-api-00001-abc")).toBeInTheDocument();
  expect(screen.getByText("hello · 100%")).toBeInTheDocument();
  expect(screen.getByText("hello · 0%")).toBeInTheDocument();
  expect(screen.queryByText("STAGE=tokyo")).not.toBeInTheDocument();
});

test("Function properties show invocation failures and runtime identity", () => {
  const s = run(
    session(),
    ...ServerlessPrelude,
    "gcloud functions deploy internal-api --region=us-central1 --runtime=nodejs22 --trigger-http --ingress=internal --service-account=lesson-worker@ace-dev-01.iam.gserviceaccount.com",
    "gcloud functions call internal-api --region=us-central1",
  );
  render(
    <FunctionProperties
      world={s.world}
      selection={{
        kind: "function",
        projectId: "ace-dev-01",
        region: "us-central1",
        name: "internal-api",
      }}
    />,
  );
  expect(screen.getByText("lesson-worker@ace-dev-01.iam.gserviceaccount.com")).toBeInTheDocument();
  expect(screen.getByText("internal / private-ranges-only")).toBeInTheDocument();
  expect(screen.getByText(/FAILED: Ingress blocks/)).toBeInTheDocument();
});
