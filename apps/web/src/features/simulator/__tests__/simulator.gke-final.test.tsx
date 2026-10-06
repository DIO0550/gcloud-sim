import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import {
  execute,
  linked,
  multiReady,
  ready,
  recommendation,
  vpa,
} from "@/engine/__tests__/gke-final.setup";
import { renderSimulator, resourceTree } from "@/features/simulator/__tests__/setup";

const select = async (name: string) => {
  const user = userEvent.setup();
  const tree = resourceTree();
  const expand = within(tree).queryByRole("button", { name: "final-gke を展開する" });
  if (expand) {
    await user.click(expand);
  }
  const expandAuto = within(tree).queryByRole("button", { name: "final-auto を展開する" });
  if (expandAuto) {
    await user.click(expandAuto);
  }
  await user.click(within(tree).getByText(name));
  return screen.getByRole("complementary", { name: "詳細" });
};
test("multi-container properties identify each container's requests, readiness, restarts and environment", async () => {
  renderSimulator({}, multiReady().world);
  const details = await select("deploy: multi-app");
  expect(within(details).getByText("コンテナとID")).toBeInTheDocument();
  expect(within(details).getByText("agent · requests")).toBeInTheDocument();
  expect(within(details).getByText("cpu=50m, memory=32Mi")).toBeInTheDocument();
  expect(within(details).getByText("agent · ROLE")).toBeInTheDocument();
  expect(within(details).getByText("metrics")).toBeInTheDocument();
  expect(within(details).getAllByText(/Ready \/ RESTARTS=0/)).toHaveLength(4);
});
test("VPA Initial properties distinguish the unchanged template from old/new Pod requests and insert scoped describe", async () => {
  const s = execute(
    recommendation(vpa("Initial")),
    "kubectl scale deployment/rightsize-app --replicas=3",
  );
  const { terminal } = renderSimulator({}, s.world);
  const details = await select("vpa: rightsize");
  expect(within(details).getByText("Initial")).toBeInTheDocument();
  expect(within(details).getByText("テンプレートrequests")).toBeInTheDocument();
  expect(within(details).getAllByText("cpu=1, memory=512Mi")).toHaveLength(3);
  expect(within(details).getByText("cpu=300m, memory=120Mi")).toBeInTheDocument();
  await userEvent.setup().click(within(details).getByRole("button", { name: "describe を挿入" }));
  await waitFor(() => expect(terminal.written.at(-1)).toContain("kubectl describe vpa rightsize"));
});
test("ServiceAccount properties explain both sides of the Workload Identity link without a key", async () => {
  renderSimulator({}, linked().world);
  const details = await select("serviceaccount: bucket-reader");
  expect(within(details).getByText("Workload Identity")).toBeInTheDocument();
  expect(
    within(details).getByText("lesson-reader@ace-dev-01.iam.gserviceaccount.com"),
  ).toBeInTheDocument();
  expect(
    within(details).getByText("serviceAccount:ace-dev-01.svc.id.goog[default/bucket-reader]"),
  ).toBeInTheDocument();
  expect(within(details).getByText(/鍵ファイルなし/)).toBeInTheDocument();
});
test("regional cluster properties distinguish configured pool size from total worker count", async () => {
  renderSimulator({}, ready("final-gke", "--region=us-central1 --num-nodes=1").world);
  const details = await select("final-gke");
  expect(within(details).getByText("regional（複数zoneの設定）")).toBeInTheDocument();
  expect(
    within(details).getByText("us-central1-a, us-central1-b, us-central1-c"),
  ).toBeInTheDocument();
  expect(within(details).getByText("総ノード数")).toBeInTheDocument();
  expect(within(details).getByText("3")).toBeInTheDocument();
});
