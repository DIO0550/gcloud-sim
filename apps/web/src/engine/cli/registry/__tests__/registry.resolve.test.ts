// @vitest-environment node
import { expect, test } from "vitest";

import { Engine, Shell } from "@/engine";
import { Now, run, session } from "@/engine/__tests__/setup";
import { CommandRegistry } from "@/engine/cli/registry";
import { notImplemented } from "@/engine/commands/shared";

test("綴りの近いコマンドは Invalid choice と Did you mean を出す", () => {
  const s = run(session(), "gcloud compute instances creat web-1");
  expect(s.text).toContain("ERROR: (gcloud) Invalid choice: 'creat'.");
  expect(s.text).toContain("Did you mean: 'create'?");
});

test("グループで止まると Command name argument expected を出す", () => {
  const s = run(session(), "gcloud compute instances");
  expect(s.text).toContain("Command name argument expected.");
  expect(s.text).toContain("Available commands:");
  expect(s.text).toContain("create");
});

test("gcloud beta は警告を出して同じコマンドに解決する", () => {
  const plain = run(session(), "gcloud config get project");
  const beta = run(session(), "gcloud beta config get project");
  expect(beta.text).toContain("WARNING: gcloud-sim treats 'gcloud beta' as 'gcloud'");
  expect(beta.text).toContain(plain.text);
});

test("gcloud alpha も同じ扱いになる", () => {
  const alpha = run(session(), "gcloud alpha config get project");
  expect(alpha.text).toContain("'gcloud alpha' as 'gcloud'");
  expect(alpha.text).toContain("ace-dev-01");
});

test("--help はヘルプを出して World を変えない", () => {
  const before = session();
  const s = run(before, "gcloud compute instances create --help");
  expect(s.text).toContain(
    "gcloud compute instances create - Create Compute Engine virtual machine instances.",
  );
  expect(s.text).toContain("--machine-type=MACHINE_TYPE");
  expect(s.world).toBe(before.world);
});

test("未実装のコマンドは gcloud-sim 接頭辞のメッセージになり ERROR: では始まらない", () => {
  const registry = CommandRegistry.create([
    ...Engine.registry.specs,
    notImplemented(["gcloud", "future", "thing"], "A command gcloud-sim does not have yet."),
  ]);
  const result = Shell.submit({
    world: session().world,
    state: Shell.Ready,
    line: "gcloud future thing",
    now: Now,
    registry,
  });
  const text = result.lines.map((l) => l.text).join("\n");
  expect(text).toContain("gcloud-sim: command not implemented yet: gcloud future thing");
  expect(text).not.toContain("ERROR:");
});

test("知らないツール名は command not found になる", () => {
  const s = run(session(), "aws s3 ls");
  expect(s.text).toBe("bash: aws: command not found");
});

test("Tab 補完はコマンド名を前方一致で返す", () => {
  expect(Engine.completionCandidates("gcloud compu")).toEqual(["compute"]);
  expect(Engine.completionCandidates("gcloud compute inst")).toEqual([
    "instance-groups",
    "instance-templates",
    "instances",
  ]);
  expect(Engine.completionCandidates("gcloud compute instances ")).toContain("create");
});

test("Tab 補完は - で始まる語にフラグ名を返す", () => {
  expect(Engine.completionCandidates("gcloud compute instances create web-1 --mach")).toEqual([
    "--machine-type",
  ]);
});

test("登録されているコマンドのパスは重複しない", () => {
  const paths = Engine.registry.specs.map((s) => s.path.join(" "));
  expect(new Set(paths).size).toBe(paths.length);
});
