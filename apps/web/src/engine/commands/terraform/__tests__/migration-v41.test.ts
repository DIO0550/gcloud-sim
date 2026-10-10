// @vitest-environment node
import { expect, test } from "vitest";
import { Now, run, type Session, session } from "@/engine/__tests__/setup";
import { TfBackend, type TfStateData } from "@/engine/domains/terraform/backend";
import { Snapshot } from "@/engine/snapshot";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const bucket = "ace-dev-01-tf-state";
const execute = (start: Session, ...commands: string[]): Session =>
  commands.reduce((current, command) => {
    const next = run(current, command);
    expect(next.text, command).not.toContain("ERROR:");
    return next;
  }, start);
const legacyData = ({ sensitiveOutputs: _sensitive, ...data }: TfStateData) => data;

const legacySnapshot = () => {
  const built = execute(
    session(),
    "sim files load terraform-network",
    "gcloud auth application-default login",
    "terraform init",
    "terraform apply -auto-approve",
    `gcloud storage buckets create gs://${bucket} --location=us-central1 --uniform-bucket-level-access`,
    `gcloud storage buckets update gs://${bucket} --versioning`,
    "sim files load terraform-backend",
    "terraform init -force-copy",
    "terraform apply -refresh-only -auto-approve",
    "terraform plan -out=reviewed",
  );
  const {
    providerVersion: _provider,
    sensitiveOutputs: _sensitive,
    events: _events,
    ...state
  } = built.world.terraform;
  const remotes = state.backend.remotes.map((remote) => ({
    ...remote,
    data: legacyData(remote.data),
    versions: remote.versions.map((version) => ({
      ...version,
      data: legacyData(version.data),
    })),
  }));
  const remote = remotes[0];
  if (!remote) {
    throw new Error("Missing remote fixture");
  }
  const path = TfBackend.path(remote.config);
  const oldSizes = [...remote.versions, { generation: remote.generation, data: remote.data }].map(
    (version) => JSON.stringify({ generation: version.generation, ...version.data }).length,
  );
  const storageVersions = built.world.storageLab.versions
    .filter((version) => version.bucket === bucket && version.name === path)
    .sort((a, b) => a.generation - b.generation);
  expect(storageVersions).toHaveLength(oldSizes.length);
  const latestSize = oldSizes.at(-1);
  if (latestSize === undefined) {
    throw new Error("Missing legacy object size");
  }
  // Schema 41 stored the original state JSON size in both storage representations.
  const world = {
    ...built.world,
    buckets: built.world.buckets.map((item) => ({
      ...item,
      objects: item.objects.map((object) =>
        item.name === bucket && object.name === path ? { ...object, size: latestSize } : object,
      ),
    })),
    storageLab: {
      ...built.world.storageLab,
      versions: built.world.storageLab.versions.map((version) => {
        const index = storageVersions.findIndex((item) => item.generation === version.generation);
        if (version.bucket !== bucket || version.name !== path || index < 0) {
          return version;
        }
        return { ...version, size: oldSizes[index] as number };
      }),
    },
    terraform: {
      ...state,
      files: Object.fromEntries(
        Object.entries(state.files).filter(([name]) => name !== ".terraform.lock.hcl"),
      ),
      plans: Object.fromEntries(
        Object.entries(state.plans).map(([name, plan]) => {
          const { sensitiveOutputs: _sensitive, dependencies: _dependencies, ...legacy } = plan;
          return [name, legacy];
        }),
      ),
      backend: {
        ...state.backend,
        remotes,
        migration: Option.isSome(state.backend.migration)
          ? Option.some({
              ...state.backend.migration.value,
              data: legacyData(state.backend.migration.value.data),
            })
          : Option.none,
      },
    },
  };
  return { snapshot: { schemaVersion: 41, exportedAt: Now, world }, path, built };
};

test("schema 41 GCS state remains readable and its reviewed plan applies after migration", () => {
  const { snapshot, built } = legacySnapshot();
  const loaded = session(Result.unwrap(Snapshot.fromUnknown(snapshot)));
  expect(loaded.world.terraform.serial).toBe(built.world.terraform.serial);
  expect(loaded.world.terraform.backend.generation).toBe(built.world.terraform.backend.generation);
  expect(loaded.world.terraform.backend.remotes[0]?.versions).toHaveLength(1);
  expect(loaded.world.storageLab.versions.map((version) => version.generation)).toEqual(
    built.world.storageLab.versions.map((version) => version.generation),
  );
  expect(JSON.parse(execute(loaded, "terraform state pull").text).resources).toHaveLength(2);
  expect(execute(loaded, "terraform plan").text).toContain("No resource changes");
  const applied = execute(loaded, "terraform init", "terraform apply reviewed");
  expect(applied.world.networks).toEqual(built.world.networks);
  expect(applied.world.subnets).toEqual(built.world.subnets);
  expect(
    Result.unwrap(
      Snapshot.fromUnknown(JSON.parse(JSON.stringify(Snapshot.create(applied.world, Now)))),
    ),
  ).toEqual(applied.world);
});

test.each(["size", "contentType", "updated"] as const)(
  "schema 41 migration does not repair externally changed state object %s",
  (field) => {
    const { snapshot, path } = legacySnapshot();
    const patch = <T extends { size: number; contentType: string; updated: string }>(object: T) => {
      if (field === "size") {
        return { ...object, size: object.size + 1 };
      }
      if (field === "contentType") {
        return { ...object, contentType: "text/plain" };
      }
      return { ...object, updated: "2026-10-01T14:02:31.000Z" };
    };
    const world = {
      ...snapshot.world,
      buckets: snapshot.world.buckets.map((item) => ({
        ...item,
        objects: item.objects.map((object) =>
          item.name === bucket && object.name === path ? patch(object) : object,
        ),
      })),
      storageLab: {
        ...snapshot.world.storageLab,
        versions: snapshot.world.storageLab.versions.map((version) =>
          version.bucket === bucket && version.name === path && version.state === "LIVE"
            ? patch(version)
            : version,
        ),
      },
    };
    const loaded = session(Result.unwrap(Snapshot.fromUnknown({ ...snapshot, world })));
    for (const command of ["terraform plan", "terraform init"]) {
      const rejected = run(loaded, command);
      expect(rejected.text).toContain("deleted or changed outside Terraform");
      expect(rejected.world).toEqual(loaded.world);
    }
  },
);
