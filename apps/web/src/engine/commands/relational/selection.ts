import { Flag, ParsedArgs } from "@/engine/cli/command-spec";
import { command, finish, invalid, textFlag } from "./shared";
export const SelectionCommands = [
  command(
    ["sim", "databases", "choose"],
    "sqladmin.googleapis.com",
    "cloudsql.instances.get",
    (ctx, args) => {
      const scenario = ParsedArgs.requiredPositional(args, 0);
      const service = textFlag(args, "service");
      if (
        ![
          "existing-mysql",
          "global-transactions",
          "warehouse",
          "mobile-documents",
          "telemetry",
          "session-cache",
        ].includes(scenario)
      ) {
        return invalid("Unknown workload scenario.");
      }
      return finish(
        {
          ...ctx.world,
          relational: {
            ...ctx.world.relational,
            decisions: {
              ...ctx.world.relational.decisions,
              [`${ctx.project.projectId}/${scenario}`]: service,
            },
          },
        },
        {
          scenario,
          service,
          requirements:
            {
              "existing-mysql": "Preserve an existing MySQL transactional application.",
              "global-transactions":
                "Large distributed transactions with strong consistency across regions.",
              warehouse: "Cross-source historical analytics.",
              "mobile-documents":
                "Serverless document data with flexible fields and strong consistency.",
              telemetry:
                "Large sparse time-series/wide-column data accessed by row key; no relational joins.",
              "session-cache":
                "Disposable in-memory key/value cache; TTL and low latency, no durable system of record.",
            }[scenario] ?? "Unknown scenario",
        },
      );
    },
    [
      Flag.enum(
        "service",
        "Workload choice.",
        ["cloud-sql", "alloydb", "spanner", "bigquery", "firestore", "redis", "bigtable"],
        { required: true },
      ),
    ],
  ),
];
