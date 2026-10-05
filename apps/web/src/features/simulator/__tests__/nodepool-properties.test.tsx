import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { run, session } from "@/engine/__tests__/setup";
import { NodePoolProperties } from "@/features/simulator/components/ServiceProperties";

const args = "--cluster=ops-gke --zone=us-central1-a";
const base = () =>
  run(
    session(),
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create ops-gke --zone=us-central1-a --num-nodes=2",
    `gcloud container node-pools create apps ${args} --num-nodes=1`,
  );
const selection = {
  kind: "node-pool",
  projectId: "ace-dev-01",
  cluster: "ops-gke",
  name: "apps",
} as const;

test("node pool shows saved management, bounds and explicit scale evaluation", () => {
  const s = run(
    base(),
    `gcloud container node-pools update apps ${args} --enable-autoscaling --min-nodes=1 --max-nodes=4`,
    `sim gke autoscale-nodes apps ${args} --required-nodes=10`,
  );
  render(<NodePoolProperties world={s.world} selection={selection} />);
  expect(screen.getByText("1〜4 / zone")).toBeInTheDocument();
  expect(screen.getByText("1 → 4")).toBeInTheDocument();
  expect(screen.getByText("10")).toBeInTheDocument();
  expect(screen.getByText("autoRepair")).toBeInTheDocument();
  expect(screen.getByText("autoUpgrade")).toBeInTheDocument();
  expect(screen.getByText(/実ノード・Pod配置・定期処理は未再現/)).toBeInTheDocument();
});

test("master-only upgrade leaves default pool properties at the old node version", () => {
  const s = run(
    base(),
    "gcloud container clusters upgrade ops-gke --zone=us-central1-a --master --quiet",
  );
  render(<NodePoolProperties world={s.world} selection={{ ...selection, name: "default-pool" }} />);
  expect(screen.getByText("1.31.5-gke.1068000")).toBeInTheDocument();
  expect(screen.getByText("2")).toBeInTheDocument();
  expect(screen.getByText("無効")).toBeInTheDocument();
  expect(screen.queryByText("1.32.2-gke.1182000")).not.toBeInTheDocument();
});

test("deleted default pool is missing and not synthesized in properties", () => {
  const s = run(base(), `gcloud container node-pools delete default-pool ${args} --quiet`);
  render(<NodePoolProperties world={s.world} selection={{ ...selection, name: "default-pool" }} />);
  expect(screen.getByText(/見つかりません/)).toBeInTheDocument();
  expect(screen.queryByText("1.31.5-gke.1068000")).not.toBeInTheDocument();
});
