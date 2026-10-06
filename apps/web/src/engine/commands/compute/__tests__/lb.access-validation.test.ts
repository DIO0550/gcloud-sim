// @vitest-environment node
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { applicationLb, executeLb } from "@/engine/__tests__/lb.setup";
import { run, type Session, session } from "@/engine/__tests__/setup";
import { resourcePermission } from "@/engine/commands/compute/load-balancing/resources";
import { corePermission } from "@/engine/commands/compute/load-balancing/shared";
import { IamPolicy, type RoleName } from "@/engine/domains/iam-policy";
import { LbScope } from "@/engine/domains/load-balancing";
import { LbKinds } from "@/engine/domains/load-balancing/graph";
import { Principal } from "@/engine/domains/principal";
import { RoleCatalog } from "@/engine/domains/role-catalog";
import { World } from "@/engine/domains/world";
import { InitialWorldFixture as F } from "@/engine/initial-world";
import {
  bucketLesson,
  cleanupLesson,
  internalLesson,
  negLesson,
} from "@/engine/missions/load-balancing";
import { Result } from "@/utils/Result";

const reject = (base: Session, command: string) => {
  const wrong = run(base, command);
  expect(wrong.text, command).toMatch(/^ERROR:/m);
  expect(wrong.world, command).toEqual(base.world);
  return wrong;
};
const withRole = (s: Session, role: RoleName): Session =>
  session({
    ...s.world,
    organization: {
      ...s.world.organization,
      iamPolicy: IamPolicy.create([
        { role: "roles/owner", members: ["user:org-admin@example.com"] },
      ]),
    },
    folders: s.world.folders.map((f) => ({ ...f, iamPolicy: IamPolicy.Empty })),
    projects: s.world.projects.map((p) =>
      p.projectId === F.devProjectId
        ? { ...p, iamPolicy: IamPolicy.create([{ role, members: [Principal.toMember(F.owner)] }]) }
        : p,
    ),
  });
test.each([
  "gcloud compute health-checks create http broken --global --region=us-central1",
  "gcloud compute health-checks create http broken --port=0",
  "gcloud compute health-checks create https broken --port=65536",
  "gcloud compute health-checks create tcp broken --request-path=/x",
  "gcloud compute health-checks create http broken --request-path=relative",
  "gcloud compute health-checks create http broken --timeout=10 --check-interval=5",
  "gcloud compute health-checks create broken --http --tcp",
  "gcloud compute health-checks create http broken --use-serving-port",
  "gcloud compute backend-services create bad --global --protocol=TCP --load-balancing-scheme=EXTERNAL --health-checks=web-hc",
  "gcloud compute backend-services create bad --region=us-central1 --protocol=UDP --load-balancing-scheme=EXTERNAL --health-checks=web-hc",
  "gcloud compute backend-services create bad --global --protocol=HTTP --load-balancing-scheme=EXTERNAL_MANAGED --health-checks=ghost",
  "gcloud compute backend-services create bad --region=us-central1 --protocol=HTTP --load-balancing-scheme=INTERNAL_MANAGED --health-checks=web-hc",
  "gcloud compute backend-services add-backend web-backend --global --instance-group=web-group --instance-group-zone=us-east1-b",
  "gcloud compute backend-services add-backend web-backend --global --instance-group=web-group --instance-group-zone=us-central1-a --instance-group-region=us-central1",
  "gcloud compute backend-services add-backend web-backend --global --instance-group=web-group --instance-group-zone=us-central1-a",
  "gcloud compute backend-services add-backend web-backend --global --instance-group=web-group --instance-group-zone=us-central1-a --balancing-mode=RATE",
  "gcloud compute url-maps create bad-map --global --default-service=web-backend --default-backend-bucket=other",
  "gcloud compute url-maps create bad-map --global --default-service=projects/ace-prod-01/global/backendServices/web-backend",
  "gcloud compute url-maps create bad-map --region=us-central1 --default-service=web-backend",
  "gcloud compute target-http-proxies create bad-proxy --global --url-map=web-map --url-map-region=us-central1",
  "gcloud compute target-https-proxies create bad-proxy --global --url-map=web-map",
  "gcloud compute ssl-certificates create bad-cert --global --domains='*.example.test'",
  "gcloud compute ssl-certificates create bad-cert --region=us-central1 --domains=example.test",
  "gcloud compute forwarding-rules create bad-front --global --backend-service=web-backend",
  "gcloud compute forwarding-rules create bad-front --global --target-http-proxy=web-proxy --ports=80 --network-tier=STANDARD",
  "gcloud compute forwarding-rules create bad-front --global --target-http-proxy=web-proxy --ports=80,443",
  "gcloud compute forwarding-rules create bad-front --global --target-http-proxy=web-proxy --ip-protocol=UDP",
  "gcloud compute forwarding-rules create bad-front --global --target-http-proxy=web-proxy --ports=80 --address=web-ip",
  "gcloud compute forwarding-rules create bad-front --global --target-http-proxy=web-proxy --backend-service=web-backend",
  "gcloud compute instance-groups managed set-named-ports web-group --zone=us-central1-a --named-ports=http:80,http:8080",
])("rejects invalid/unsupported configuration atomically: %s", (command) => {
  reject(applicationLb(), command);
});
test("scoped names coexist and describe retrieves the requested health-check location", () => {
  const full = executeLb(
    session(),
    "gcloud compute health-checks create http same --global --port=80",
    "gcloud compute health-checks create https same --region=us-central1 --port=443",
  );
  expect(full.world.healthChecks).toHaveLength(2);
  expect(executeLb(full, "gcloud compute health-checks describe same --global").text).toContain(
    "type: HTTP",
  );
  expect(
    executeLb(full, "gcloud compute health-checks describe same --region=us-central1").text,
  ).toContain("type: HTTPS");
  reject(full, "gcloud compute health-checks create tcp same --region=us-central1");
});
test("all dynamically required LB permissions are known to the deny-capable catalog", () => {
  const dynamic = LbKinds.flatMap((kind) => {
    const locations = ["global"];
    if (kind === "urlMaps" || kind === "targetHttpProxies") {
      locations.push("regions/us-central1");
    }
    const verbs = ["get", "list", "create", "delete"];
    if (kind !== "sslCertificates") {
      verbs.push("use");
    }
    return locations.flatMap((location) =>
      verbs.map((verb) => resourcePermission(kind, location, verb)),
    );
  });
  const supported = dynamic;
  const core = (["backendServices", "forwardingRules", "addresses"] as const).flatMap((kind) =>
    [LbScope.Global, LbScope.region("us-central1")].flatMap((scope) =>
      ["create", "get", "delete"].map((verb) => corePermission(kind, scope, verb)),
    ),
  );
  expect([...supported, ...core].filter((p) => !RoleCatalog.isKnownPermission(p))).toEqual([]);
});
test("regional-only custom role creates regional checks but cannot create global checks", () => {
  const owner = executeLb(
    session(),
    "gcloud iam roles create regionalCheck --permissions=compute.regionHealthChecks.create",
  );
  const scoped = withRole(owner, "projects/ace-dev-01/roles/regionalCheck");
  expect(
    executeLb(scoped, "gcloud compute health-checks create tcp regional --region=us-central1").world
      .healthChecks,
  ).toHaveLength(1);
  reject(scoped, "gcloud compute health-checks create tcp global --global");
});
test("viewer reads new resources and health but cannot modify any graph part", () => {
  const viewer = withRole(applicationLb(), "roles/compute.viewer");
  executeLb(
    viewer,
    "gcloud compute backend-services get-health web-backend --global",
    "gcloud compute url-maps describe web-map --global",
    "gcloud compute target-http-proxies describe web-proxy --global",
    "sim load-balancing probe web-front --global",
  );
  reject(
    viewer,
    "gcloud compute backend-services remove-backend web-backend --global --instance-group=web-group --instance-group-zone=us-central1-a",
  );
  reject(viewer, "sim load-balancing serve web-group --zone=us-central1-a --port=80");
  reject(viewer, "gcloud compute url-maps delete web-map --global --quiet");
});
test("backend create permission alone cannot use a health-check reference", () => {
  const owner = executeLb(
    applicationLb(),
    "gcloud iam roles create createOnly --permissions=compute.backendServices.create",
  );
  const limited = withRole(owner, "projects/ace-dev-01/roles/createOnly");
  expect(
    reject(
      limited,
      "gcloud compute backend-services create other --global --protocol=HTTP --load-balancing-scheme=EXTERNAL_MANAGED --health-checks=web-hc",
    ).text,
  ).toContain("compute.healthChecks.useReadOnly");
});
test("disabled Compute API denies simulation and graph mutations without partial resources", () => {
  const disabled = executeLb(
    applicationLb(),
    "gcloud services disable compute.googleapis.com --quiet",
  );
  reject(disabled, "gcloud compute health-checks create tcp blocked --global");
  reject(disabled, "sim load-balancing serve web-group --zone=us-central1-a --port=80");
});
test("internal frontend requires proxy subnet and rejects regular VM/address placement there", () => {
  const partial = executeLb(session(), ...internalLesson.slice(0, 12));
  const removed = session({
    ...partial.world,
    subnets: partial.world.subnets.filter((s) => s.name !== "internal-proxy"),
  });
  reject(removed, internalLesson[12] ?? "");
  reject(
    partial,
    "gcloud compute instances create bad-vm --zone=us-central1-a --network=internal-net --subnet=internal-proxy",
  );
  reject(
    partial,
    "gcloud compute addresses create bad-ip --region=us-central1 --subnet=internal-proxy",
  );
  reject(
    partial,
    "gcloud compute networks subnets create second-proxy --region=us-central1 --network=internal-net --range=10.23.0.0/24 --purpose=REGIONAL_MANAGED_PROXY --role=ACTIVE",
  );
  reject(
    partial,
    "gcloud compute networks subnets create too-small --region=us-east1 --network=internal-net --range=10.24.0.0/27 --purpose=REGIONAL_MANAGED_PROXY --role=ACTIVE",
  );
});
test("NEG endpoints require real local VM IP/port and cannot be deleted through dangling references", () => {
  const full = executeLb(session(), ...negLesson);
  reject(
    full,
    "gcloud compute network-endpoint-groups update neg-endpoints --zone=us-central1-a --add-endpoint=instance=ghost,port=80",
  );
  reject(
    full,
    "gcloud compute network-endpoint-groups update neg-endpoints --zone=us-central1-a --add-endpoint=instance=neg-api-a,ip=203.0.113.1,port=80",
  );
  reject(
    full,
    "gcloud compute network-endpoint-groups delete neg-endpoints --zone=us-central1-a --quiet",
  );
  reject(full, "gcloud compute instances delete neg-api-a --zone=us-central1-a --quiet");
  reject(
    full,
    "gcloud compute backend-services remove-backend neg-api --global --network-endpoint-group=neg-endpoints --network-endpoint-group-zone=us-central1-a --balancing-mode=RATE --max-rate-per-endpoint=0",
  );
});
test.each([
  "gcloud compute target-http-proxies delete cleanup-proxy --global --quiet",
  "gcloud compute url-maps delete cleanup-map --global --quiet",
  "gcloud compute backend-services delete cleanup-backend --global --quiet",
  "gcloud compute health-checks delete cleanup-hc --global --quiet",
  "gcloud compute addresses delete cleanup-ip --global --quiet",
  "gcloud compute instance-groups managed delete cleanup-group --zone=us-central1-a --quiet",
  "gcloud compute instance-templates delete cleanup-template --quiet",
])("cleanup blocks dependency reversal: %s", (command) => {
  reject(executeLb(session(), ...cleanupLesson.slice(0, 13)), command);
});
test("cleanup removes own resources and preserves unrelated similarly named resources", () => {
  const other = executeLb(
    session(),
    "gcloud compute health-checks create tcp cleanup-unrelated --global",
    "gcloud compute instance-templates create other-template",
  );
  const complete = executeLb(other, ...cleanupLesson);
  expect(complete.world.healthChecks.map((h) => h.name)).toContain("cleanup-unrelated");
  expect(complete.world.instanceTemplates.map((t) => t.name)).toContain("other-template");
  expect(World.validate(complete.world)).toEqual(Result.ok(complete.world));
});
test("backend bucket cannot be bypassed by deleting its Storage bucket", () => {
  const full = executeLb(session(), ...bucketLesson);
  reject(full, "gcloud storage rm gs://lb-static-data --recursive --quiet");
});
test("help and completion expose formal health grammar and resource-specific references", () => {
  const full = applicationLb();
  expect(Engine.completionCandidates(full.world, "gcloud compute health-checks create ")).toEqual(
    expect.arrayContaining(["http", "tcp", "https"]),
  );
  expect(
    Engine.completionCandidates(
      full.world,
      "gcloud compute target-http-proxies create next --url-map=web",
    ),
  ).toEqual(["--url-map=web-map"]);
  expect(
    Engine.completionCandidates(
      full.world,
      "gcloud compute forwarding-rules create next --target-http-proxy=web",
    ),
  ).toEqual(["--target-http-proxy=web-proxy"]);
  expect(run(full, "sim load-balancing probe --help").text).toContain("--min-healthy");
  expect(run(full, "gcloud compute health-checks create https --help").text).toContain(
    "--request-path",
  );
});

test("regional list permission does not expose global resources", () => {
  const owner = executeLb(
    session(),
    "gcloud compute health-checks create tcp global-check --global",
    "gcloud compute health-checks create tcp central-check --region=us-central1",
    "gcloud compute health-checks create tcp east-check --region=us-east1",
    "gcloud iam roles create regionalReader --permissions=compute.regionHealthChecks.list",
  );
  const reader = withRole(owner, "projects/ace-dev-01/roles/regionalReader");
  const listed = executeLb(reader, "gcloud compute health-checks list --regions=us-central1");
  expect(listed.text).toContain("central-check");
  expect(listed.text).not.toContain("global-check");
  expect(listed.text).not.toContain("east-check");
  reject(reader, "gcloud compute health-checks list --global");
  reject(reader, "gcloud compute health-checks list");
  reject(reader, "gcloud compute health-checks list --regions=unknown");
});
test("global list permission remains sufficient for explicitly global resource lists", () => {
  const owner = executeLb(
    applicationLb(),
    "gcloud iam roles create globalReader --permissions=compute.backendServices.list,compute.urlMaps.list,compute.globalForwardingRules.list,compute.globalAddresses.list",
  );
  const reader = withRole(owner, "projects/ace-dev-01/roles/globalReader");
  for (const kind of ["backend-services", "url-maps", "forwarding-rules", "addresses"]) {
    executeLb(reader, `gcloud compute ${kind} list --global`);
    reject(reader, `gcloud compute ${kind} list --regions=us-central1`);
    reject(reader, `gcloud compute ${kind} list`);
  }
});
test("late backend attachments cannot cross an internal frontend VPC", () => {
  const built = executeLb(
    session(),
    ...internalLesson,
    "gcloud compute instance-templates create other-template --network=default",
    "gcloud compute instance-groups managed create other-group --zone=us-central1-a --template=other-template --size=1",
  );
  reject(
    built,
    "gcloud compute backend-services add-backend internal-backend --region=us-central1 --instance-group=other-group --instance-group-zone=us-central1-a",
  );
});
test("one backend service cannot mix MIG and zonal NEG types", () => {
  const built = executeLb(session(), ...negLesson);
  reject(
    built,
    "gcloud compute backend-services add-backend neg-backend --global --network-endpoint-group=neg-endpoints --network-endpoint-group-zone=us-central1-a --balancing-mode=RATE --max-rate-per-endpoint=50",
  );
});

test("frontend read permission alone cannot expose the referenced graph through probe", () => {
  const owner = executeLb(
    applicationLb(),
    "gcloud iam roles create frontReader --permissions=compute.globalForwardingRules.get",
  );
  const reader = withRole(owner, "projects/ace-dev-01/roles/frontReader");
  executeLb(reader, "gcloud compute forwarding-rules describe web-front --global");
  reject(reader, "sim load-balancing probe web-front --global");
});
