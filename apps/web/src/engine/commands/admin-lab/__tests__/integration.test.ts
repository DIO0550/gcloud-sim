// @vitest-environment node
import { expect, test } from "vitest";
import { Now, run, type Session, session } from "@/engine/__tests__/setup";
import { emptyAdminLab } from "@/engine/domains/admin-lab/model";
import { AdminPrelude, AdminSolutions, adminSatisfied } from "@/engine/missions/admin-lab";
import { Snapshot } from "@/engine/snapshot";

const denied = (s: Session, line: string, reason: string) => {
  const next = run(s, line);
  expect(next.text, line).toContain(reason);
  expect(next.world).toEqual(s.world);
};
test("pending quota requests preserve granted capacity; explicit grants govern VM growth", () => {
  const s = run(session(), ...AdminPrelude, AdminSolutions.quota[0]);
  expect(s.world.adminLab.quotas[0]).toMatchObject({
    preferred: 32,
    granted: 24,
    reconciling: true,
  });
  expect(run(s, "sim quotas evaluate --region=us-central1 --additional-cpus=30").text).toContain(
    "allowed: false",
  );
  const full = run(
    s,
    ...Array.from(
      { length: 6 },
      (_, i) =>
        `gcloud compute instances create quota-${i} --zone=us-central1-a --machine-type=e2-standard-4`,
    ),
  );
  expect(full.world.instances).toHaveLength(6);
  denied(
    full,
    "gcloud compute instances create quota-full --zone=us-central1-a --machine-type=e2-standard-2",
    "CPU teaching quota exceeded",
  );
  const granted = run(
    full,
    "sim quotas resolve admin-cpus --granted-value=32",
    "gcloud compute instances create quota-extra --zone=us-central1-a --machine-type=e2-standard-2",
  );
  expect(granted.world.instances).toHaveLength(7);
  denied(
    granted,
    "gcloud quotas preferences update admin-cpus --service=compute.googleapis.com --quota-id=CpusPerProjectPerRegion --preferred-value=40 --dimensions=region=us-east1 --email=owner@example.com",
    "immutable",
  );
  denied(granted, "sim quotas resolve admin-cpus --granted-value=4", "existing usage");
});
test("federation checks issuer, audience, current provider, IAM revocation and subject existence", () => {
  const s = run(session(), ...AdminPrelude, ...AdminSolutions.workload);
  expect(adminSatisfied(s.world, "workload")).toBe(true);
  denied(
    s,
    "sim identity federation exchange --kind=workload --pool=admin-workload --provider=admin-provider --issuer=https://evil.example.com --audience=admin-app --subject=build-agent",
    "issuer/audience/subject",
  );
  denied(
    s,
    "sim identity federation exchange --kind=workload --pool=admin-workload --provider=admin-provider --issuer=https://id.example.com --audience=wrong --subject=build-agent",
    "issuer/audience/subject",
  );
  const revoked = run(
    s,
    "gcloud storage buckets remove-iam-policy-binding gs://admin-workload --member=serviceAccount:admin-worker@ace-dev-01.iam.gserviceaccount.com --role=roles/storage.objectViewer",
  );
  expect(adminSatisfied(revoked.world, "workload")).toBe(false);
  denied(revoked, AdminSolutions.workload.at(-1) ?? "", "current object IAM");
  const expired = run(s, "sim storage time advance --seconds=3600");
  denied(expired, AdminSolutions.workload.at(-1) ?? "", "expired");
  const removed = run(
    s,
    "gcloud iam workload-identity-pools providers delete admin-provider --workload-identity-pool=admin-workload --location=global --quiet",
  );
  expect(adminSatisfied(removed.world, "workload")).toBe(false);
  denied(removed, AdminSolutions.workload.at(-1) ?? "", "provider is unavailable");
  expect(run(removed, "sim auth credentials check SIMULATED-credential-11").text).toContain(
    "subject-unavailable",
  );
});
test("federation provider options reject unsupported mappings and workforce audiences", () => {
  const s = run(session(), ...AdminPrelude, AdminSolutions.workload[0]);
  denied(
    s,
    "gcloud iam workload-identity-pools providers create-oidc invalid-provider --workload-identity-pool=admin-workload --location=global --issuer-uri=http://example.com --attribute-mapping=google.subject=assertion.sub",
    "invalid OIDC provider",
  );
  denied(
    s,
    "gcloud iam workload-identity-pools providers create-oidc invalid-provider --workload-identity-pool=admin-workload --location=global --issuer-uri=https://example.com --attribute-mapping=google.groups=assertion.groups",
    "Only google.subject",
  );
  const workforce = run(s, AdminSolutions.workforce[0]);
  denied(
    workforce,
    `${AdminSolutions.workforce[1]} --allowed-audiences=anything`,
    "unrecognized arguments",
  );
  denied(
    s,
    "gcloud iam workforce-pools create short --organization=123456789012 --location=global",
    "invalid federation pool",
  );
});
test("ordinary budget notifications preserve billing and VM status; create fractions include zero", () => {
  const s = run(
    session(),
    ...AdminPrelude,
    "gcloud compute instances create budget-running --zone=us-central1-a",
    "gcloud billing budgets create --billing-account=01AB2C-DEF345-6789AB --display-name=zero --budget-amount=1000 --threshold-rule=percent=0",
  );
  const id = s.world.budgets[0]?.name.split("/").at(-1);
  const evaluated = run(
    s,
    `sim billing budgets evaluate ${id} --billing-account=01AB2C-DEF345-6789AB --spend=5000`,
  );
  expect(evaluated.text).toContain("resourcesStopped: false");
  expect(evaluated.world.projects).toEqual(s.world.projects);
  expect(evaluated.world.instances).toEqual(s.world.instances);
  denied(
    s,
    `gcloud billing budgets update ${id} --billing-account=01AB2C-DEF345-6789AB --add-threshold-rule=percent=0.5`,
    "integer percent",
  );
  denied(
    s,
    `gcloud billing budgets update ${id} --billing-account=01AB2C-DEF345-6789AB --add-threshold-rule=percent=50,basis=forecasted-spend`,
    "basis=current-spend",
  );
  denied(
    s,
    "gcloud billing budgets create --billing-account=01AB2C-DEF345-6789AB --display-name=wrong --budget-amount=100USD",
    "Expected a number",
  );
});
test("billing export protects its dataset reference and separates project and location", () => {
  const s = run(session(), ...AdminPrelude, AdminSolutions.export[0]);
  denied(
    s,
    "sim billing export configure --billing-account=01AB2C-DEF345-6789AB --dataset=admin_costs --location=us-east1",
    "matching-location",
  );
  const configured = run(s, ...AdminSolutions.export.slice(1));
  denied(
    configured,
    "bq rm --recursive --quiet --location=us-central1 admin_costs",
    "billing export dataset",
  );
  denied(
    configured,
    "sim billing export describe --billing-account=01AB2C-DEF345-6789AB --project=ace-prod-01",
    "bigquery.googleapis.com",
  );
});
test("disabled custom roles and deleted memberships revoke current permissions", () => {
  const s = run(session(), ...AdminPrelude, ...AdminSolutions.group);
  const disabled = session({
    ...s.world,
    customRoles: s.world.customRoles.map((r) => ({ ...r, stage: "DISABLED" as const })),
  });
  expect(adminSatisfied(disabled.world, "group")).toBe(false);
  denied(
    disabled,
    "gcloud storage cp gs://admin-group/report.json ./report.json --account=student@example.com",
    "storage.objects.get",
  );
  const removed = run(
    s,
    "gcloud identity groups memberships delete --group-email=admin-readers@example.com --member-email=student@example.com --quiet",
  );
  expect(adminSatisfied(removed.world, "group")).toBe(false);
  denied(
    s,
    "sim identity users delete student@example.com --customer=C01simulator --quiet",
    "Remove group memberships",
  );
});
test("admin APIs and scope IAM are checked before mutation", () => {
  denied(
    session(),
    "gcloud org-policies reset storage.publicAccessPrevention --organization=123456789012",
    "orgpolicy.googleapis.com",
  );
  const s = run(session(), ...AdminPrelude);
  denied(
    s,
    "gsutil ls --impersonate-service-account=anything@example.com",
    "unrecognized arguments",
  );
  denied(
    s,
    "gcloud org-policies reset storage.publicAccessPrevention --organization=123456789012 --account=dev@example.com",
    "orgpolicy.policies",
  );
  denied(s, "gcloud asset search-all-resources --scope=projects/no-project", "does not exist");
  denied(
    s,
    "gcloud quotas preferences create --preference-id=q --service=compute.googleapis.com --quota-id=CpusPerProjectPerRegion --preferred-value=32 --dimensions=region=us-central1 --email=owner@example.com --account=dev@example.com",
    "cloudquotas.quotas.update",
  );
});
test("schema 38 adds empty administration and current snapshots reject dangling or duplicate state", () => {
  const original = Snapshot.create(session().world, Now);
  const { adminLab: _admin, ...legacy } = original.world;
  const migrated = Snapshot.fromUnknown({ ...original, schemaVersion: 38, world: legacy });
  expect(migrated.ok).toBe(true);
  if (migrated.ok) {
    expect(migrated.value.adminLab).toEqual(emptyAdminLab());
  }
  const s = run(session(), ...AdminPrelude, ...AdminSolutions.quota);
  const quota = s.world.adminLab.quotas[0];
  if (!quota) {
    throw new Error("Quota missing");
  }
  expect(
    Snapshot.fromUnknown(
      Snapshot.create(
        {
          ...s.world,
          adminLab: {
            ...s.world.adminLab,
            quotas: [...s.world.adminLab.quotas, { ...quota, name: "different" }],
          },
        },
        Now,
      ),
    ).ok,
  ).toBe(false);
});
