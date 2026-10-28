import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";

import { Engine } from "@/engine";
import { initialWorld, run, session } from "@/engine/__tests__/setup";
import { ServiceAccount } from "@/engine/domains/service-account";
import { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import { Mission } from "@/engine/missions";
import { ConsoleMissions } from "@/engine/missions/console";
import { renderSimulator } from "@/features/simulator/__tests__/setup";
import {
  BucketCreateForm,
  BudgetCreateForm,
  FirewallCreateForm,
  IamGrantForm,
  RoleCreateForm,
  ServiceAccountCreateForm,
  VmAction,
  VmCreateForm,
} from "@/features/simulator/features/console/domains/equivalent-command";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const p = F.devProjectId;
const projectNumber = Option.unwrap(World.findProject(initialWorld(), p)).projectNumber;
const vm = VmCreateForm.create({
  zone: "asia-northeast1-a",
  serviceAccount: ServiceAccount.defaultComputeEmail(projectNumber),
});

/** 手順どおりに Console のフォームを埋めたときに流れる行（フォームの toCommand で作る）。 */
const consoleLines: Readonly<Record<string, (world: World) => readonly string[]>> = {
  "m-console-web": () => [
    VmCreateForm.toCommand({ ...vm, name: "console-web", tags: "http-server" }, p),
    FirewallCreateForm.toCommand(
      { ...FirewallCreateForm.create(), name: "console-allow-http", targetTags: "http-server" },
      p,
    ),
  ],
  "m-console-bucket": () => [
    BucketCreateForm.toCommand(
      {
        ...BucketCreateForm.create(),
        name: "ace-dev-01-console-archive",
        storageClass: "COLDLINE",
      },
      p,
    ),
  ],
  "m-console-sa": () => [
    ServiceAccountCreateForm.toCommand(
      { ...ServiceAccountCreateForm.create(), accountId: "console-reader" },
      p,
    ),
    IamGrantForm.toCommand(
      {
        member: `serviceAccount:${ServiceAccount.email("console-reader", p)}`,
        role: "roles/storage.objectViewer",
      },
      p,
    ),
  ],
  "m-console-role": () => [
    RoleCreateForm.toCommand(
      {
        roleId: "consoleVmOperator",
        title: "Console VM Operator",
        permissions:
          "compute.instances.start, compute.instances.stop, compute.instances.get, compute.instances.list",
      },
      p,
    ),
  ],
  "m-console-budget": () => [
    BudgetCreateForm.toCommand(
      {
        ...BudgetCreateForm.create(),
        displayName: "console-budget",
        amount: "45000",
        projectIds: [p],
      },
      F.billingAccountId,
    ),
  ],
  "m-console-stop": (world) => [
    VmAction.toCommand(
      "stop",
      Option.unwrap(World.findInstance(world, p, "asia-northeast1-a", "console-batch")),
    ),
  ],
};

test("Console の演習は公開一覧に入り、手順はすべて画面の操作で「何をするか」を持つ", () => {
  const listed = new Set(Engine.missions().map((m) => m.id));
  for (const mission of ConsoleMissions) {
    expect(listed.has(mission.id), mission.id).toBe(true);
    for (const step of mission.steps) {
      expect(step.what, mission.id).not.toBe("");
      expect(Option.isSome(step.detail) && step.detail.value.kind, mission.id).toBe("action");
    }
  }
  expect(Object.keys(consoleLines).toSorted()).toEqual(ConsoleMissions.map((m) => m.id).toSorted());
});

test.each(ConsoleMissions.map((m) => [m.id, m] as const))(
  "%s は手順どおりのフォーム送信でクリアになる",
  (id, mission) => {
    const started = Result.unwrap(Engine.startMission(initialWorld(), id));
    const lines = consoleLines[id]?.(started) ?? [];
    const done = run(session(started), ...lines);
    expect(Mission.assertionResults(done.world, mission)).toEqual(
      mission.assertions.map(() => true),
    );
    expect(Option.unwrap(World.findMissionProgress(done.world, id)).status).toBe("completed");
  },
);

test("Console 表示でもミッションを開け、Console の演習を画面の操作だけでクリアできる", async () => {
  const user = userEvent.setup();
  renderSimulator();
  await user.click(screen.getByRole("button", { name: "Console" }));
  await user.click(screen.getByRole("button", { name: "ミッション" }));
  const panel = screen.getByRole("complementary", { name: "ミッション" });
  expect(within(panel).getByRole("combobox", { name: "ミッションの操作" })).toHaveValue("console");
  await user.click(
    within(panel).getByRole("button", { name: /3\. クラウド ソリューションの正常な運用/ }),
  );
  await user.click(within(panel).getByRole("button", { name: /Consoleで VM を停止する/ }));
  const steps = within(panel).getByRole("list", { name: "実行手順" });
  expect(steps).toHaveTextContent("止める VM を選ぶ");
  expect(steps).toHaveTextContent("上の「停止」を押す");
  await user.click(within(panel).getByRole("button", { name: "開始" }));
  await user.click(screen.getByRole("checkbox", { name: "console-batch を選択" }));
  await user.click(screen.getByRole("button", { name: "停止" }));
  await waitFor(() =>
    expect(within(panel).getByRole("status")).toHaveTextContent(
      "ミッションクリア「Consoleで VM を停止する」",
    ),
  );
  await user.click(within(panel).getByRole("button", { name: "ミッションを閉じる" }));
  expect(screen.queryByRole("complementary", { name: "ミッション" })).not.toBeInTheDocument();
});

test("CLI の手順はコマンドの前に「何をするか」を出し、「入力行に入れる」で端末に入る", async () => {
  const user = userEvent.setup();
  const { terminal } = renderSimulator();
  await user.click(screen.getByRole("tab", { name: "ミッション" }));
  await user.click(screen.getByRole("button", { name: /1\. クラウド ソリューション環境の設定/ }));
  await user.click(
    screen.getByRole("button", { name: /ace-prod-01 で Compute Engine を使えるようにする/ }),
  );
  const steps = screen.getByRole("list", { name: "実行手順" });
  const first = within(steps).getAllByRole("listitem")[0] as HTMLElement;
  expect(first).toHaveTextContent("ターミナルで実行");
  const line = first.querySelector("code")?.textContent ?? "";
  expect(line).toMatch(/^gcloud /);
  await user.click(within(first).getByRole("button", { name: /を入力行に入れる$/ }));
  await waitFor(() => expect(terminal.written.at(-1)).toContain(line));
});
