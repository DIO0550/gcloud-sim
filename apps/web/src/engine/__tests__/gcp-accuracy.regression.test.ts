// @vitest-environment node
import { expect, test } from "vitest";

import { Engine } from "@/engine";
import { Now, run, type Session, session } from "@/engine/__tests__/setup";
import { Zone } from "@/engine/domains/catalog";
import { CloudRunService } from "@/engine/domains/managed-services";
import { BucketName } from "@/engine/domains/storage";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const exec = (s: Session, line: string) =>
  Engine.execute({ world: s.world, shell: s.shell, line, now: Now });

test("実在する GCP ゾーンのみを受け付け、us-east1-a / europe-west1-a を拒否する", () => {
  expect(Option.isSome(Zone.parse("us-east1-b"))).toBe(true);
  expect(Option.isSome(Zone.parse("europe-west1-b"))).toBe(true);
  expect(Option.isSome(Zone.parse("us-east1-a"))).toBe(false);
  expect(Option.isSome(Zone.parse("europe-west1-a"))).toBe(false);
  expect(Zone.defaultForRegion("us-east1")).toBe("us-east1-b");
  expect(Zone.defaultForRegion("europe-west1")).toBe("europe-west1-b");
  expect(Zone.defaultForRegion("asia-northeast1")).toBe("asia-northeast1-a");
});

test("AUTO モード VPC の削除は自動サブネットをまとめて削除し、CUSTOM モードはサブネット残存時に拒否する", () => {
  const auto = run(
    session(),
    "gcloud compute networks create auto-vpc --subnet-mode=auto",
    "gcloud compute networks delete auto-vpc --quiet",
  );
  expect(Option.isSome(World.findNetwork(auto.world, "ace-dev-01", "auto-vpc"))).toBe(false);
  expect(World.subnetsOf(auto.world, "ace-dev-01").some((s) => s.network === "auto-vpc")).toBe(
    false,
  );

  const custom = run(
    session(),
    "gcloud compute networks create custom-vpc --subnet-mode=custom",
    "gcloud compute networks subnets create custom-sub --network=custom-vpc --region=asia-northeast1 --range=10.10.0.0/24",
  );
  const blocked = exec(custom, "gcloud compute networks delete custom-vpc --quiet");
  expect(blocked.outcome.kind).toBe("failed");
});

test("ファイアウォールの INGRESS/EGRESS 方向と範囲指定の整合性を検証する", () => {
  const s = session();
  expect(
    exec(
      s,
      "gcloud compute firewall-rules create bad-in --direction=INGRESS --allow=tcp:80 --destination-ranges=10.0.0.0/8",
    ).outcome.kind,
  ).toBe("failed");
  expect(
    exec(
      s,
      "gcloud compute firewall-rules create bad-out --direction=EGRESS --allow=tcp:443 --source-ranges=10.0.0.0/8",
    ).outcome.kind,
  ).toBe("failed");
  const ok = exec(
    s,
    "gcloud compute firewall-rules create allow-out --direction=EGRESS --allow=tcp:443",
  );
  expect(ok.outcome.kind).toBe("succeeded");
  const rule = World.firewallRulesOf(ok.world, "ace-dev-01").find((r) => r.name === "allow-out");
  expect(rule?.destinationRanges).toEqual(["0.0.0.0/0"]);
});

test("0GB ディスク・連続ドット/IPv4 バケット名・非実在フラグ --recursive を拒否する", () => {
  const s = session();
  expect(
    exec(s, "gcloud compute disks create zero-disk --zone=asia-northeast1-a --size=0GB").outcome
      .kind,
  ).toBe("failed");
  expect(Result.isOk(BucketName.parse("bad..bucket"))).toBe(false);
  expect(Result.isOk(BucketName.parse("192.168.1.1"))).toBe(false);
  expect(
    exec(s, "gcloud storage buckets delete gs://ace-dev-01-assets --recursive").outcome.kind,
  ).toBe("failed");
});

test("gsutil -m と gcloud monitoring uptime list-configs が公式構文で動作する", () => {
  const s = run(session(), "gcloud storage buckets create gs://ace-dev-01-multi");
  expect(exec(s, "gsutil -m cp report.csv gs://ace-dev-01-multi/").outcome.kind).toBe("succeeded");
  expect(exec(s, "gcloud monitoring uptime list-configs").outcome.kind).toBe("succeeded");
  expect(exec(s, "gcloud monitoring uptime list").outcome.kind).toBe("failed");
});

test("Cloud Run URL がリージョンに応じた地域コードを使う", () => {
  const tokyo = Result.unwrap(
    CloudRunService.create({
      projectId: "p",
      name: "svc",
      region: "asia-northeast1",
      image: "img",
      allowUnauthenticated: true,
      lastDeployedAt: "2026-01-01T00:00:00Z",
    }),
  );
  const iowa = Result.unwrap(
    CloudRunService.create({
      projectId: "p",
      name: "svc",
      region: "us-central1",
      image: "img",
      allowUnauthenticated: true,
      lastDeployedAt: "2026-01-01T00:00:00Z",
    }),
  );
  expect(CloudRunService.url(tokyo)).toContain("-an.a.run.app");
  expect(CloudRunService.url(iowa)).toContain("-uc.a.run.app");
});
