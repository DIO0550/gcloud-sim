import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";

import { run, session } from "@/engine/__tests__/setup";
import { renderSimulator, resourceTree } from "@/features/simulator/__tests__/setup";

const zone = "--zone=asia-northeast1-a";

test("ディスクを選ぶとプロパティに大きさと繋いでいるインスタンスが出て、describe はゾーン付き", async () => {
  const user = userEvent.setup();
  const s = run(
    session(),
    `gcloud compute disks create data-1 ${zone} --size=200GB`,
    `gcloud compute instances create web-1 ${zone}`,
    `gcloud compute instances attach-disk web-1 --disk=data-1 ${zone}`,
  );
  const { terminal } = renderSimulator({}, s.world);
  const tree = resourceTree();
  await user.click(within(tree).getByText("data-1"));
  const details = screen.getByRole("complementary", { name: "詳細" });
  expect(within(details).getByRole("heading", { name: "data-1" })).toBeInTheDocument();
  expect(within(details).getByText("200")).toBeInTheDocument();
  expect(within(details).getByText("web-1")).toBeInTheDocument();
  await user.click(within(details).getByRole("button", { name: "describe を挿入" }));
  await waitFor(() =>
    expect(terminal.written.at(-1)).toContain(
      "gcloud compute disks describe data-1 --zone=asia-northeast1-a",
    ),
  );
});

test("クラスタの下の Deployment を選ぶと Pod の一覧が出る", async () => {
  const user = userEvent.setup();
  const s = run(
    session(),
    "gcloud services enable container.googleapis.com",
    `gcloud container clusters create app ${zone} --quiet`,
    `gcloud container clusters get-credentials app ${zone}`,
    "kubectl apply -f deployment.yaml",
  );
  renderSimulator({}, s.world);
  const tree = resourceTree();
  await user.click(within(tree).getByRole("button", { name: "app を展開する" }));
  await user.click(within(tree).getByText("deploy: web"));
  const details = screen.getByRole("complementary", { name: "詳細" });
  expect(within(details).getByText("Pod")).toBeInTheDocument();
  expect(within(details).getAllByText(/^web-/).length).toBe(2);
});

test("予算を選ぶとしきい値が百分率で出る", async () => {
  const user = userEvent.setup();
  const s = run(
    session(),
    "gcloud billing budgets create --billing-account=01AB2C-DEF345-6789AB --display-name=dev --budget-amount=100000JPY",
  );
  renderSimulator({}, s.world);
  const tree = resourceTree();
  await user.click(within(tree).getByText("budget: dev"));
  const details = screen.getByRole("complementary", { name: "詳細" });
  expect(within(details).getByText("50%, 90%, 100%")).toBeInTheDocument();
  expect(within(details).getByText("100000 JPY")).toBeInTheDocument();
});
