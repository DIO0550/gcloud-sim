// @vitest-environment node
import { expect, test } from "vitest";

import { Engine } from "@/engine";
import { run, session } from "@/engine/__tests__/setup";

const withVms = () =>
  run(
    session(),
    "gcloud compute instances create web-1 --zone=asia-northeast1-a",
    "gcloud compute instances create web-2 --zone=asia-northeast1-a",
    "gcloud compute instances create batch-1 --zone=asia-northeast1-b",
  );

test("位置引数の補完は World のリソース名を前方一致で返す", () => {
  const s = withVms();
  expect(Engine.completionCandidates(s.world, "gcloud compute instances describe we")).toEqual([
    "web-1",
    "web-2",
  ]);
  expect(Engine.completionCandidates(s.world, "gcloud compute instances stop ")).toEqual([
    "batch-1",
    "web-1",
    "web-2",
  ]);
});

test("候補は World の状態から出るので、VM を消せば出なくなる", () => {
  const s = run(
    withVms(),
    "gcloud compute instances delete web-2 --zone=asia-northeast1-a --quiet",
  );
  expect(Engine.completionCandidates(s.world, "gcloud compute instances describe web-")).toEqual([
    "web-1",
  ]);
});

test("--zone=asia-nor の形はフラグ名を残して値を補完する", () => {
  expect(
    Engine.completionCandidates(
      session().world,
      "gcloud compute instances create web-1 --zone=asia-northeast1-",
    ),
  ).toEqual(["--zone=asia-northeast1-a", "--zone=asia-northeast1-b", "--zone=asia-northeast1-c"]);
});

test("--role の値はロールカタログとプロジェクトのカスタムロールから補完する", () => {
  const s = run(
    session(),
    "gcloud iam roles create viewerPlus --project=ace-dev-01 --permissions=compute.instances.list",
  );
  const roles = Engine.completionCandidates(
    s.world,
    "gcloud projects add-iam-policy-binding ace-dev-01 --member=user:dev@example.com --role=roles/comp",
  );
  expect(roles).toContain("--role=roles/compute.admin");
  expect(roles).not.toContain("--role=roles/viewer");
  expect(
    Engine.completionCandidates(
      s.world,
      "gcloud projects add-iam-policy-binding ace-dev-01 --role=projects/",
    ),
  ).toEqual(["--role=projects/ace-dev-01/roles/viewerPlus"]);
});

test("`--flag value` の形（= 無し）でも値を補完し、その値は位置引数に数えない", () => {
  const s = withVms();
  expect(
    Engine.completionCandidates(
      s.world,
      "gcloud compute instances describe --zone asia-northeast1-",
    ),
  ).toEqual(["asia-northeast1-a", "asia-northeast1-b", "asia-northeast1-c"]);
  expect(
    Engine.completionCandidates(
      s.world,
      "gcloud compute instances describe --zone asia-northeast1-a web",
    ),
  ).toEqual(["web-1", "web-2"]);
});

test("gs:// の位置引数は gs:// 付きで補完する", () => {
  const s = run(
    session(),
    "gcloud storage buckets create gs://logs-1",
    "gcloud storage buckets create gs://data-1",
  );
  expect(Engine.completionCandidates(s.world, "gcloud storage buckets describe gs://l")).toEqual([
    "gs://logs-1",
  ]);
  expect(Engine.completionCandidates(s.world, "gsutil ls gs://")).toEqual([
    "gs://data-1",
    "gs://logs-1",
  ]);
});

test("候補は --project で指定したプロジェクトの集合から出る", () => {
  const s = run(
    session(),
    "gcloud compute instances create web-1 --zone=asia-northeast1-a",
    "gcloud billing projects link ace-prod-01 --billing-account=01AB2C-DEF345-6789AB",
    "gcloud services enable compute.googleapis.com --project=ace-prod-01",
    "gcloud compute instances create prod-1 --zone=asia-northeast1-a --project=ace-prod-01",
  );
  expect(
    Engine.completionCandidates(
      s.world,
      "gcloud compute instances describe --project=ace-prod-01 ",
    ),
  ).toEqual(["prod-1"]);
  expect(Engine.completionCandidates(s.world, "gcloud config set project ace-p")).toEqual([]);
  expect(
    Engine.completionCandidates(s.world, "gcloud compute instances list --project=ace-"),
  ).toEqual(["--project=ace-dev-01", "--project=ace-prod-01"]);
});

test("候補を持たない位置引数（新しい名前）や未知のフラグは何も返さない", () => {
  const s = withVms();
  expect(Engine.completionCandidates(s.world, "gcloud compute instances create we")).toEqual([]);
  expect(
    Engine.completionCandidates(s.world, "gcloud compute instances create web-9 --nope="),
  ).toEqual([]);
});

test("プロジェクトが未設定なら World に依る候補は空、カタログの候補は出る", () => {
  const s = run(withVms(), "gcloud config unset project");
  expect(Engine.completionCandidates(s.world, "gcloud compute instances describe ")).toEqual([]);
  expect(
    Engine.completionCandidates(s.world, "gcloud compute instances create x --machine-type=e2-s"),
  ).toEqual([
    "--machine-type=e2-small",
    "--machine-type=e2-standard-2",
    "--machine-type=e2-standard-4",
  ]);
});

test("services enable の可変長の位置引数は 2 つ目以降も API 名を補完する", () => {
  expect(
    Engine.completionCandidates(
      session().world,
      "gcloud services enable compute.googleapis.com cont",
    ),
  ).toEqual(["container.googleapis.com"]);
});

test("enum フラグの値は選択肢から補完する（= の形）", () => {
  expect(
    Engine.completionCandidates(
      session().world,
      "gcloud compute networks create n1 --subnet-mode=",
    ),
  ).toEqual(["--subnet-mode=auto", "--subnet-mode=custom"]);
});

test("enum フラグの値は選択肢から補完する（空白の形）", () => {
  expect(
    Engine.completionCandidates(
      session().world,
      "gcloud compute networks create n1 --subnet-mode ",
    ),
  ).toEqual(["auto", "custom"]);
});

const withDeployment = () =>
  run(
    session(),
    "gcloud services enable container.googleapis.com",
    "gcloud container clusters create app --zone=asia-northeast1-a --num-nodes=2",
    "kubectl create deployment web --image=nginx",
  );

test("別名のフラグの直後は値として扱い、位置引数の候補を出さない", () => {
  const s = withDeployment();
  expect(Engine.completionCandidates(s.world, "kubectl get deployment ")).toEqual(["web"]);
  expect(Engine.completionCandidates(s.world, "kubectl get deployment -n ")).toEqual([]);
});

test("別名のフラグの値は位置引数に数えない", () => {
  const s = withDeployment();
  expect(Engine.completionCandidates(s.world, "kubectl get -n default deployment w")).toEqual([
    "web",
  ]);
});

test("別名（-i）でも、そのフラグの値の候補を引く", () => {
  const s = run(
    session(),
    "gcloud services enable sqladmin.googleapis.com",
    "gcloud sql instances create db1 --database-version=POSTGRES_15 --tier=db-f1-micro --region=asia-northeast1",
  );
  expect(Engine.completionCandidates(s.world, "gcloud sql backups list -i ")).toEqual(["db1"]);
  expect(Engine.completionCandidates(s.world, "gcloud sql backups list --instance=d")).toEqual([
    "--instance=db1",
  ]);
});
