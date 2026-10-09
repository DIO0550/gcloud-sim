import {
  type CommandResult,
  Flag,
  ParsedArgs,
  type ProjectContext,
} from "@/engine/cli/command-spec";
import {
  databasesOf,
  findServer,
  type Migration,
  type Profile,
  replaceData,
} from "@/engine/domains/relational/model";
import type { World } from "@/engine/domains/world";
import { Result } from "@/utils/Result";
import {
  candidates,
  command,
  finish,
  invalid,
  missing,
  nameArg,
  permission,
  regionArg,
  regionFlag,
  serverArg,
  textFlag,
  userOf,
  validName,
} from "./shared";

const api = "datamigration.googleapis.com" as const;
const path = (group: string, op: string) => ["gcloud", "database-migration", group, op];
const profile = (world: World, p: string, region: string, name: string) =>
  world.relational.profiles.find(
    (v) => v.projectId === p && v.region === region && v.name === name,
  );
const jobArg = (ctx: ProjectContext, args: ParsedArgs) =>
  Result.flatMap(regionArg(ctx, args), (region) => {
    const j = ctx.world.relational.migrations.find(
      (j) =>
        j.projectId === ctx.project.projectId &&
        j.region === region &&
        j.name === ParsedArgs.requiredPositional(args, 0),
    );
    return j ? Result.ok(j) : missing("Migration job not found in this region.");
  });
const put = (world: World, job: Migration): World => ({
  ...world,
  relational: {
    ...world.relational,
    migrations: world.relational.migrations.map((j) =>
      j.projectId === job.projectId && j.name === job.name ? job : j,
    ),
  },
});
const endpoints = (ctx: ProjectContext, j: Migration) => {
  if (!ctx.project.enabledApis.includes("sqladmin.googleapis.com")) {
    return invalid("Cloud SQL API is required for migration endpoints.");
  }
  const granted = permission(ctx, "cloudsql.instances.connect");
  if (!granted.ok) {
    return granted;
  }
  const source = profile(ctx.world, j.projectId, j.region, j.source);
  const destination = profile(ctx.world, j.projectId, j.region, j.destination);
  if (!source || !destination) {
    return invalid("Migration profile is missing.");
  }
  const a = findServer(ctx.world, { projectId: j.projectId, kind: "sql", name: source.instance });
  const b = findServer(ctx.world, {
    projectId: j.projectId,
    kind: "sql",
    name: destination.instance,
  });
  if (
    !a ||
    !b ||
    a.name === b.name ||
    a.master ||
    b.master ||
    a.engine !== b.engine ||
    !a.engine.startsWith("POSTGRES") ||
    a.network !== source.network ||
    b.network !== destination.network ||
    a.network !== b.network ||
    !a.network ||
    !ctx.world.networks.some((n) => n.projectId === j.projectId && n.name === a.network) ||
    !userOf(ctx.world, a, source.user) ||
    userOf(ctx.world, b, destination.user)?.role !== "writer"
  ) {
    return invalid(
      "Migration requires distinct PostgreSQL primaries with matching versions, existing users and the same private VPC.",
    );
  }
  const data = databasesOf(ctx.world, a);
  if (data.some((d) => d.tables.some((t) => !t.columns.some((c) => c.primary)))) {
    return invalid("CDC requires a primary key on each source table.");
  }
  return Result.ok({ source: a, destination: b });
};
const createProfile = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const name = ParsedArgs.requiredPositional(args, 0);
  const valid = validName(name);
  if (!valid.ok) {
    return valid;
  }
  const region = regionArg(ctx, args);
  if (!region.ok) {
    return region;
  }
  if (
    ctx.world.relational.profiles.some(
      (p) => p.projectId === ctx.project.projectId && p.name === name,
    )
  ) {
    return invalid("Connection profile already exists.");
  }
  const s = serverArg(ctx, textFlag(args, "instance"), "sql", args);
  if (!s.ok) {
    return s;
  }
  if (
    !ctx.project.enabledApis.includes("sqladmin.googleapis.com") ||
    !permission(ctx, "cloudsql.instances.get").ok
  ) {
    return invalid("Cloud SQL API and instance read permission are required.");
  }
  const user = textFlag(args, "user", "postgres");
  const network = textFlag(args, "network");
  if (
    !s.value.engine.startsWith("POSTGRES") ||
    !network ||
    network !== s.value.network ||
    !userOf(ctx.world, s.value, user)
  ) {
    return invalid(
      "Profile requires a PostgreSQL instance, its private VPC and an existing DB user.",
    );
  }
  const p: Profile = {
    projectId: s.value.projectId,
    name,
    region: region.value,
    instance: s.value.name,
    user,
    network,
  };
  return finish(
    {
      ...ctx.world,
      relational: { ...ctx.world.relational, profiles: [...ctx.world.relational.profiles, p] },
    },
    p,
  );
};
const createJob = (ctx: ProjectContext, args: ParsedArgs): CommandResult => {
  const name = ParsedArgs.requiredPositional(args, 0);
  const valid = validName(name);
  if (!valid.ok) {
    return valid;
  }
  const region = regionArg(ctx, args);
  if (!region.ok) {
    return region;
  }
  if (
    ctx.world.relational.migrations.some(
      (j) => j.projectId === ctx.project.projectId && j.name === name,
    )
  ) {
    return invalid("Migration job already exists.");
  }
  const j: Migration = {
    projectId: ctx.project.projectId,
    name,
    region: region.value,
    source: textFlag(args, "source"),
    destination: textFlag(args, "destination"),
    state: "DRAFT",
    phase: "NONE",
    tested: false,
    copies: 0,
  };
  const ends = endpoints(ctx, j);
  if (!ends.ok) {
    return ends;
  }
  const inUse = ctx.world.relational.migrations.some(
    (v) =>
      v.projectId === j.projectId &&
      v.state !== "COMPLETED" &&
      profile(ctx.world, v.projectId, v.region, v.destination)?.instance ===
        ends.value.destination.name,
  );
  if (inUse || databasesOf(ctx.world, ends.value.destination).length) {
    return invalid("Migration destination must be empty and unused by another active job.");
  }
  return finish(
    {
      ...ctx.world,
      relational: { ...ctx.world.relational, migrations: [...ctx.world.relational.migrations, j] },
    },
    j,
  );
};
const advance = (ctx: ProjectContext, args: ParsedArgs): CommandResult =>
  Result.flatMap(jobArg(ctx, args), (j) => {
    if (j.state !== "RUNNING") {
      return invalid("Only RUNNING migration jobs can advance.");
    }
    const ends = endpoints(ctx, j);
    if (!ends.ok) {
      return ends;
    }
    let world = replaceData(
      ctx.world,
      ends.value.destination,
      databasesOf(ctx.world, ends.value.source),
    );
    world = put(world, { ...j, phase: "CDC", copies: j.copies + 1 });
    return finish(world, {
      state: "RUNNING",
      phase: "CDC",
      copies: j.copies + 1,
      destination: databasesOf(world, ends.value.destination),
    });
  });
const transition = (ctx: ProjectContext, args: ParsedArgs, op: string): CommandResult =>
  Result.flatMap(jobArg(ctx, args), (j) => {
    const ends = endpoints(ctx, j);
    if (!ends.ok) {
      return ends;
    }
    if (op === "verify") {
      if (j.state !== "DRAFT") {
        return invalid("Verify a DRAFT job before starting it.");
      }
      return finish(put(ctx.world, { ...j, tested: true }), {
        tested: true,
        source: ends.value.source.name,
        destination: ends.value.destination.name,
      });
    }
    if (op === "start") {
      if (
        j.state !== "DRAFT" ||
        !j.tested ||
        databasesOf(ctx.world, ends.value.destination).length
      ) {
        return invalid("Start requires a verified DRAFT job and empty destination.");
      }
      return finish(put(ctx.world, { ...j, state: "RUNNING", phase: "INITIAL_COPY" }), {
        state: "RUNNING",
        phase: "INITIAL_COPY",
      });
    }
    if (op === "stop") {
      if (j.state !== "RUNNING") {
        return invalid("Stop requires RUNNING state.");
      }
      return finish(put(ctx.world, { ...j, state: "STOPPED" }), { state: "STOPPED" });
    }
    if (op === "resume") {
      if (j.state !== "STOPPED") {
        return invalid("Resume requires STOPPED state.");
      }
      return finish(put(ctx.world, { ...j, state: "RUNNING" }), {
        state: "RUNNING",
        phase: j.phase,
      });
    }
    const source = ends.value.source;
    const destination = ends.value.destination;
    const canonical = (data: ReturnType<typeof databasesOf>) =>
      JSON.stringify(
        data
          .map((d) => ({ name: d.name, vector: d.vector, tables: d.tables }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    if (
      j.state !== "RUNNING" ||
      j.phase !== "CDC" ||
      !j.copies ||
      !source.frozen ||
      canonical(databasesOf(ctx.world, source)) !== canonical(databasesOf(ctx.world, destination))
    ) {
      return invalid(
        "Promotion requires CDC, caught-up data and a paused source (no dual writes).",
      );
    }
    return finish(put(ctx.world, { ...j, state: "COMPLETED", phase: "PROMOTED" }), {
      state: "COMPLETED",
      destination: destination.name,
    });
  });
export const DmsCommands = [
  command(
    path("connection-profiles", "create"),
    api,
    "datamigration.connectionprofiles.create",
    createProfile,
    [
      regionFlag,
      Flag.string("instance", "Existing virtual PostgreSQL source/destination.", {
        required: true,
        candidates: candidates("servers", "sql"),
      }),
      Flag.string("user", "Database user."),
      Flag.string("network", "Existing private VPC.", { required: true }),
    ],
  ),
  command(path("migration-jobs", "create"), api, "datamigration.migrationjobs.create", createJob, [
    regionFlag,
    Flag.string("source", "Source profile.", {
      required: true,
      candidates: candidates("profiles"),
    }),
    Flag.string("destination", "Destination profile.", {
      required: true,
      candidates: candidates("profiles"),
    }),
  ]),
  ...(["connection-profiles", "migration-jobs"] as const).flatMap((group) =>
    (["list", "describe", "delete"] as const).map((op) =>
      command(
        path(group, op),
        api,
        `datamigration.${group === "connection-profiles" ? "connectionprofiles" : "migrationjobs"}.${op === "describe" ? "get" : op}`,
        (ctx, args) =>
          Result.flatMap(regionArg(ctx, args), (region) => {
            const key = group === "connection-profiles" ? "profiles" : "migrations";
            const items = ctx.world.relational[key].filter(
              (v) => v.projectId === ctx.project.projectId && v.region === region,
            );
            if (op === "list") {
              return finish(ctx.world, { resources: items });
            }
            const item = items.find((v) => v.name === ParsedArgs.requiredPositional(args, 0));
            if (!item) {
              return missing("DMS resource not found in this project/region.");
            }
            if (op === "describe") {
              return finish(ctx.world, item);
            }
            if (
              key === "profiles" &&
              ctx.world.relational.migrations.some(
                (j) =>
                  j.projectId === ctx.project.projectId &&
                  [j.source, j.destination].includes(item.name),
              )
            ) {
              return invalid("Delete dependent migration jobs before their profiles.");
            }
            if ("state" in item && item.state === "RUNNING") {
              return invalid("Stop the migration before deleting it.");
            }
            const world = {
              ...ctx.world,
              relational: {
                ...ctx.world.relational,
                [key]: ctx.world.relational[key].filter((v) => v !== item),
              },
            };
            return finish(world, { deleted: item.name });
          }),
        [regionFlag],
        op === "list"
          ? []
          : [
              nameArg(
                "NAME",
                candidates(group === "connection-profiles" ? "profiles" : "migrations"),
              ),
            ],
        op === "delete",
      ),
    ),
  ),
  ...["verify", "start", "stop", "resume", "promote"].map((op) =>
    command(
      path("migration-jobs", op),
      api,
      `datamigration.migrationjobs.${op}`,
      (ctx, args) => transition(ctx, args, op),
      [regionFlag],
      [nameArg("JOB", candidates("migrations"))],
    ),
  ),
  command(
    ["sim", "dms", "advance"],
    api,
    "datamigration.migrationjobs.update",
    advance,
    [regionFlag],
    [nameArg("JOB", candidates("migrations"))],
  ),
];
